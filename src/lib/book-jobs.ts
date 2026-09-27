/**
 * ব্যাকগ্রাউন্ড অটো-এমবেড জব:
 * PDF আপলোড হওয়ার সাথে সাথে শুরু হয় — বাকি সব চাঙ্ক ব্যাচে ব্যাচে
 * Gemini Embedding API দিয়ে ভেক্টর বানিয়ে TiDB-তে সেভ করতে থাকে।
 * কী পুলের রাউন্ড-রবিন + ফেইলওভার একই কাজ করে; কী ফুরালে/জিও-ব্লক হলে
 * চুপচাপ থেমে যায় (যতটুকু হয়েছে সেভ) — অ্যাডমিন পরে ম্যানুয়ালি চালু করতে পারে।
 */
import { db } from '@/lib/db'
import { embedTexts } from '@/lib/gemini'
import { getSettings } from '@/lib/settings'
import { invalidateChunkCache } from '@/lib/rag'

const TAKE = 100
const BATCH = 20
const PAUSE_MS = 300
const MAX_ROUNDS = 500

/** এই প্রসেসে এখন যেসব বইয়ের অটো-এমবেড চলছে */
const running = new Set<string>()

export function isAutoEmbedding(bookId: string): boolean {
  return running.has(bookId)
}

/** ফায়ার-অ্যান্ড-ফরগেট — কলার অপেক্ষা করে না */
export function startAutoEmbed(bookId: string): void {
  if (running.has(bookId)) return
  running.add(bookId)
  void runLoop(bookId)
    .catch((e) => {
      // NO_KEYS / GEO_BLOCKED / KEY_POOL_EXHAUSTED → চুপচাপ থামো; কনসোলে লগ
      console.error(`[auto-embed] book ${bookId} stopped:`, e instanceof Error ? e.message : e)
    })
    .finally(() => {
      running.delete(bookId)
      invalidateChunkCache()
    })
}

async function runLoop(bookId: string): Promise<void> {
  const settings = await getSettings()
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const chunks = await db.chunk.findMany({
      where: { embedded: false, chapter: { bookId } },
      take: TAKE,
      orderBy: { id: 'asc' },
      select: { id: true, content: true },
    })
    if (!chunks.length) return

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
}
