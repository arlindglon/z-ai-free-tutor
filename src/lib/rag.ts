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

/* ------------------------------------------------------------------ */
/* RAG লক (শুধু বই থেকে উত্তর) — সার্ভার-সাইড কঠোর এনফোর্সমেন্ট            */
/* ------------------------------------------------------------------ */

/** RAG লকে বইয়ের বাইরের প্রশ্নে ঠিক এই বাক্যটাই যাবে — মডেল কল ছাড়াই (১০০% লিক-প্রুফ) */
export const RAG_REFUSAL_TEXT =
  'এই প্রশ্নের উত্তর পাঠ্যবইয়ে (আপলোড করা বইগুলোতে) পাইনি 📖 — বইয়ের কোনো প্রশ্ন করো, অথবা অ্যাডমিনকে বইটি যোগ করতে বলো।'

/** গেট ২: মডেলের উত্তর বই থেকে এসেছে কি না যাচাই না হলে — এই বার্তাটাই যাবে */
export const RAG_UNGROUNDED_TEXT =
  'এই প্রশ্নের নির্ভরযোগ্য উত্তর পাঠ্যবইয়ের (আপলোড করা বইয়ের) ভেতরে পাইনি 📖 — বইয়ের কোনো প্রশ্ন করো, অথবা অ্যাডমিনকে বইটি যোগ করতে বলো।'

/**
 * উত্তর-কনট্রাক্ট যাচাই: RAG লকে মডেলের উত্তর আসলেই বইয়ের refs থেকে এসেছে কি না।
 * ১) পরিষ্কার প্রত্যাখ্যান ("পাইনি/তথ্য নেই") হলে বৈধ — ফুটার না থাকলেও।
 * ২) নইলে লেক্সিক্যাল grounding: উত্তরের কনটেন্ট-শব্দ (স্বরচিহ্ন-নরমালাইজড) কত শতাংশ
 *    refs-এর কর্পাসে আছে। ফুটার থাকলেও বানানো তথ্য (কম কভারেজ) ধরা পড়ে —
 *    কারণ মডেল ভুয়া উত্তরের শেষেও ফুটার লাগিয়ে দিতে পারে (লাইভ টেস্টে ধরা পড়েছে)।
 */
const BN_STRIP = /[\u0981-\u0983\u09BC\u09BE-\u09CC\u09CD\u09D7\u200C\u200D]/g

function normToken(token: string): string {
  return token
    .replace(BN_STRIP, '')
    .replace(/\u09DC/g, '\u09A1')
    .replace(/\u09DD/g, '\u09A2')
    .replace(/\u09DF/g, '\u09AF')
    .replace(/\u09CE/g, '\u09A4')
    .toLowerCase()
}

/** উত্তরে এমন শব্দ যা সংযোগকারী — এগুলো refs-এ না থাকলেও দোষ নয় */
const COVER_STOPWORDS = new Set([
  ...STOPWORDS,
  ...[
    'উত্তর', 'প্রশ্ন', 'ব্যাখ্যা', 'ধাপ', 'উদাহরণ', 'সহজ', 'কথায়', 'বলতে', 'বোঝায়', 'বোঝাও',
    'একটি', 'দেখায়', 'মোট', 'প্রতিটি', 'প্রত্যেক', 'নিচে', 'উপরে', 'মানে', 'অর্থাৎ', 'লিখে',
    'দেওয়া', 'নেওয়া', 'হয়ে', 'গিয়ে', 'পরে', 'আগে', 'ভিতরে', 'বাইরে', 'কোনো', 'কিছু', 'সব',
    'দুটি', 'তিনটি', 'চারটি', 'পাঁচটি', 'প্রথম', 'দ্বিতীয়', 'তৃতীয়', 'চতুর্থ', 'পঞ্চম',
    'শেষে', 'মধ্য', 'বিষয়ে', 'প্রয়োজন', 'এখন', 'খুব', 'বেশি', 'কম', 'সবচেয়ে', 'অন্য', 'অনেক',
    'সাধারণ', 'বিশেষ', 'তখন', 'এখনো', 'যেমন', 'তেমন', 'কেননা', 'জন্যে', 'দিকে', 'কাছে',
    'text', 'frac', 'times', 'sqrt', 'div', 'left', 'right', 'cdot', 'begin', 'end',
  ].map(normToken),
])

/** পরিষ্কার প্রত্যাখ্যান-বাক্য চেনার প্যাটার্ন (ফুটার ছাড়া) */
const REFUSAL_PATTERN =
  /পাইনি|পাওয়া\s*যায়নি|পাওয়া\s*যায়\s*নি|পাওয়া\s*যায়\s*না|তথ্য\s*(কোনো\s*)?নেই|বইয়ে\s*(এই\s*)?(বিষয়ে\s*)?নেই|বইয়ে\s*উল্লেখ\s*নেই|উত্তর\s*নেই|নেই\s*বইয়ে/

/** একটি টেক্সটের কনটেন্ট-টোকেন (নরমালাইজড, স্টপওয়ার্ড/সংখ্যা বাদ) */
function contentTokens(text: string): string[] {
  const raw = text.match(/[\p{L}\p{N}]+/gu) ?? []
  return raw
    .filter((t) => !/^\d+$/.test(t) && t.length >= 2)
    .map(normToken)
    .filter((t) => t.length >= 2 && !COVER_STOPWORDS.has(t))
}

/**
 * একটি উত্তর-টোকেনের কর্পাস-মিল (০–১)।
 * OCR/পিডিএফ-ক্ষতিগ্রস্ত বইয়ে স্বরচিহ্ন ভেঙে যায় ("শক্তি"→"শক্যা") — তাই
 * সাধারণ prefix-এ আংশিক ক্রেডিট দিলে বইয়ে থাকা সঠিক উত্তর মিস হয় না,
 * আর সম্পূর্ণ বানানো শব্দ (S-ধাপ, সেন্ট্রোমিয়ার…) তবুও ০-ই থাকে।
 */
function tokenMatchScore(token: string, corpus: Set<string>): number {
  if (corpus.has(token)) return 1
  const len = token.length
  if (len < 3) return 0
  const p3 = token.slice(0, 3)
  const p2 = token.slice(0, 2)
  for (const c of corpus) {
    if (c.length >= 3 && c.slice(0, 3) === p3) return 0.7
  }
  for (const c of corpus) {
    if (c.length >= 3 && c.slice(0, 2) === p2) return 0.4
  }
  return 0
}

/** refs কর্পাসে উত্তরের কনটেন্ট-টোকেন কভারেজ (০–১) — লগ/টিউনিংয়ের জন্য আলাদা export */
export function bookCoverage(
  answerText: string,
  refs: Pick<RetrievedChunk, 'content' | 'book' | 'chapter' | 'page'>[]
): number {
  if (!refs.length) return 1
  const corpus = new Set<string>()
  for (const r of refs) {
    for (const t of contentTokens(`${r.book} ${r.chapter} ${r.page ?? ''} ${r.content}`)) {
      corpus.add(t)
    }
  }
  if (!corpus.size) return 1

  const answerTokens = [...new Set(contentTokens(answerText))]
  if (answerTokens.length < 4) return 1 // যাচাই করার মতো কনটেন্ট নেই — ছোট উত্তর ছেড়ে দাও

  let score = 0
  for (const t of answerTokens) score += tokenMatchScore(t, corpus)
  return score / answerTokens.length
}

export function answerGroundedInBook(
  answerText: string,
  refs: Pick<RetrievedChunk, 'content' | 'book' | 'chapter' | 'page'>[],
  threshold = 0.45
): boolean {
  // ১) পরিষ্কার প্রত্যাখ্যান — ফুটার না থাকলে বৈধ (ফুটার+প্রত্যাখ্যান মিশ্রণ হলে নিচে যাচাই হবে)
  if (REFUSAL_PATTERN.test(answerText) && !/বইয়ের\s*রেফারেন্স/.test(answerText)) return true
  // ২) লেক্সিক্যাল grounding — বানানো তথ্যের কভারেজ কম হয়
  return bookCoverage(answerText, refs) >= threshold
}

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
