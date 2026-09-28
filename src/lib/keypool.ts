import { db } from '@/lib/db'
import type { EngineId } from '@/lib/types'

/**
 * স্মার্ট কী-পুল (Zero-Cost Load Balancing) — Gemini ও Z.ai দুই ইঞ্জিনের জন্যই
 * - রাউন্ড-রবিন: প্রতিটি রিকোয়েস্ট পালা করে পুলের কী-তে যায়
 * - 429/5xx হলে চোখের পলকে পরের কী-তে সুইচ (স্টুডেন্ট কিছুই টের পায় না)
 * - 401/403 হলে কী-টি অ্যাক্টিভ পুল থেকে বাদ (নিষ্ক্রিয়) হয়ে যায়
 * - প্রতি ইঞ্জিনের নিজস্ব সার্কিট ব্রেকার: পুরো পুল ফেইল হলে সেই ইঞ্জিন ২ মিনিট স্কিপ
 */

export type PoolKey = { id: string; key: string }

type EngineState = {
  cache: { at: number; keys: PoolKey[] } | null
  rrIndex: number
  downUntil: number
}

const states: Record<EngineId, EngineState> = {
  gemini: { cache: null, rrIndex: 0, downUntil: 0 },
  zai: { cache: null, rrIndex: 0, downUntil: 0 },
}

// ব্রেকার ৪৫ সেকেন্ড — পুরো পুল একবার ফেইল হলে ৪৫ সে পর আবার সুযোগ নেয়।
// ফ্রি টিয়ারের রেট-লিমিট ~১৫ সেকেন্ডেই রিকভার করে, তাই ৪৫ নিরাপদ + queue-বান্ধব
const ENGINE_DOWN_MS = 45_000

export function isEngineHealthy(engine: EngineId): boolean {
  return Date.now() >= states[engine].downUntil
}

/** কোনো ইঞ্জিনের ব্রেকার ট্রিপ হলে সবচেয়ে আগে যেটা সুস্থ হবে — কত ms দূরে (সব সুস্থ হলে ০) */
export function nextEngineWakeMs(): number {
  const now = Date.now()
  const positive = (Object.keys(states) as EngineId[])
    .map((e) => states[e].downUntil - now)
    .filter((ms) => ms > 0)
  return positive.length ? Math.min(...positive) : 0
}

/** নির্দিষ্ট ইঞ্জিনের কী-ক্যাশ ভাঙো; engine না দিলে দুটোই */
export function invalidateKeyCache(engine?: EngineId): void {
  if (engine) states[engine].cache = null
  else {
    states.gemini.cache = null
    states.zai.cache = null
  }
}

export async function getActiveKeys(engine: EngineId): Promise<PoolKey[]> {
  const st = states[engine]
  if (st.cache && Date.now() - st.cache.at < 30_000) return st.cache.keys
  const rows = await db.apiKey.findMany({
    where: { active: true, engine },
    orderBy: { createdAt: 'asc' },
  })
  st.cache = { at: Date.now(), keys: rows.map((r) => ({ id: r.id, key: r.key })) }
  return st.cache.keys
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

/** ট্রানজিয়েন্ট (সাময়িক) ব্যর্থতা — অপেক্ষা করে আবার চেষ্টা করা যায় */
export function isTransientAiError(e: unknown): boolean {
  if (!(e instanceof GeminiError)) return false
  if (e.status === 429 || e.status === 503 || e.status === 500 || e.status === 502 || e.status === 529) return true
  return ['KEY_POOL_EXHAUSTED', 'ENGINE_DOWN', 'ALL_ENGINES_DOWN'].includes(e.message)
}

/** স্থায়ী ব্যর্থতা — অপেক্ষা করলেও ঠিক হবে না (কী নেই, সব বন্ধ, জিও-ব্লক) */
export function isPermanentAiError(e: unknown): boolean {
  if (!(e instanceof GeminiError)) return false
  return (
    e.message === 'NO_KEYS' ||
    e.message === 'NO_ENGINES_ENABLED' ||
    e.message === 'GEO_BLOCKED'
  )
}

/**
 * মডেল-স্পেসিফিক ব্যর্থতা — মডেল আইডি ভুল/মডেল আর নেই (HTTP 404 বা API-র
 * "model not found" ধরনের বার্তা)। কী বদলালেও লাভ নেই, তাই কী-লুপ/ব্রেকার না জ্বালিয়ে
 * সাথে সাথে ছাড়িয়ে দিতে হবে — ai-engine পরের চালু মডেল চেষ্টা করবে।
 */
const RESERVED_ERRORS = [
  'NO_KEYS',
  'NO_ENGINES_ENABLED',
  'GEO_BLOCKED',
  'ENGINE_DOWN',
  'KEY_POOL_EXHAUSTED',
  'ALL_ENGINES_DOWN',
  'ALL_MODELS_FAILED',
]
export function isModelNotFoundAiError(e: unknown): boolean {
  if (!(e instanceof GeminiError)) return false
  if (RESERVED_ERRORS.includes(e.message)) return false
  if (e.status === 404) return true
  return /model (not found|does not exist|is not (?:found|available|supported))|invalid model|model_not_found|unknown model/i.test(
    e.message
  )
}

export async function withKeyFailover<T>(engine: EngineId, fn: (key: string) => Promise<T>): Promise<T> {
  const st = states[engine]
  if (Date.now() < st.downUntil) {
    throw new GeminiError(503, 'ENGINE_DOWN')
  }

  let keys = await getActiveKeys(engine)
  if (keys.length === 0) throw new GeminiError(503, 'NO_KEYS')

  let lastErr: GeminiError | null = null

  for (let i = 0; i < keys.length; i++) {
    const idx = (st.rrIndex + i) % keys.length
    const poolKey = keys[idx]
    try {
      const out = await fn(poolKey.key)
      // সফল — পরের রিকোয়েস্ট পরের কী দিয়ে (রাউন্ড-রবিন)
      st.rrIndex = (idx + 1) % keys.length
      return out
    } catch (e) {
      const err = asGeminiError(e)
      lastErr = err

      // মডেলটাই ভুল/নেই — কী বদলানো বৃথা, ব্রেকারও ট্রিপ করবে না;
      // সাথে সাথে ছাড়িয়ে দাও যাতে পরের মডেল চেষ্টা হয়
      if (isModelNotFoundAiError(err)) throw err

      // জিও-ব্লক (লোকেশন সাপোর্টেড না) — সব কী-তে একই হবে, সাথে সাথে ব্রেকার ট্রিপ
      if (err.message === 'GEO_BLOCKED') {
        st.downUntil = Date.now() + ENGINE_DOWN_MS
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
        invalidateKeyCache(engine)
        keys = keys.filter((k) => k.id !== poolKey.id)
        i = -1 // বাকি কী-গুলো আবার স্ক্যান
        continue
      }

      // 400 — সাধারণত রিকোয়েস্টের দোষ, তবু একবার পরের কী চেষ্টা করা ভালো (কী-স্পেসিফিক অ্যাক্সেস হতে পারে)
      if (err.status === 400) continue

      throw err
    }
  }

  // পুরো পুল ফেইল — ব্রেকার ট্রিপ করে দাও (২ মিনিট পর আবার এই ইঞ্জিন চেষ্টা হবে)
  st.downUntil = Date.now() + ENGINE_DOWN_MS
  throw lastErr ?? new GeminiError(503, 'KEY_POOL_EXHAUSTED')
}
