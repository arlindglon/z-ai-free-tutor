import { db } from '@/lib/db'

/**
 * RAG রিট্রিভাল:
 * - এমবেডেড চাঙ্কগুলো মেমোরিতে ক্যাশ (TTL ২ মিনিট)
 * - প্রশ্নের ভেক্টরের সাথে কোসাইন সিমিলারিটি → সেরা ৩টি রেফারেন্স
 * - TiDB-ই এক জায়গায় ইউজার ডাটা + বইয়ের ভেক্টর ধরে রাখে; স্কেল ছোট বলে
 *   সিমিলারিটি র‍্যাঙ্কিং অ্যাপ-লেয়ারে করা হয় (জিরো এক্সট্রা কস্ট)
 */

export type RetrievedChunk = {
  book: string
  chapter: string
  page: number | null
  content: string
  snippet: string
}

type CacheRow = {
  subject: string
  book: string
  chapter: string
  page: number | null
  content: string
  embedding: number[]
}

let cache: { at: number; rows: CacheRow[] } | null = null
const TTL = 120_000

async function loadEmbeddedRows(): Promise<CacheRow[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.rows
  const chunks = await db.chunk.findMany({
    where: { embedded: true },
    include: { chapter: { include: { book: { select: { title: true, subject: true } } } } },
  })
  const rows: CacheRow[] = []
  for (const c of chunks) {
    const emb = c.embedding
    if (Array.isArray(emb) && emb.length > 0) {
      rows.push({
        subject: c.chapter.book.subject,
        book: c.chapter.book.title,
        chapter: c.chapter.title,
        page: c.page,
        content: c.content,
        embedding: emb as number[],
      })
    }
  }
  cache = { at: Date.now(), rows }
  return rows
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (!na || !nb) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

const SIMILARITY_THRESHOLD = 0.3

/** প্রশ্নের ভেক্টরের সাথে সবচেয়ে প্রাসঙ্গিক k-টি বইয়ের অংশ */
export async function retrieveTopK(
  queryVec: number[],
  subject: string | null | undefined,
  k = 3
): Promise<RetrievedChunk[]> {
  if (!queryVec.length) return []
  const rows = await loadEmbeddedRows()
  if (!rows.length) return []

  const pool = subject ? rows.filter((r) => r.subject === subject) : rows
  const candidates = pool.length ? pool : rows // বিষয়ে কিছু না পেলে সব বই দেখো

  return candidates
    .map((r) => ({ r, score: cosine(queryVec, r.embedding) }))
    .filter((x) => x.score >= SIMILARITY_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => ({
      book: x.r.book,
      chapter: x.r.chapter,
      page: x.r.page,
      content: x.r.content,
      snippet: x.r.content.slice(0, 160).trim(),
    }))
}

/* ------------------------------------------------------------------ */
/* লেক্সিকাল ফলব্যাক (TF-IDF): Gemini এমবেডিং না চললে (জিও-ব্লক/কী নেই) */
/* তখনও বইয়ের রেফারেন্স যেন ঠিকভাবে খুঁজে পাওয়া যায়                     */
/* ------------------------------------------------------------------ */

type LexRow = {
  subject: string
  book: string
  chapter: string
  page: number | null
  content: string
  tf: Map<string, number>
  len: number
}

const STOPWORDS = new Set([
  'এর', 'এবং', 'ও', 'কী', 'কি', 'কেন', 'কীভাবে', 'কিভাবে', 'দাও', 'বলো', 'বলুন', 'তো',
  'একটা', 'একটি', 'একটু', 'হলো', 'হয়', 'করে', 'করো', 'করুন', 'থেকে', 'সাথে', 'জন্য',
  'মধ্যে', 'আমি', 'আমার', 'তুমি', 'তোমার', 'আপনি', 'আপনার', 'সে', 'তার', 'এই', 'ওই',
  'সেটা', 'সেটি', 'না', 'আছে', 'ছিল', 'হবে', 'দেয়', 'মতো', 'যে', 'যা', 'তাই', 'কিন্তু',
  'অথবা', 'বা', 'সহজ', 'বুঝাও', 'বুঝিয়ে', 'লেখো', 'সমাধান', 'কত', 'কোথায়', 'কখন',
  'কারা', 'কাকে', 'দেখাও', 'জানাও', 'স্যার', 'please', 'is', 'are', 'the', 'what', 'how',
])

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (t) => t.length >= 2 && !STOPWORDS.has(t)
  )
}

let lexCache: { at: number; rows: LexRow[]; idf: Map<string, number> } | null = null

export function invalidateChunkCache(): void {
  cache = null
  lexCache = null
}

async function loadLexRows(): Promise<{ rows: LexRow[]; idf: Map<string, number> }> {
  if (lexCache && Date.now() - lexCache.at < TTL) return { rows: lexCache.rows, idf: lexCache.idf }

  const chunks = await db.chunk.findMany({
    include: { chapter: { include: { book: { select: { title: true, subject: true } } } } },
  })

  const rows: LexRow[] = chunks.map((c) => {
    const tokens = tokenize(`${c.chapter.title} ${c.content}`)
    const tf = new Map<string, number>()
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
    return {
      subject: c.chapter.book.subject,
      book: c.chapter.book.title,
      chapter: c.chapter.title,
      page: c.page,
      content: c.content,
      tf,
      len: tokens.length,
    }
  })

  // IDF
  const df = new Map<string, number>()
  for (const row of rows) {
    for (const t of row.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1)
  }
  const idf = new Map<string, number>()
  for (const [t, d] of df) idf.set(t, Math.log(1 + rows.length / d))

  lexCache = { at: Date.now(), rows, idf }
  return { rows, idf }
}

/** শব্দ-মিল ভিত্তিক রিট্রিভাল — ভেক্টর ইঞ্জিন না চললে ব্যবহার হয় */
export async function retrieveTopKLexical(
  question: string,
  subject: string | null | undefined,
  k = 3
): Promise<RetrievedChunk[]> {
  const { rows, idf } = await loadLexRows()
  if (!rows.length) return []

  const qTokens = tokenize(question)
  if (!qTokens.length) return []
  const qtf = new Map<string, number>()
  for (const t of qTokens) qtf.set(t, (qtf.get(t) ?? 0) + 1)

  const pool = subject ? rows.filter((r) => r.subject === subject) : rows
  const candidates = pool.length ? pool : rows

  const scored = candidates
    .map((r) => {
      let score = 0
      let matched = 0
      let rareHit = false // বিরল টার্ম (বেশিরভাগ চাঙ্কে নেই) — শক্তিশালী টপিক সিগন্যাল
      for (const [t, qn] of qtf) {
        const rowTf = r.tf.get(t)
        if (!rowTf) continue
        const w = idf.get(t) ?? 1
        score += rowTf * w * (1 + Math.log(qn))
        matched++
        if (w >= 1.2) rareHit = true
      }
      // লম্বা চাঙ্কের প্রতি পক্ষপাত কমানো — নরম দৈর্ঘ্য-নরমালাইজেশন (প্রতি ~১০০ টোকেন)
      score = score / Math.sqrt(Math.max(1, r.len / 100))
      return { r, score, matched, rareHit }
    })
    // দুর্বল/ভুল কনটেক্সট মডেলকে বিভ্রান্ত করে; তাই শক্তিশালী ম্যাচই দাও:
    // ২+ টার্ম মিললে, অথবা একটি বিরল টার্ম (যেমন "সালোকসংশ্লেষণ") মিললে
    .filter((x) => x.score > 0.8 && (x.matched >= 2 || x.rareHit))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)

  return scored.map((x) => ({
    book: x.r.book,
    chapter: x.r.chapter,
    page: x.r.page,
    content: x.r.content,
    snippet: x.r.content.slice(0, 160).trim(),
  }))
}
