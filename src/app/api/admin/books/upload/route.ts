import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, forbidden, unauthorized } from '@/lib/session'
import { extractPdfPages } from '@/lib/pdf'
import { chunkPages } from '@/lib/chunk'
import { invalidateChunkCache } from '@/lib/rag'
import { startAutoEmbed } from '@/lib/book-jobs'

export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_BYTES = 150 * 1024 * 1024 // ১৫০ MB

function fail(error: string, code?: string, status = 400) {
  return NextResponse.json({ ...(code ? { code } : {}), error }, { status })
}

/**
 * সরাসরি PDF আপলোড → বাকি সব অটোমেটিক:
 * টেক্সট বের করা → অধ্যায় চেনা → চাঙ্ক (প্রকৃত পৃষ্ঠা নম্বরসহ) → TiDB-তে সেভ
 * → ব্যাকগ্রাউন্ডে অটো-এমবেড শুরু।
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return unauthorized()
  if (user.role !== 'admin') return forbidden()

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return fail('ফাইল আপলোড পড়া গেল না — আবার চেষ্টা করো।')
  }

  const file = form.get('file')
  if (!(file instanceof File)) return fail('আগে PDF ফাইল সিলেক্ট করো।')
  if (file.size === 0) return fail('ফাইলটি খালি।')
  if (file.size > MAX_BYTES) return fail('ফাইল খুব বড় — সর্বোচ্চ ১৫০ MB আপলোড করা যাবে।')

  const buf = Buffer.from(await file.arrayBuffer())
  if (buf.length < 5 || buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return fail('এটা বৈধ PDF ফাইল না — PDF ছাড়া অন্য ফাইল দেওয়া হয়েছে।')
  }

  const subject = String(form.get('subject') ?? '').trim() || 'সাধারণ'
  const board = String(form.get('board') ?? '').trim() || 'NCTB'
  const fileName = file.name.replace(/\.pdf$/i, '').replace(/_+/g, ' ').trim()
  const title = String(form.get('title') ?? '').trim() || fileName || 'নামহীন বই'

  // ১) টেক্সট + অধ্যায় এক্সট্র্যাকশন
  let extracted
  try {
    extracted = await extractPdfPages(buf)
  } catch {
    return fail(
      'PDF পড়া গেল না — ফাইলটি করাপ্ট বা পাসওয়ার্ড-প্রোটেক্টেড হতে পারে।',
      'PDF_BROKEN',
      422
    )
  }

  // ২) স্ক্যান করা (ছবির) PDF ধরা পড়ল কি না
  if (extracted.totalChars < 120) {
    return fail(
      'এই PDF-এ টেক্সট লেয়ার নেই (সম্ভবত স্ক্যান করা ছবি)। টেক্সট-ভিত্তিক PDF আপলোড করো, অথবা ম্যানুয়াল মোডে OCR করা লেখা পেস্ট করো।',
      'NEEDS_OCR',
      422
    )
  }

  // ৩) প্রতিটি অধ্যায় → চাঙ্ক (প্রকৃত পৃষ্ঠা নম্বরসহ)
  const chapterData = extracted.sections
    .map((sec) => {
      const secPages = extracted.pages
        .filter((p) => p.page >= sec.startPage && p.page < sec.endPage)
        .map((p) => ({ page: p.page, text: p.text }))
      const pieces = chunkPages(secPages)
      return {
        title: sec.title,
        number: sec.number,
        pageStart: sec.startPage,
        chunks: pieces.map((p) => ({
          idx: p.idx,
          content: p.content,
          page: p.page,
        })),
      }
    })
    .filter((c) => c.chunks.length > 0)

  if (!chapterData.length) {
    return fail('PDF-এ ব্যবহারযোগ্য লেখা পাওয়া যায়নি।', 'EMPTY_CONTENT', 422)
  }

  // ৪) ডেটাবেসে সেভ (bulk insert — বড় বইয়েও দ্রুত)
  const book = await db.book.create({
    data: { title, subject, board },
  })

  try {
    const allChunks: { chapterId: string; idx: number; content: string; page: number | null }[] = []
    for (const ch of chapterData) {
      const chapter = await db.chapter.create({
        data: {
          bookId: book.id,
          title: ch.title,
          number: ch.number,
          pageStart: ch.pageStart,
        },
      })
      for (const c of ch.chunks) {
        allChunks.push({ chapterId: chapter.id, idx: c.idx, content: c.content, page: c.page })
      }
    }
    await db.chunk.createMany({ data: allChunks })
  } catch (e) {
    // অর্ধেক সেভ হলে অসম্পূর্ণ বই থেকে যাবে না — পরিষ্কার করে দাও
    await db.book.delete({ where: { id: book.id } }).catch(() => {})
    console.error('pdf upload db error', e)
    return fail('ডেটাবেসে সেভ করা গেল না — আবার চেষ্টা করো।', 'DB_ERROR', 500)
  }

  invalidateChunkCache()

  // ৫) ব্যাকগ্রাউন্ডে অটো-এমবেড শুরু (রেসপন্সের অপেক্ষা নয়)
  startAutoEmbed(book.id)

  const chunkCount = chapterData.reduce((a, c) => a + c.chunks.length, 0)
  return NextResponse.json({
    book: {
      id: book.id,
      title: book.title,
      subject: book.subject,
      board: book.board,
      chapters: chapterData.map((c, i) => ({
        id: `pending-${i}`,
        title: c.title,
        number: c.number,
        chunkCount: c.chunks.length,
        embeddedCount: 0,
      })),
    },
    pageCount: extracted.pageCount,
    chunkCount,
    autoEmbed: true,
  })
}
