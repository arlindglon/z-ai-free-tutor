import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, safeUser, unauthorized } from '@/lib/session'
import { getSettings, pickTagName } from '@/lib/settings'
import { consumeCredit, getUsedToday, refundCredit } from '@/lib/credits'
import { embedQuery, buildSystemPrompt } from '@/lib/gemini'
import { generateTutorAnswer } from '@/lib/ai-engine'
import { retrieveTopK, retrieveTopKLexical } from '@/lib/rag'
import { GeminiError, isTransientAiError } from '@/lib/keypool'

/**
 * মূল ডাটা-ফ্লো:
 * [প্রশ্ন] → [ক্রেডিট চেক] → [এমবেডিং বা লেক্সিকাল] → [TiDB RAG: সেরা ৩ রেফারেন্স]
 * → [কী-পুল: জেমিনাই, ফেইল হলে z-ai] → [ধাপে ধাপে বাংলা উত্তর] → [রেফারেন্স + ক্রেডিট]
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return unauthorized()

  const body = await req.json().catch(() => ({}))
  const question = String(body.question ?? '').trim()
  const subject = body.subject ? String(body.subject).trim() : null

  if (!question) {
    return NextResponse.json({ error: 'আগে প্রশ্নটা লেখো! 😊' }, { status: 400 })
  }
  if (question.length > 2000) {
    return NextResponse.json({ error: 'প্রশ্নটা খুব লম্বা হয়ে গেছে — ২০০০ অক্ষরের মধ্যে লেখো।' }, { status: 400 })
  }

  const settings = await getSettings()

  // ১) দৈনিক ক্রেডিট ভ্যালিডেশন (অ্যাডমিন আনলিমিটেড)
  let used: number
  if (user.role === 'admin') {
    used = await getUsedToday(user.id)
  } else {
    const c = await consumeCredit(user.id, settings.dailyCredits)
    if (!c.ok) {
      return NextResponse.json(
        {
          code: 'NO_CREDITS',
          error: `আজকের ${settings.dailyCredits}টি প্রশ্নের কোটা শেষ! 🌙 কাল রাত ১২টার পর আবার ${settings.dailyCredits}টি প্রশ্ন করতে পারবে।`,
          credits: { used: c.used, limit: settings.dailyCredits },
        },
        { status: 403 }
      )
    }
    used = c.used
  }

  try {
    // ২+৩) রিট্রিভাল: ভেক্টর (Gemini) চললে ভেক্টর, না চললে TF-IDF লেক্সিকাল —
    // রিট্রিভাল কখনোই উত্তর আটকাবে না
    let refs: Awaited<ReturnType<typeof retrieveTopK>> = []
    try {
      const queryVec = await embedQuery(question, settings.embeddingModel)
      refs = await retrieveTopK(queryVec, subject, 3)
    } catch (retrievalErr) {
      console.error(
        '[chat] vector retrieval unavailable → lexical fallback:',
        retrievalErr instanceof Error ? retrievalErr.message : retrievalErr
      )
      refs = await retrieveTopKLexical(question, subject, 3)
    }

    // ৪) প্রম্পট তৈরি (বইয়ের কনটেক্সটসহ)
    const context = refs.length
      ? refs
          .map(
            (r, i) =>
              `[${i + 1}] বই: ${r.book} | অধ্যায়: ${r.chapter}${r.page ? ` | পৃষ্ঠা: ${r.page}` : ''}\n${r.content}`
          )
          .join('\n\n')
      : ''
    const prompt = context
      ? `=== পাঠ্যবইয়ের রেফারেন্স (সবচেয়ে প্রাসঙ্গিক অংশগুলো) ===\n${context}\n\n=== শিক্ষার্থীর প্রশ্ন ===\n${question}`
      : `=== শিক্ষার্থীর প্রশ্ন ===\n${question}`

    // ৫) কী-পুল থেকে জেমিনাই (429 অটো-ফেইলওভার), ফেইল হলে z-ai — স্টুডেন্ট সবসময় উত্তর পাবে
    // RAG লক চালু থাকলে সিস্টেম প্রম্পট শুধু বইয়ের রেফারেন্সে সীমাবদ্ধ থাকে
    const result = await generateTutorAnswer(prompt, buildSystemPrompt({ ragOnly: settings.ragOnlyMode }), settings)

    if (result.blocked || !result.text.trim()) {
      await refundCredit(user.id).catch(() => {})
      return NextResponse.json(
        {
          error: 'এই প্রশ্নের উত্তর দেওয়া সম্ভব হয়নি (সেফটি ফিল্টার)। অন্যভাবে প্রশ্নটা করে দেখো।',
        },
        { status: 422 }
      )
    }

    const references = refs.map((r) => ({
      book: r.book,
      chapter: r.chapter,
      page: r.page,
      snippet: r.snippet,
    }))

    // ৬) উত্তর যে ইঞ্জিন দিয়েছে তার স্বাক্ষর পুল থেকে র‍্যান্ডম নাম — স্টুডেন্ট নাম দেখবে,
    // অ্যাডমিন জানবে কোন ইঞ্জিন উত্তর দিয়েছে (পুল খালি হলে স্বাক্ষর যোগ হয় না)
    const answerTag = pickTagName(result.engine === 'zai' ? settings.tagNameZai : settings.tagNameGemini)

    // ৭) হিস্ট্রিতে সেভ
    const row = await db.question.create({
      data: { userId: user.id, question, answer: result.text, answerTag, references },
    })

    return NextResponse.json({
      id: row.id,
      answer: result.text,
      answerTag,
      references,
      credits: { used, limit: user.role === 'admin' ? 0 : settings.dailyCredits },
      engine: result.engine,
      user: safeUser(user),
    })
  } catch (e) {
    // জেমিনাই/উত্তর ফেইল = ক্রেডিট ফেরত
    await refundCredit(user.id).catch(() => {})

    if (e instanceof GeminiError) {
      if (e.message === 'NO_KEYS' || e.message === 'NO_ENGINES_ENABLED') {
        return NextResponse.json(
          {
            code: 'NO_KEYS',
            error:
              'টিউটর ইঞ্জিন এখনো সেটআপ হয়নি — অ্যাডমিন প্যানেলে গিয়ে Gemini বা Z.ai ফ্রি API কী যোগ করো।',
          },
          { status: 503 }
        )
      }
      // রেট-লিমিট/ব্যস্ত/সার্ভার-ঝামেলা = ট্রানজিয়েন্ট → 503 দাও যাতে ক্লায়েন্ট নিঃশব্দে
      // আবার চেষ্টা করে (queue-র মতো) — শিক্ষার্থী কখনো এরর দেখবে না
      if (isTransientAiError(e)) {
        return NextResponse.json(
          { code: 'ENGINE_BUSY', error: 'ইঞ্জিন একটু ব্যস্ত — লাইনে অপেক্ষা করছে।' },
          { status: 503 }
        )
      }
    }
    console.error('chat error', e)
    return NextResponse.json(
      { error: 'দুঃখিত, উত্তর তৈরি করা গেল না। একটু পরে আবার চেষ্টা করো।' },
      { status: 500 }
    )
  }
}
