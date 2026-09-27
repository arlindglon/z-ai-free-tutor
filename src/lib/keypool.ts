import { db } from '@/lib/db'

/**
 * স্মার্ট কী-পুল (Zero-Cost Load Balancing)
 * - রাউন্ড-রবিন: প্রতিটি রিকোয়েস্ট পালা করে পুলের কী-তে যায়
 * - 429/5xx হলে চোখের পলকে পরের কী-তে সুইচ (স্টুডেন্ট কিছুই টের পায় না)
 * - 401/403 হলে কী-টি অ্যাক্টিভ পুল থেকে বাদ (নিষ্ক্রিয়) হয়ে যায়
 */

export type PoolKey = { id: string; key: string }

let cached: { at: number; keys: PoolKey[] } | null = null
let rrIndex = 0
// সার্কিট ব্রেকার: পুরো পুল ফেইল (জিও-ব্লক/রেট-লিমিট) হলে কিছুক্ষণ জেমিনাই স্কিপ করে
// সরাসরি z-ai ফলব্যাকে যাওয়া হয় — স্টুডেন্টকে অপেক্ষা করাতে হয় না
let engineDownUntil = 0
const ENGINE_DOWN_MS = 120_000

export function isEngineHealthy(): boolean {
  return Date.now() >= engineDownUntil
}

export function invalidateKeyCache(): void {
  cached = null
}

export async function getActiveKeys(): Promise<PoolKey[]> {
  if (cached && Date.now() - cached.at < 30_000) return cached.keys
  const rows = await db.apiKey.findMany({ where: { active: true }, orderBy: { createdAt: 'asc' } })
  cached = { at: Date.now(), keys: rows.map((r) => ({ id: r.id, key: r.key })) }
  return cached.keys
}

export class GeminiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'GeminiError'
    this.status = status
  }
}

/** GeminiError না হলে র‍্যাপ করে দাও */
export function asGeminiError(e: unknown): GeminiError {
  if (e instanceof GeminiError) return e
  const msg = e instanceof Error ? e.message : String(e)
  return new GeminiError(500, msg.slice(0, 200))
}

export async function withKeyFailover<T>(fn: (key: string) => Promise<T>): Promise<T> {
  if (Date.now() < engineDownUntil) {
    throw new GeminiError(503, 'ENGINE_DOWN')
  }

  let keys = await getActiveKeys()
  if (keys.length === 0) throw new GeminiError(503, 'NO_KEYS')

  let lastErr: GeminiError | null = null

  for (let i = 0; i < keys.length; i++) {
    const idx = (rrIndex + i) % keys.length
    const poolKey = keys[idx]
    try {
      const out = await fn(poolKey.key)
      // সফল — পরের রিকোয়েস্ট পরের কী দিয়ে (রাউন্ড-রবিন)
      rrIndex = (idx + 1) % keys.length
      return out
    } catch (e) {
      const err = asGeminiError(e)
      lastErr = err

      // জিও-ব্লক (লোকেশন সাপোর্টেড না) — সব কী-তে একই হবে, সাথে সাথে ব্রেকার ট্রিপ
      if (err.message === 'GEO_BLOCKED') {
        engineDownUntil = Date.now() + ENGINE_DOWN_MS
        throw err
      }

      // রেট লিমিট / সার্ভার ব্যস্ত → নির্দ্বিধায় পরের কী-তে
      if (err.status === 429 || err.status === 500 || err.status === 503) continue

      // কী-ই ভুল/নিষ্ক্রিয় → পুল থেকে বাদ দাও, পরের কী দিয়ে চালাও
      if (err.status === 401 || err.status === 403) {
        await db.apiKey
          .update({
            where: { id: poolKey.id },
            data: { active: false, lastError: `HTTP ${err.status}: ${err.message.slice(0, 190)}` },
          })
          .catch(() => {})
        invalidateKeyCache()
        keys = keys.filter((k) => k.id !== poolKey.id)
        i = -1 // বাকি কী-গুলো আবার স্ক্যান
        continue
      }

      // 400 — সাধারণত রিকোয়েস্টের দোষ, তবু একবার পরের কী চেষ্টা করা ভালো (কী-স্পেসিফিক অ্যাক্সেস হতে পারে)
      if (err.status === 400) continue

      throw err
    }
  }

  // পুরো পুল ফেইল — ব্রেকার ট্রিপ করে দাও (২ মিনিট পর আবার জেমিনাই চেষ্টা হবে)
  engineDownUntil = Date.now() + ENGINE_DOWN_MS
  throw lastErr ?? new GeminiError(503, 'KEY_POOL_EXHAUSTED')
}
