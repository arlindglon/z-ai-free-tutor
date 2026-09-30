import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, forbidden, unauthorized } from '@/lib/session'
import { parseOcrBook, cleanOcrText } from '@/lib/ocr-book'
import { chunkContent, chunkPages, estimatePage } from '@/lib/chunk'
import { invalidateChunkCache } from '@/lib/rag'
import { startAutoEmbed } from '@/lib/book-jobs'

async function requireAdmin() {
  const user = await getSessionUser()
  if (!user) return { err: unauthorized() }
  if (user.role !== 'admin') return { err: forbidden() }
  return { user }
}

const MIN_CHARS = 120

/**
 * OCR টেক্সট পেস্ট করে বই যোগ (Gemini দিয়ে ডিজিটাল করা বই):
 * "### পৃষ্ঠা N" মার্কার থেকে পৃষ্ঠা ভাগ → অধ্যায় শনাক্ত → চাঙ্ক (প্রকৃত পৃষ্ঠা নম্বরসহ) → অটো-এমবেড
 *
 * দুই মোড:
 *  ১. নতুন বই — body-তে title/subject/level দাও, bookId নেই
 *  ২. আগের বইয়ে পৃষ্ঠা যোগ — body-তে bookId দাও (OCR ব্যাচে ব্যাচে হওয়ায় পরের ব্যাচ একই বইয়ে যোগ হয়)
 */
export async function POST(req: NextRequest) {
  const { err } = await requireAdmin()
  if (err) return err

  const body = await req.json().catch(() => ({}))
  const appendBookId = body.bookId ? String(body.bookId).trim() : ''
  const title = String(body.title ?? '').trim()
  const subject = String(body.subject ?? '').trim()
  const level = body.level ? String(body.level).trim() : null
  const text = String(body.text ?? '').replace(/\r\n?/g, '\n').trim()

  if (appendBookId && !/^[a-z0-9]+$/i.test(appendBookId)) {
    return NextResponse.json({ error: 'বইয়ের আইডি ভুল — আবার বাছো।' }, { status: 400 })
  }
  if (!appendBookId && title.length < 2) {
    return NextResponse.json({ error: 'বইয়ের নাম দাও।' }, { status: 400 })
  }
  if (!appendBookId && !subject) {
    return NextResponse.json({ error: 'বিষয় সিলেক্ট করো।' }, { status: 400 })
  }
  if (text.length < MIN_CHARS) {
    return NextResponse.json(
      {
        error: `লেখা খুব ছোট — অন্তত ${MIN_CHARS} অক্ষরের OCR টেক্সট পেস্ট করো।`,
      },
      { status: 400 }
    )
  }

  // অ্যাপেন্ড মোড হলে আগে বইটা খোঁজো — পরে পার্স
  const appendBook = appendBookId
    ? await db.book.findUnique({
        where: { id: appendBookId },
        include: { chapters: { select: { title: true, pageStart: true } } },
      })
    : null
  if (appendBookId && !appendBook) {
    return NextResponse.json(
      { error: 'বইটা খুঁজে পাওয়া গেল না — তালিকা রিফ্রেশ করে আবার বাছো।' },
      { status: 404 }
    )
  }

  // titleHint = বইয়ের নাম — PDF-কপি টেক্সটে জমানো "পৃষ্ঠা N" মার্কার খোলা ও রানিং-হেডার বাদ দিতে লাগে
  const parsed = parseOcrBook(text, { titleHint: appendBook?.title ?? title })

  // অধ্যায়-ইনপুট তৈরি: মার্কার থাকলে প্রকৃত পৃষ্ঠা নম্বরে চাঙ্ক, না থাকলে পুরো লেখা এক অধ্যায়
  const chapterInputs = parsed.usedMarkers
    ? parsed.chapters.map((ch) => ({
        title: ch.title,
        number: ch.number,
        pageStart: ch.pageStart,
        pieces: chunkPages(ch.pages),
      }))
    : [
        {
          title: appendBook ? 'অব্যাহত অংশ (পৃষ্ঠা মার্কিং নেই)' : 'সম্পূর্ণ বই',
          number: null as number | null,
          pageStart: null as number | null,
          pieces: chunkContent(cleanOcrText(text)).map((p) => ({
            idx: p.idx,
            content: p.content,
            page: estimatePage(p.offsetChars, null),
          })),
        },
      ]

  // অ্যাপেন্ড মোডে ডুপ্লিকেট-গার্ড: একই শিরোনাম + একই পৃষ্ঠা আগেই থাকলে দুবার পেস্ট বোঝা যায়
  if (appendBook) {
    const dup = chapterInputs.find((ch) =>
      appendBook.chapters.some(
        (e) => e.title === ch.title && e.pageStart === ch.pageStart
      )
    )
    if (dup) {
      return NextResponse.json(
        {
          error: `"${dup.title}"${
            dup.pageStart !== null ? ` (পৃষ্ঠা ${dup.pageStart} থেকে)` : ''
          } এই বইয়ে আগেই আছে — সম্ভবত একই অংশ দুবার পেস্ট হয়েছে। নতুন পৃষ্ঠার OCR টেক্সট দাও।`,
        },
        { status: 409 }
      )
    }
  }

  const totalChunks = chapterInputs.reduce((a, ch) => a + ch.pieces.length, 0)
  if (totalChunks === 0) {
    return NextResponse.json(
      { error: 'পার্স করে কোনো লেখা পাওয়া গেল না — টেক্সটটা দেখে আবার চেষ্টা করো।' },
      { status: 422 }
    )
  }

  try {
    // বই তৈরি (অ্যাপেন্ড হলে আগেরটাই) → অধ্যায় একে একে (ক্রম নিশ্চিত করতে) → চাঙ্ক ব্যাচে ঢোকানো
    const book = appendBook ?? (await db.book.create({ data: { title, subject, level } }))

    let inserted = 0
    const newChapters: { id: string; title: string; number: number | null }[] = []
    for (const [i, ch] of chapterInputs.entries()) {
      const chapterRow = await db.chapter.create({
        data: {
          bookId: book.id,
          title: ch.title || `অধ্যায় ${i + 1}`,
          number: ch.number,
          pageStart: ch.pageStart,
        },
      })
      newChapters.push({ id: chapterRow.id, title: chapterRow.title, number: chapterRow.number })
      const rows = ch.pieces.map((p) => ({
        chapterId: chapterRow.id,
        idx: p.idx,
        content: p.content,
        page: p.page,
      }))
      for (let off = 0; off < rows.length; off += 500) {
        await db.chunk.createMany({ data: rows.slice(off, off + 500) })
      }
      inserted += rows.length
    }

    invalidateChunkCache()

    // সেভ হলেই ব্যাকগ্রাউন্ডে অটো-এমবেড — অ্যাপেন্ড হলেও নতুন চাঙ্কগুলো নিজে থেকেই এমবেড হবে
    after(async () => {
      startAutoEmbed(book.id)
    })

    // অ্যাপেন্ড মোডে পুরো বইয়ের আপডেটেড তালিকা ফেরত দাও
    const fullChapters = appendBook
      ? (
          await db.chapter.findMany({
            where: { bookId: book.id },
            orderBy: [{ number: 'asc' }, { title: 'asc' }],
            include: { _count: { select: { chunks: true } } },
          })
        ).map((c) => ({
          id: c.id,
          title: c.title,
          number: c.number,
          chunkCount: c._count.chunks,
          embeddedCount: 0,
        }))
      : newChapters.map((c) => ({ ...c, chunkCount: 0, embeddedCount: 0 }))

    return NextResponse.json({
      book: {
        id: book.id,
        title: book.title,
        subject: book.subject,
        level: book.level,
        board: book.board,
        autoEmbedding: true,
        embedError: null,
        chapters: fullChapters,
      },
      appended: Boolean(appendBook),
      pageCount: parsed.usedMarkers ? parsed.pageCount : null,
      chapterCount: chapterInputs.length,
      chunkCount: inserted,
      usedMarkers: parsed.usedMarkers,
    })
  } catch (e) {
    const code =
      typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : ''
    if (code === 'P2021' || code === 'P2022') {
      return NextResponse.json(
        { error: 'ডাটাবেস টেবিল নেই — DATABASE_URL ঠিক করে `bunx prisma db push` চালাও।' },
        { status: 500 }
      )
    }
    console.error('book text import error', e)
    return NextResponse.json({ error: 'বই সংরক্ষণ করা গেল না, আবার চেষ্টা করো।' }, { status: 500 })
  }
}
