/**
 * ব্যাকগ্রাউন্ড অটো-এমবেড জব:
 * PDF আপলোড হওয়ার সাথে সাথে শুরু হয় — বাকি সব চাঙ্ক ব্যাচে ব্যাচে
 * Gemini Embedding API দিয়ে ভেক্টর বানিয়ে TiDB-তে সেভ করতে থাকে।
 * কী পুলের রাউন্ড-রবিন + ফেইলওভার একই কাজ করে; কী ফুরালে/জিও-ব্লক হলে
 * থেমে যায় — কারণটা Book.embedError-এ সেভ হয়, তাই অ্যাডমিন প্যানেলে
 * "কেন থেমেছে" সরাসরি দেখা যায় (আগে চুপচাপ থেমে যেত)।
 */
import { db } from '@/lib/db'
import { embedTexts } from '@/lib/gemini'
import { getSettings } from '@/lib/settings'
import { invalidateChunkCache } from '@/lib/rag'
import { GeminiError } from '@/lib/keypool'

const TAKE = 100
const BATCH = 20
const PAUSE_MS = 300
const MAX_ROUNDS = 500

/** এই প্রসেসে এখন যেসব বইয়ের অটো-এমবেড চলছে */
const running = new Set<string>()

export function isAutoEmbedding(bookId: string): boolean {
  return running.has(bookId)
}

/** থেমে যাওয়ার কারণ → অ্যাডমিন-বান্ধব বাংলা মেসেজ */
function embedStopMessage(e: unknown): string {
  if (e instanceof GeminiError) {
    if (e.message === 'NO_KEYS')
      return 'Gemini API কী নেই — "API কী" ট্যাব থেকে Gemini কী যোগ করো, তারপর "এমবেড করুন" চাপো।'
    if (e.message === 'GEO_BLOCKED')
      return 'এই সার্ভারের লোকেশনে Gemini এমবেডিং ব্লকড (জিও-ব্লক) — US/EU রিজিয়নে (যেমন Vercel) ডিপ্লয় করলে ঠিক হবে।'
    if (e.message === 'KEY_POOL_EXHAUSTED' || e.message === 'ENGINE_DOWN')
      return 'সব কী এখন রেট-লিমিটে — কিছুক্ষণ পর "এমবেড করুন" আবার চাপো (যতটুকু হয়েছে সেভ আছে)।'
  }
  return 'এমবেডিং একটা সমস্যায় থেমে গেছে — কিছুক্ষণ পর "এমবেড করুন" আবার চাপো।'
}

/** ফায়ার-অ্যান্ড-ফরগেট — কলার অপেক্ষা করে না */
export function startAutoEmbed(bookId: string): void {
  if (running.has(bookId)) return
  running.add(bookId)
  void runLoop(bookId)
    .catch((e) => {
      console.error(`[auto-embed] book ${bookId} stopped:`, e instanceof Error ? e.message : e)
    })
    .finally(() => {
      running.delete(bookId)
      invalidateChunkCache()
    })
}

async function runLoop(bookId: string): Promise<void> {
  const settings = await getSettings()
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const chunks = await db.chunk.findMany({
        where: { embedded: false, chapter: { bookId } },
        take: TAKE,
        orderBy: { id: 'asc' },
        select: { id: true, content: true },
      })
      if (!chunks.length) break

      for (let i = 0; i < chunks.length; i += BATCH) {
        const batch = chunks.slice(i, i + BATCH)
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
        // ফ্রি টিয়ার রেট-লিমিটের জন্য ছোট বিরতি
        if (i + BATCH < chunks.length) await new Promise((r) => setTimeout(r, PAUSE_MS))
      }
    }
    // সফলভাবে শেষ (বা আর বাকি নেই) — আগের এরর থাকলে মুছে দাও
    await db.book.update({ where: { id: bookId }, data: { embedError: null } })
  } catch (e) {
    // কারণটা বইয়ের রেকর্ডে সেভ — অ্যাডমিন প্যানেলে সরাসরি দেখা যাবে
    await db.book
      .update({ where: { id: bookId }, data: { embedError: embedStopMessage(e) } })
      .catch(() => {})
    throw e
  }
}
