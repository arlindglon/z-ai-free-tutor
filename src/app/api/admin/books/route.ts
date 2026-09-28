import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, forbidden, unauthorized } from '@/lib/session'
import { chunkContent, estimatePage } from '@/lib/chunk'
import { invalidateChunkCache } from '@/lib/rag'
import { isAutoEmbedding, startAutoEmbed } from '@/lib/book-jobs'

async function requireAdmin() {
  const user = await getSessionUser()
  if (!user) return { err: unauthorized() }
  if (user.role !== 'admin') return { err: forbidden() }
  return { user }
}

type ChapterInput = { title?: unknown; number?: unknown; pageStart?: unknown; content?: unknown }

/** সব বই + চ্যাপটার + চাঙ্ক/এমবেড প্রগ্রেস */
export async function GET() {
  const { err } = await requireAdmin()
  if (err) return err

  const books = await db.book.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      chapters: {
        orderBy: [{ number: 'asc' }, { title: 'asc' }],
        include: { _count: { select: { chunks: true } } },
      },
    },
  })

  const chapterIds = books.flatMap((b) => b.chapters.map((c) => c.id))
  const embeddedGroups = chapterIds.length
    ? await db.chunk.groupBy({
        by: ['chapterId'],
        where: { chapterId: { in: chapterIds }, embedded: true },
        _count: { _all: true },
      })
    : []
  const embeddedMap = new Map(embeddedGroups.map((g) => [g.chapterId, g._count._all]))

  return NextResponse.json({
    books: books.map((b) => ({
      id: b.id,
      title: b.title,
      subject: b.subject,
      board: b.board,
      autoEmbedding: isAutoEmbedding(b.id),
      embedError: b.embedError,
      chapters: b.chapters.map((c) => ({
        id: c.id,
        title: c.title,
        number: c.number,
        chunkCount: c._count.chunks,
        embeddedCount: embeddedMap.get(c.id) ?? 0,
      })),
    })),
  })
}

/** নতুন বই যোগ (অধ্যায়ের টেক্সট থেকে অটো-চাঙ্কিং) */
export async function POST(req: NextRequest) {
  const { err } = await requireAdmin()
  if (err) return err

  const body = await req.json().catch(() => ({}))
  const title = String(body.title ?? '').trim()
  const subject = String(body.subject ?? '').trim()
  const board = body.board ? String(body.board).trim() : null
  const chapters = Array.isArray(body.chapters) ? (body.chapters as ChapterInput[]) : []

  if (title.length < 2) return NextResponse.json({ error: 'বইয়ের নাম দাও।' }, { status: 400 })
  if (!subject) return NextResponse.json({ error: 'বিষয় সিলেক্ট করো।' }, { status: 400 })
  if (!chapters.length) return NextResponse.json({ error: 'কমপক্ষে একটি অধ্যায়ের লেখা দাও।' }, { status: 400 })

  for (const [i, ch] of chapters.entries()) {
    const content = String(ch.content ?? '').trim()
    if (!String(ch.title ?? '').trim()) {
      return NextResponse.json({ error: `অধ্যায় ${i + 1}: শিরোনাম দাও।` }, { status: 400 })
    }
    if (content.length < 50) {
      return NextResponse.json(
        { error: `অধ্যায় "${String(ch.title).trim()}": লেখা খুব ছোট — অন্তত ৫০ অক্ষরের লেখা পেস্ট করো।` },
        { status: 400 }
      )
    }
  }

  const book = await db.book.create({
    data: {
      title,
      subject,
      board,
      chapters: {
        create: chapters.map((ch) => {
          const content = String(ch.content ?? '').trim()
          const pageStart =
            ch.pageStart !== undefined && ch.pageStart !== null && Number(ch.pageStart) > 0
              ? Math.floor(Number(ch.pageStart))
              : null
          const pieces = chunkContent(content)
          return {
            title: String(ch.title ?? '').trim(),
            number:
              ch.number !== undefined && ch.number !== null && Number(ch.number) > 0
                ? Math.floor(Number(ch.number))
                : null,
            pageStart,
            chunks: {
              create: pieces.map((p) => ({
                idx: p.idx,
                content: p.content,
                page: estimatePage(p.offsetChars, pageStart),
              })),
            },
          }
        }),
      },
    },
    include: { chapters: { include: { _count: { select: { chunks: true } } } } },
  })

  invalidateChunkCache()

  // সেভ করলেই অটো-এমবেড শুরু — ম্যানুয়াল বইয়েও আর আলাদা "এমবেড করুন" চাপতে হয় না
  after(async () => {
    startAutoEmbed(book.id)
  })

  return NextResponse.json({
    book: {
      id: book.id,
      title: book.title,
      subject: book.subject,
      board: book.board,
      autoEmbedding: true,
      embedError: null,
      chapters: book.chapters.map((c) => ({
        id: c.id,
        title: c.title,
        number: c.number,
        chunkCount: c._count.chunks,
        embeddedCount: 0,
      })),
    },
  })
}
