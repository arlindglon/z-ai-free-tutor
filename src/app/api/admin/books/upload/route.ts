import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, forbidden, unauthorized } from '@/lib/session'
import { chunkPages } from '@/lib/chunk'
import { extractPdfPages } from '@/lib/pdf'
import { invalidateChunkCache } from '@/lib/rag'
import { startAutoEmbed } from '@/lib/book-jobs'

// Vercel Fluid compute: Hobby তেও সর্বোচ্চ ৩০০ সেকেন্ড পর্যন্ত ফাংশন চলতে পারে
export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_BYTES = 150 * 1024 * 1024 // ১৫০ MB
const CREATE_BATCH = 500 // বড় বইয়ের চাঙ্ক ব্যাচে ব্যাচে ইনসার্ট

async function requireAdmin() {
  const user = await getSessionUser()
  if (!user) return { err: unauthorized() }
  if (user.role !== 'admin') return { err: forbidden() }
  return { user }
}

/**
 * PDF সরাসরি আপলোড → সব অটোমেটিক:
 * টেক্সট এক্সট্র্যাক্ট → ভিজুয়াল-অর্ডার বাংলা ফিক্স → হেডার/ফুটার পরিষ্কার
 * → অধ্যায় শনাক্ত → পৃষ্ঠা-সচেতন চাঙ্ক (প্রকৃত পৃষ্ঠা নম্বর) → DB
 * → রেসপনস পাঠিয়ে দিয়েই ব্যাকগ্রাউন্ডে অটো-এমবেড শুরু (after())
 */
export async function POST(req: NextRequest) {
  const { err } = await requireAdmin()
  if (err) return err

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'ফাইল পাঠানো যায়নি — আবার চেষ্টা করো।' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'কোনো PDF ফাইল পাওয়া যায়নি।' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'ফাইল খুব বড় — সর্বোচ্চ ১৫০ MB আপলোড করা যাবে।' },
      { status: 413 }
    )
  }

  const buf = Buffer.from(await file.arrayBuffer())

  // PDF ম্যাজিক নম্বর চেক
  if (buf.length < 5 || buf.subarray(0, 5).toString('ascii') !== '%PDF-') {
    return NextResponse.json({ error: 'এটা সত্যিকারের PDF ফাইল নয়।' }, { status: 400 })
  }

  const subject = String(form.get('subject') ?? '').trim() || 'সাধারণ'
  const board = String(form.get('board') ?? '').trim() || 'NCTB'
  const title =
    String(form.get('title') ?? '').trim() || file.name.replace(/\.pdf$/i, '').trim() || 'নতুন বই'

  // ১) টেক্সট এক্সট্র্যাকশন + অধ্যায় শনাক্ত
  let extracted
  try {
    extracted = await extractPdfPages(buf)
  } catch (e) {
    console.error('[upload] pdf parse failed:', e instanceof Error ? e.message : e)
    return NextResponse.json(
      { code: 'PDF_BROKEN', error: 'PDF পড়া গেল না — ফাইলটা নষ্ট বা পাসওয়ার্ড-প্রোটেক্টেড হতে পারে।' },
      { status: 422 }
    )
  }

  if (extracted.totalChars < 120) {
    return NextResponse.json(
      {
        code: 'NEEDS_OCR',
        error:
          'এই PDF-এ কোনো লেখা পাওয়া যায়নি — সম্ভবত এটা স্ক্যান করা ছবি। টেক্সট-ভিত্তিক PDF দাও (NCTB অফিসিয়াল PDF গুলো টেক্সট-ভিত্তিক)।',
      },
      { status: 422 }
    )
  }

  // ২) অধ্যায় অনুযায়ী পৃষ্ঠা-সচেতন চাঙ্ক (রেফারেন্সের পৃষ্ঠা নম্বর নির্ভুল থাকে)
  type PreparedChapter = {
    title: string
    number: number | null
    pageStart: number
    chunks: { idx: number; content: string; page: number | null }[]
  }
  const prepared: PreparedChapter[] = extracted.sections.map((sec) => ({
    title: sec.title,
    number: sec.number,
    pageStart: sec.startPage,
    chunks: chunkPages(
      extracted.pages.filter((p) => p.page >= sec.startPage && p.page < sec.endPage)
    ),
  }))
  const chunkCount = prepared.reduce((a, c) => a + c.chunks.length, 0)

  if (!prepared.length || chunkCount === 0) {
    return NextResponse.json(
      { error: 'PDF-তে কোনো পড়ার মতো লেখা পাওয়া যায়নি।' },
      { status: 422 }
    )
  }

  // ৩) DB-তে সেভ (ব্যর্থ হলে রোলব্যাক)
  let bookId: string | null = null
  try {
    const book = await db.book.create({
      data: { title: title.slice(0, 120), subject, board },
    })
    bookId = book.id

    for (const ch of prepared) {
      const chapter = await db.chapter.create({
        data: { bookId: book.id, title: ch.title, number: ch.number, pageStart: ch.pageStart },
      })
      for (let i = 0; i < ch.chunks.length; i += CREATE_BATCH) {
        const batch = ch.chunks.slice(i, i + CREATE_BATCH)
        await db.chunk.createMany({
          data: batch.map((p) => ({
            chapterId: chapter.id,
            idx: p.idx,
            content: p.content,
            page: p.page,
          })),
        })
      }
    }
  } catch (e) {
    if (bookId) await db.book.delete({ where: { id: bookId } }).catch(() => {})
    console.error('[upload] db save failed:', e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: 'বইটা সেভ করা গেল না — আবার চেষ্টা করো।' },
      { status: 500 }
    )
  }

  invalidateChunkCache()

  // ৪) রেসপনস পাঠানোর পরেই ব্যাকগ্রাউন্ডে অটো-এমবেড শুরু
  //    (after() = Vercel serverless-এও রেসপনসের পরে কাজ চলতে থাকে)
  after(async () => {
    startAutoEmbed(bookId!)
  })

  const book = await db.book.findUnique({
    where: { id: bookId! },
    include: { chapters: { orderBy: [{ number: 'asc' }, { title: 'asc' }] } },
  })

  return NextResponse.json({
    book: {
      id: bookId,
      title,
      subject,
      board,
      autoEmbedding: true,
      chapters: (book?.chapters ?? []).map((c) => ({
        id: c.id,
        title: c.title,
        number: c.number,
        chunkCount: 0,
        embeddedCount: 0,
      })),
    },
    pageCount: extracted.pageCount,
    chunkCount,
    autoEmbed: true,
  })
}
