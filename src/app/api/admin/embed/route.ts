import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, forbidden, unauthorized } from '@/lib/session'
import { getSettings } from '@/lib/settings'
import { embedTexts } from '@/lib/gemini'
import { invalidateChunkCache } from '@/lib/rag'
import { GeminiError } from '@/lib/keypool'

/**
 * এমবেডিং জেনারেটর:
 * এখনো এমবেড হয়নি এমন চাঙ্ক (এক রানে সর্বোচ্চ ১০০) ব্যাচে ব্যাচে
 * Gemini Embedding API দিয়ে ভেক্টর বানিয়ে TiDB-তে সেভ করে।
 * 429 হলে কী-পুল অটো-ফেইলওভার করে।
 */
const TAKE_LIMIT = 100
const BATCH_SIZE = 20

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return unauthorized()
  if (user.role !== 'admin') return forbidden()

  const body = await req.json().catch(() => ({}))
  const bookId = body.bookId ? String(body.bookId) : null
  const settings = await getSettings()

  const where = bookId
    ? { embedded: false, chapter: { bookId } }
    : { embedded: false }

  const chunks = await db.chunk.findMany({
    where,
    take: TAKE_LIMIT,
    orderBy: { id: 'asc' },
    select: { id: true, content: true },
  })

  if (!chunks.length) {
    return NextResponse.json({ embeddedCount: 0, remainingCount: 0 })
  }

  try {
    let done = 0
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE)
      const vectors = await embedTexts(
        batch.map((c) => c.content.slice(0, 8000)),
        settings.embeddingModel,
        'RETRIEVAL_DOCUMENT'
      )
      await Promise.all(
        batch.map((c, j) =>
          db.chunk.update({
            where: { id: c.id },
            data: { embedding: vectors[j] ?? [], embedded: true },
          })
        )
      )
      done += batch.length
      // ফ্রি টিয়ারের রেট লিমিট মাথায় রেখে ব্যাচের মাঝে ছোট বিরতি
      if (i + BATCH_SIZE < chunks.length) {
        await new Promise((r) => setTimeout(r, 250))
      }
    }

    invalidateChunkCache()
    const remainingCount = await db.chunk.count({ where })
    return NextResponse.json({ embeddedCount: done, remainingCount })
  } catch (e) {
    invalidateChunkCache()
    if (e instanceof GeminiError) {
      if (e.message === 'NO_KEYS') {
        return NextResponse.json(
          { code: 'NO_KEYS', error: 'আগে অ্যাডমিন প্যানেলে Gemini API কী যোগ করো!' },
          { status: 503 }
        )
      }
      if (e.message === 'GEO_BLOCKED') {
        return NextResponse.json(
          {
            code: 'GEO_BLOCKED',
            error:
              'তোমার সার্ভারের বর্তমান লোকেশন থেকে Gemini API ফ্রি টিয়ার সাপোর্টেড না (জিও-ব্লক)। US/EU রিজিয়নে ডিপ্লয় করলে (যেমন Vercel) ভেক্টর এমবেডিং চলবে। চিন্তা নেই — চ্যাট তখনই TF-IDF লেক্সিকাল রিট্রিভাল দিয়ে বইয়ের রেফারেন্স দিচ্ছে!',
          },
          { status: 451 }
        )
      }
      if (e.message === 'KEY_POOL_EXHAUSTED' || e.message === 'ENGINE_DOWN') {
        return NextResponse.json(
          { code: 'KEY_LIMIT', error: 'সব কী রেট লিমিটে — কিছুক্ষণ পর আবার "এমবেড করুন" চাপো (যতটুকু হয়েছে সেভ হয়ে আছে)।' },
          { status: 503 }
        )
      }
    }
    console.error('embed error', e)
    return NextResponse.json({ error: 'এমবেডিং করা গেল না — আবার চেষ্টা করো।' }, { status: 500 })
  }
}
