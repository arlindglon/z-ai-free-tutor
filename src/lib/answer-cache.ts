import { db } from '@/lib/db'
import type { BookReference } from '@/lib/types'

/**
 * ⚡ উত্তর-ক্যাশ — ফ্রি টিয়ারের সবচেয়ে বড় অস্ত্র:
 * পরীক্ষার প্রশ্ন হাজারবার রিপিট হয় — "SSC-র পানির ঘনত্ব" এক বছরে ৫০০ জন জিজ্ঞেস করলেও
 * প্রথম উত্তরটা একবারই ইঞ্জিনে যায়, বাকি সব ক্যাশ থেকে (খরচ শূন্য)।
 *
 * দুই-স্তরের মিল:
 *  ১. হুবহু মিল — নরমালাইজড প্রশ্ন-কী (qNorm) — ক্যাশ-টেবিলের ইনডেক্সড লুকআপ, প্রায় শূন্য খরচ
 *  ২. প্রায়-হুবহু মিল — প্রশ্ন-এমবেডিং cosine সাদৃশ্য ≥ 0.95 (একই embeddingModel) —
 *     "ভূমি কর্ষণ কাকে বলে?" ↔ "ভূমি কর্ষণ কাকে বলে ?" ↔ ছোটখাটো ভুল-বানান
 *
 * নিয়ম:
 *  - প্রত্যাখ্যান ("পাইনি 📖") কখনো ক্যাশ হয় না — বই যোগ হলে একই প্রশ্নের উত্তর আসা উচিত
 *  - ছবি-প্রশ্ন ক্যাশে যায় না (উত্তর ছবির উপর নির্ভরশীল)
 *  - RAG লক চালু অবস্থায় লক-বন্ধ ক্যাশ থেকে উত্তর দেওয়া হয় না (ragOnly পতাকা)
 */

/** সাদৃশ্য-থ্রেশহোল্ড — ইউজারের স্পেক: > 0.95 */
export const CACHE_SIM_THRESHOLD = 0.95

/** semantic মিলের জন্য সর্বোচ্চ কত পুরনো ক্যাশ-রো ভেক্টর-তুলনায় দেখা হবে (JSON পার্স-খরচ সীমিত রাখতে) */
const SEMANTIC_SCAN_LIMIT = 300

/** নরমালাইজড প্রশ্ন-কী — ছোট-বড় হাতের, স্পেস, যতিচিহ্ন, বাংলা-ইংরেজি সংখ্যা এক রূপে */
export function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[।,;:!?'"()\[\]{}\-–—…."]/g, '')
    .replace(/[?؟]/g, '')
    .replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)))
    .trim()
}

function cosineSim(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export type CachedAnswer = {
  id: string
  answer: string
  answerTag: string | null
  references: BookReference[]
  /** হুবহু মিল (true) নাকি এমবেডিং-সাদৃশ্যে মিল (false) */
  exact: boolean
}

type CacheRow = {
  id: string
  question: string
  qNorm: string
  embedding: number[] | null
  embeddingModel: string
  answer: string
  answerTag: string | null
  references: BookReference[] | null
  ragOnly: boolean
}

// ছোট ইন-মেমরি ক্যাশ (rag.ts-এর চাঙ্ক-ক্যাশ প্যাটার্ন) — JSON-ভেক্টর বারবার পার্স না-করতে
let memRows: CacheRow[] = []
let memAt = 0
const MEM_TTL_MS = 60_000

function invalidateMem(): void {
  memRows = []
  memAt = 0
}

async function loadRows(): Promise<CacheRow[]> {
  const now = Date.now()
  if (memRows.length > 0 && now - memAt < MEM_TTL_MS) return memRows
  const rows = await db.answerCache.findMany({
    orderBy: { createdAt: 'desc' },
    take: SEMANTIC_SCAN_LIMIT,
    select: {
      id: true,
      question: true,
      qNorm: true,
      embedding: true,
      embeddingModel: true,
      answer: true,
      answerTag: true,
      references: true,
      ragOnly: true,
    },
  })
  memRows = rows.map((r) => ({
    ...r,
    embedding: Array.isArray(r.embedding) ? (r.embedding as number[]) : null,
    references: (r.references as BookReference[] | null) ?? null,
  }))
  memAt = now
  return memRows
}

/** ক্যাশে খোঁজো — আগে হুবহু মিল, না পেলে এমবেডিং-সাদৃশ্য (queryVec থাকলে)।
 *  serveUnderRagOnly: এখন RAG লক চালু কি না — চালু থাকলে লক-বন্ধ (ragOnly=false) ক্যাশ বাদ। */
export async function findCachedAnswer(
  question: string,
  queryVec: number[] | null,
  embeddingModel: string,
  serveUnderRagOnly: boolean
): Promise<CachedAnswer | null> {
  const qNorm = normalizeQuestion(question)
  if (!qNorm) return null

  const rows = await loadRows()

  // ১) হুবহু মিল — সবচেয়ে সস্তা ও নিরাপদ
  const exact = rows.find((r) => r.qNorm === qNorm)
  if (exact && (exact.ragOnly || !serveUnderRagOnly)) {
    return {
      id: exact.id,
      answer: exact.answer,
      answerTag: exact.answerTag,
      references: exact.references ?? [],
      exact: true,
    }
  }

  // ২) এমবেডিং-সাদৃশ্য — একই মডেলের ভেক্টরেই তুলনা সম্ভব
  if (!queryVec || queryVec.length === 0) return null
  let best: { row: CacheRow; sim: number } | null = null
  for (const r of rows) {
    if (!r.ragOnly && serveUnderRagOnly) continue
    if (r.embeddingModel !== embeddingModel) continue
    const sim = cosineSim(queryVec, r.embedding ?? [])
    if (sim >= CACHE_SIM_THRESHOLD && sim > (best?.sim ?? 0)) best = { row: r, sim }
  }
  if (best) {
    return {
      id: best.row.id,
      answer: best.row.answer,
      answerTag: best.row.answerTag,
      references: best.row.references ?? [],
      exact: false,
    }
  }
  return null
}

/** ক্যাশ-হিট গোনা + lastHitAt আপডেট — ব্যর্থ হলেও উত্তর-প্রবাহ আটকাবে না */
export async function recordCacheHit(id: string): Promise<void> {
  await db.answerCache
    .update({ where: { id }, data: { hits: { increment: 1 }, lastHitAt: new Date() } })
    .catch(() => {})
  const row = memRows.find((r) => r.id === id)
  if (row) row.qNorm = row.qNorm // মেমরি-রো অক্ষত; hits গণনা DB-তেই
}

/** সফল (প্রত্যাখ্যান-বিহীন) উত্তর ক্যাশে জমা — ভেক্টর না থাকলেও হুবহু-মিল কাজ করবে */
export async function saveToCache(input: {
  question: string
  answer: string
  answerTag: string | null
  references: BookReference[]
  embedding: number[] | null
  embeddingModel: string
  ragOnly: boolean
}): Promise<void> {
  const qNorm = normalizeQuestion(input.question)
  if (!qNorm) return
  try {
    await db.answerCache.create({
      data: {
        question: input.question.slice(0, 2000),
        qNorm,
        embedding: input.embedding && input.embedding.length > 0 ? input.embedding : undefined,
        embeddingModel: input.embedding && input.embedding.length > 0 ? input.embeddingModel : '',
        answer: input.answer,
        answerTag: input.answerTag,
        references: input.references,
        ragOnly: input.ragOnly,
      },
    })
    invalidateMem()
  } catch {
    // ক্যাশ-সেভ ফেল করলেও উত্তর যাবেই — ক্যাশ বোনাস, বাধা নয়
  }
}
