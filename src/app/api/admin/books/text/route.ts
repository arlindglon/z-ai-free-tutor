import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, forbidden, unauthorized } from '@/lib/session'
import { parseOcrBook } from '@/lib/ocr-book'
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
 */
export async function POST(req: NextRequest) {
  const { err } = await requireAdmin()
  if (err) return err

  const body = await req.json().catch(() => ({}))
  const title = String(body.title ?? '').trim()
  const subject = String(body.subject ?? '').trim()
  const level = body.level ? String(body.level).trim() : null
  const text = String(body.text ?? '').replace(/\r\n?/g, '\n').trim()

  if (title.length < 2) {
    return NextResponse.json({ error: 'বইয়ের নাম দাও।' }, { status: 400 })
  }
  if (!subject) {
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

  const parsed = parseOcrBook(text)

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
          title: 'সম্পূর্ণ বই',
          number: null as number | null,
          pageStart: null as number | null,
          pieces: chunkContent(text).map((p) => ({
            idx: p.idx,
            content: p.content,
            page: estimatePage(p.offsetChars, null),
          })),
        },
      ]

  const totalChunks = chapterInputs.reduce((a, ch) => a + ch.pieces.length, 0)
  if (totalChunks === 0) {
    return NextResponse.json(
      { error: 'পার্স করে কোনো লেখা পাওয়া গেল না — টেক্সটটা দেখে আবার চেষ্টা করো।' },
      { status: 422 }
    )
  }

  try {
    // বই তৈরি → অধ্যায় একে একে (ক্রম নিশ্চিত করতে) → চাঙ্ক ব্যাচে ঢোকানো
    const book = await db.book.create({
      data: { title, subject, level },
    })

    let inserted = 0
    const chapters: { id: string; title: string; number: number | null }[] = []
    for (const [i, ch] of chapterInputs.entries()) {
      const chapterRow = await db.chapter.create({
        data: {
          bookId: book.id,
          title: ch.title || `অধ্যায় ${i + 1}`,
          number: ch.number,
          pageStart: ch.pageStart,
        },
      })
      chapters.push({ id: chapterRow.id, title: chapterRow.title, number: chapterRow.number })
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

    // সেভ হলেই ব্যাকগ্রাউন্ডে অটো-এমবেড — অ্যাডমিন আর কিছু করতে হবে না
    after(async () => {
      startAutoEmbed(book.id)
    })

    return NextResponse.json({
      book: {
        id: book.id,
        title: book.title,
        subject: book.subject,
        level: book.level,
        board: null,
        autoEmbedding: true,
        embedError: null,
        chapters: chapters.map((c) => ({
          id: c.id,
          title: c.title,
          number: c.number,
          chunkCount: 0,
          embeddedCount: 0,
        })),
      },
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
