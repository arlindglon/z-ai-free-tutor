import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, safeUser, unauthorized } from '@/lib/session'
import { getSettings } from '@/lib/settings'
import { consumeCredit, getUsedToday, refundCredit } from '@/lib/credits'
import { embedQuery, buildSystemPrompt, type ChatImage } from '@/lib/gemini'
import { generateTutorAnswer } from '@/lib/ai-engine'
import { findCachedAnswer, recordCacheHit, saveToCache, type CachedAnswer } from '@/lib/answer-cache'
import { pickModelAlias, resolveAliasTarget } from '@/lib/models'
import {
  retrieveHybrid,
  RAG_REFUSAL_TEXT,
  RAG_UNGROUNDED_TEXT,
  answerGroundedInBook,
  bookCoverage,
  isCleanRefusal,
} from '@/lib/rag'
import { countMixedScriptWords } from '@/lib/bn'
import { GeminiError, isTransientAiError } from '@/lib/keypool'

/** মিশ্র-লিপি দূষিত উত্তর পেলে রি-জেনারেশনের সময় সিস্টেম-প্রম্পটে জোড়া হয় */
const MIXED_SCRIPT_WARNING =
  '\n\n⚠️ বানান-সতর্কতা: তোমার আগের উত্তরে বাংলা শব্দের ভেতরে ইংরেজি অক্ষর মিশে গিয়েছিল (যেমন "খoló" — সঠিক হয় "খোলা")। এবার প্রতিটি শব্দ সম্পূর্ণ বাংলা লিপিতে, সঠিক বানানে লিখবে। সংখ্যা, সূত্র আর সংক্ষিপ্ত রূপের ইংরেজি যেমন আছে তেমনই থাকবে।'

/**
 * মূল ডাটা-ফ্লো:
 * [প্রশ্ন/ছবি] → [ক্রেডিট চেক] → [⚡ ক্যাশ-হিট? হলে খরচ-শূন্য তাৎক্ষণিক উত্তর]
 * → [এমবেডিং বা লেক্সিকাল] → [TiDB RAG: সেরা ৩ রেফারেন্স]
 * → [কী-পুল: জেমিনাই, ফেইল হলে z-ai] → [ধাপে ধাপে বাংলা উত্তর] → [রেফারেন্স + ক্রেডিট]
 */

/** ক্লায়েন্ট-সাইড কম্প্রেস করা ছবি (data URL) → { mimeType, base64 } — না-মিললে null */
function parseImage(value: unknown): ChatImage | null {
  if (typeof value !== 'string') return null
  const m = value.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/)
  if (!m || !m[2] || m[2].length < 100) return null
  // Vercel-বডি লিমিট আগেই আটকায়; তবু সেনিটি-ক্যাপ: ~5MB base64
  if (m[2].length > 5_500_000) return null
  return { mimeType: m[1] === 'image/jpg' ? 'image/jpeg' : m[1], data: m[2] }
}
export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return unauthorized()

  const body = await req.json().catch(() => ({}))
  const question = String(body.question ?? '').trim()
  const subject = body.subject ? String(body.subject).trim() : null
  const image = parseImage(body.image)

  if (!question && !image) {
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
    // ⚡ ক্যাশ-হিট-এ ক্রেডিট ফেরত + তাৎক্ষণিক উত্তর — রিপিট প্রশ্নে ইঞ্জিন-কলই হয় না
    const serveFromCache = async (cached: CachedAnswer) => {
      await recordCacheHit(cached.id)
      if (user.role !== 'admin') await refundCredit(user.id).catch(() => {})
      const row = await db.question.create({
        data: {
          userId: user.id,
          question,
          answer: cached.answer,
          answerTag: cached.answerTag,
          references: cached.references,
          answerEngine: 'cache', // অডিট: এই উত্তর ইঞ্জিন না, ক্যাশ থেকে এসেছে
        },
      })
      return NextResponse.json({
        id: row.id,
        answer: cached.answer,
        answerTag: cached.answerTag,
        references: cached.references,
        cached: true,
        credits: {
          used: user.role === 'admin' ? used : Math.max(0, used - 1),
          limit: user.role === 'admin' ? 0 : settings.dailyCredits,
        },
        user: safeUser(user),
      })
    }

    // ⚡ স্তর ১: হুবহু-মিল ক্যাশ — এমবেডিং-কলও বাঁচে (ছবি-প্রশ্ন ক্যাশে যায় না;
    // অ্যাডমিন ক্যাশ বন্ধ করলে প্রতিটি প্রশ্ন সরাসরি ইঞ্জিনে যায়)
    if (!image && settings.cacheEnabled) {
      const exact = await findCachedAnswer(question, null, settings.embeddingModel, settings.ragOnlyMode).catch(
        () => null
      )
      if (exact) return await serveFromCache(exact)
    }

    // ২+৩) হাইব্রিড রিট্রিভাল: ভেক্টর (Gemini) + লেক্সিকাল (TF-IDF) দুটোই চলে —
    // সংক্ষিপ্তরূপ/বিরল-শব্দের প্রশ্ন ("FCR-এর পূর্ণরূপ") ভেক্টরে দুর্বল মিলেও
    // লেক্সিকালে হুবহু ধরা পড়ে। রিট্রিভাল কখনোই উত্তর আটকাবে না।
    let queryVec: number[] | null = null
    try {
      queryVec = await embedQuery(question, settings.embeddingModel)
    } catch (retrievalErr) {
      console.error(
        '[chat] vector embedding unavailable → lexical-only retrieval:',
        retrievalErr instanceof Error ? retrievalErr.message : retrievalErr
      )
    }
    const refs = await retrieveHybrid(question, queryVec, subject, 3)

    // ⚡ স্তর ২: এমবেডিং-সাদৃশ্য ক্যাশ (cosine ≥ ০.৯৫) — ছোট-বড় ভুল-বানান/শব্দ-ক্রমেও হিট
    if (!image && queryVec && settings.cacheEnabled) {
      const similar = await findCachedAnswer(question, queryVec, settings.embeddingModel, settings.ragOnlyMode).catch(
        () => null
      )
      if (similar) return await serveFromCache(similar)
    }

    // 🔒 RAG লক — গেট ১ (ডিটারমিনিস্টিক): বইয়ের কোনো অংশ না মিললে প্রশ্ন মডেলের কাছেই যাবে না —
    // নইলে ফ্রি ফ্ল্যাশ মডেল নিজের মাথা থেকে উত্তর দিয়ে ফেলে (প্রম্পট-নিয়ম ignore করে)।
    // ক্রেডিট ফেরত + হিস্ট্রিতে স্বাভাবিক টিউটর-বার্তা হিসেবে সেভ — স্টুডেন্ট কোনো এরর দেখে না।
    // 📸 ছবি-প্রশ্নে গেট-১ বাইপাস — ছবিটাই প্রধান রেফারেন্স (লক থাকলে ছবি-ফিচারটাই অচল হত)
    if (settings.ragOnlyMode && refs.length === 0 && !image) {
      if (user.role !== 'admin') await refundCredit(user.id).catch(() => {})
      const row = await db.question.create({
        data: {
          userId: user.id,
          question,
          answer: RAG_REFUSAL_TEXT,
          answerTag: null,
          references: [],
        },
      })
      return NextResponse.json({
        id: row.id,
        answer: RAG_REFUSAL_TEXT,
        answerTag: null,
        references: [],
        credits: {
          used: user.role === 'admin' ? used : Math.max(0, used - 1),
          limit: user.role === 'admin' ? 0 : settings.dailyCredits,
        },
        user: safeUser(user),
      })
    }

    // ৪) প্রম্পট তৈরি (বইয়ের কনটেক্সটসহ + ছবি-নির্দেশনা)
    const qText = question || 'ছবিতে দেওয়া প্রশ্নটির উত্তর দাও'
    const context = refs.length
      ? refs
          .map(
            (r, i) =>
              `[${i + 1}] বই: ${r.book} | অধ্যায়: ${r.chapter}${r.page ? ` | পৃষ্ঠা: ${r.page}` : ''}\n${r.content}`
          )
          .join('\n\n')
      : ''
    let prompt = context
      ? `=== পাঠ্যবইয়ের রেফারেন্স (সবচেয়ে প্রাসঙ্গিক অংশগুলো) ===\n${context}\n\n=== শিক্ষার্থীর প্রশ্ন ===\n${qText}`
      : `=== শিক্ষার্থীর প্রশ্ন ===\n${qText}`
    if (image) {
      prompt += `\n\n=== শিক্ষার্থীর পাঠানো ছবি ===\nছবিটা মনোযোগ দিয়ে পড়ো — প্রশ্ন/অঙ্ক/চিত্র ছবিতেই আছে। ছবির লেখা পড়ে (বাংলা/ইংরেজি/অঙ্ক যা-ই হোক) প্রশ্নটা বুঝে, ধাপে ধাপে সমাধান/ব্যাখ্যা করো। ছবিটাই এখন প্রধান রেফারেন্স।`
    }

    // ৫) কী-পুল থেকে জেমিনাই (429 অটো-ফেইলওভার), ফেইল হলে z-ai — স্টুডেন্ট সবসময় উত্তর পাবে
    // RAG লক চালু থাকলে সিস্টেম প্রম্পট শুধু বইয়ের রেফারেন্সে সীমাবদ্ধ থাকে
    // 📸 ছবি-প্রশ্নে লক-প্রোটোকল বন্ধ — ছবিই ভিত্তি
    // স্বাক্ষর-রাউটিং: প্রশ্নে অ্যাডমিনের দেওয়া কোড/নাম থাকলে সেই মডেল সবার আগে চেষ্টা হয়
    const aliasTarget = await resolveAliasTarget(question)
    let result = await generateTutorAnswer(
      prompt,
      buildSystemPrompt({ ragOnly: settings.ragOnlyMode && !image }),
      settings,
      aliasTarget ?? undefined,
      image ?? undefined
    )

    // 🧹 মিশ্র-লিপি রক্ষা: ছোট ফ্রি মডেল মাঝে মাঝে "খoló" (খোলা) জাতীয় বাংলা-ইংরেজি
    // মিশ্র শব্দ লেখে — ছাত্র পড়তে পারে না। দূষণ ধরা পড়লে একবার জোর-নির্দেশসহ
    // আবার চেষ্টা; দুটোর মধ্যে পরিষ্কারটা রাখো (রিট্রাই ফেল করলেও আগের উত্তর যাবেই)।
    if (!image && !isCleanRefusal(result.text)) {
      const dirty = countMixedScriptWords(result.text)
      if (dirty > 0) {
        try {
          const retry = await generateTutorAnswer(
            prompt,
            buildSystemPrompt({ ragOnly: settings.ragOnlyMode && !image }) + MIXED_SCRIPT_WARNING,
            settings,
            aliasTarget ?? undefined
          )
          if (
            !retry.blocked &&
            retry.text.trim() &&
            countMixedScriptWords(retry.text) < dirty
          ) {
            console.warn(
              `[chat] mixed-script repair: ${dirty} → ${countMixedScriptWords(retry.text)} দূষিত শব্দ`
            )
            result = retry
          }
        } catch {
          // রিট্রাই ফেল = আগের উত্তরই থাকবে
        }
      }
    }

    if (result.blocked || !result.text.trim()) {
      if (user.role !== 'admin') await refundCredit(user.id).catch(() => {})
      return NextResponse.json(
        {
          error: 'এই প্রশ্নের উত্তর দেওয়া সম্ভব হয়নি (সেফটি ফিল্টার)। অন্যভাবে প্রশ্নটা করে দেখো।',
        },
        { status: 422 }
      )
    }

    // 🔒 RAG লক — গেট ২ (উত্তর-কনট্রাক্ট যাচাই): পরিষ্কার প্রত্যাখ্যান হলে বৈধ; নইলে উত্তরের
    // কনটেন্ট-শব্দ আসলে refs-এ আছে কি না (লেক্সিক্যাল grounding)। মডেল ভুয়া উত্তরের শেষে
    // ফুটারও লাগিয়ে দিতে পারে — তাই শুধু ফুটার-চেক যথেষ্ট নয় (লাইভ টেস্টে প্রমাণিত)।
    // ফাঁস ধরা পড়লে বদলে নির্দিষ্ট প্রত্যাখ্যান দাও। ক্রেডিট ফেরত।
    if (settings.ragOnlyMode && !image && !answerGroundedInBook(result.text, refs)) {
      console.warn(
        `[chat] RAG-lock violation: কভারেজ ${(bookCoverage(result.text, refs) * 100).toFixed(0)}% (থ্রেশহোল্ড ৪৫%) — উত্তরে বইয়ের রেফারেন্স নেই → প্রত্যাখ্যান দেওয়া হলো। ফাঁস করা অংশ:`,
        result.text.slice(0, 300)
      )
      if (user.role !== 'admin') await refundCredit(user.id).catch(() => {})
      const row = await db.question.create({
        data: {
          userId: user.id,
          question,
          answer: RAG_UNGROUNDED_TEXT,
          answerTag: null,
          references: [],
        },
      })
      return NextResponse.json({
        id: row.id,
        answer: RAG_UNGROUNDED_TEXT,
        answerTag: null,
        references: [],
        credits: {
          used: user.role === 'admin' ? used : Math.max(0, used - 1),
          limit: user.role === 'admin' ? 0 : settings.dailyCredits,
        },
        user: safeUser(user),
      })
    }

    // রেফারেন্স চিপ পরিষ্কার:
    // ১) মডেল নিজেই পরিষ্কার প্রত্যাখ্যান লিখেছে ("পাইনি 📖") → রেফারেন্স থাকে না —
    //    "পাইনি" বলা উত্তরের নিচে বইয়ের অংশের চিপ দেখালে ছাত্র বিভ্রান্ত হয়
    // ২) নইলে একই বই+অধ্যায়+পৃষ্ঠার একাধিক চাঙ্ক = একটাই চিপ (ডুপ্লিকেট বাদ) + পৃষ্ঠা-ক্রমে
    const dedupedRefs = refs.filter((r, i) => {
      const key = `${r.book}|${r.chapter}|${r.page ?? 'x'}`
      return refs.findIndex((o) => `${o.book}|${o.chapter}|${o.page ?? 'x'}` === key) === i
    })
    const references = isCleanRefusal(result.text)
      ? []
      : [...dedupedRefs]
          .sort((a, b) => (a.page ?? 9999) - (b.page ?? 9999))
          .map((r) => ({
            book: r.book,
            chapter: r.chapter,
            page: r.page,
            snippet: r.snippet,
            content: r.content,
          }))

    // ৬) উত্তর যে মডেল দিয়েছে তার স্বাক্ষর পুল থেকে র‍্যান্ডম নাম — স্টুডেন্ট নাম দেখবে
    // (আসল মডেল বুঝবে না), অ্যাডমিন নাম দেখে মডেল ধরতে পারবে। পুল খালি হলে স্বাক্ষর নেই।
    // আসল ইঞ্জিন/মডেল শুধু DB-তে অডিটের জন্য জমা হয় — রেসপনসে ফাঁস হয় না।
    const answerTag = await pickModelAlias(result.modelId)

    // ⚡ সফল, প্রত্যাখ্যান-বিহীন, মিশ্র-লিপি-মুক্ত টেক্সট-উত্তর ক্যাশে জমা —
    // দূষিত উত্তর ক্যাশে গেলে রিপিট-প্রশ্নেও দূষিতই ফেরত যেত; ক্যাশ বন্ধ থাকলে সেভও হয় না
    if (settings.cacheEnabled && !image && !isCleanRefusal(result.text) && countMixedScriptWords(result.text) === 0) {
      await saveToCache({
        question,
        answer: result.text,
        answerTag,
        references,
        embedding: queryVec,
        embeddingModel: settings.embeddingModel,
        ragOnly: settings.ragOnlyMode,
      })
    }

    // ৭) হিস্ট্রিতে সেভ
    const row = await db.question.create({
      data: {
        userId: user.id,
        question,
        answer: result.text,
        answerTag,
        answerEngine: result.engine,
        answerModel: result.modelId,
        references,
      },
    })

    return NextResponse.json({
      id: row.id,
      answer: result.text,
      answerTag,
      references,
      credits: { used, limit: user.role === 'admin' ? 0 : settings.dailyCredits },
      user: safeUser(user),
    })
  } catch (e) {
    // ইঞ্জিন/উত্তর ফেইল = ক্রেডিট ফেরত (অ্যাডমিন খরচই করে নি — তার কোটা কমানো উচিত নয়)
    if (user.role !== 'admin') await refundCredit(user.id).catch(() => {})

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
