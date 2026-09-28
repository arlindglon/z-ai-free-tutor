import {
  getActiveKeys,
  GeminiError,
  withKeyFailover,
  isEngineHealthy,
  isTransientAiError,
  isPermanentAiError,
  nextEngineWakeMs,
} from '@/lib/keypool'
import { generateContent, type GeneratedAnswer } from '@/lib/gemini'
import { zaiChat, zaiChatWithKey, tuneZaiCapacity } from '@/lib/zai'
import type { AppSettings } from '@/lib/settings'
import type { EngineId } from '@/lib/types'

/**
 * ইউনিফাইড ডুয়াল-ইঞ্জিন — Zero-Cost Load Balancing + নেভার-ফেইল নীতি:
 * ১. অ্যাডমিন সেটিংস অনুযায়ী মূল ইঞ্জিন (Gemini বা Z.ai) — দুটোরই নিজস্ব কী-পুল
 * ২. মূল ইঞ্জিন ফেইল (কী নেই/রেট-লিমিট/এরর) → অন্য ইঞ্জিন (fallbackEnabled হলে)
 * ৩. ট্রানজিয়েন্ট ব্যর্থতা (রেট-লিমিট/ব্যস্ত) → অপেক্ষা করে আরও ২ পাস — queue-র মতো
 * ৪. সেফটি-ব্লক হলে পরের ইঞ্জিন — শিক্ষার্থী কোনো টেকনিক্যাল এরর দেখবে না
 */
export type EngineResult = GeneratedAnswer & { engine: EngineId }

// এক ইঞ্জিনে একবার চেষ্টা
async function attempt(
  engine: EngineId,
  prompt: string,
  system: string,
  settings: AppSettings
): Promise<GeneratedAnswer> {
  if (engine === 'gemini') {
    const keys = await getActiveKeys('gemini')
    if (keys.length === 0) throw new GeminiError(503, 'NO_KEYS')
    return generateContent(prompt, system, settings.chatModel)
  }
  const keys = await getActiveKeys('zai')
  if (keys.length > 0) {
    // key যত আছে তত slot খুলে দাও — key যোগ করলেই সাথে সাথে ক্ষমতা বাড়ে
    tuneZaiCapacity(keys.length)
    const text = await withKeyFailover('zai', (key) => zaiChatWithKey(key, system, prompt))
    return { text, blocked: false }
  }
  // DB পুল খালি → env key (ZAI_API_KEY) বা sandbox credential — zaiChat ভিতরেই সামলায়
  const text = await zaiChat(system, prompt)
  return { text, blocked: false }
}

interface PassOutcome {
  result: EngineResult | null
  blocked: EngineResult | null
  err: unknown
}

async function runPass(
  order: EngineId[],
  prompt: string,
  system: string,
  settings: AppSettings
): Promise<PassOutcome> {
  let blocked: EngineResult | null = null
  let err: unknown = null
  for (const engine of order) {
    if (!isEngineHealthy(engine)) {
      err = new GeminiError(503, 'ENGINE_DOWN')
      continue
    }
    try {
      const r = await attempt(engine, prompt, system, settings)
      if (!r.blocked && r.text.trim()) return { result: { ...r, engine }, blocked, err }
      // সেফটি-ব্লক/খালি উত্তর — পরের ইঞ্জিন দেখো
      blocked = { ...r, engine }
    } catch (e) {
      err = e
      console.error(`[ai-engine] ${engine} failed:`, e instanceof Error ? e.message : e)
    }
  }
  return { result: null, blocked, err }
}

export async function generateTutorAnswer(
  prompt: string,
  system: string,
  settings: AppSettings
): Promise<EngineResult> {
  const primary: EngineId = settings.primaryEngine === 'zai' ? 'zai' : 'gemini'
  const secondary: EngineId = primary === 'gemini' ? 'zai' : 'gemini'
  const enabled: Record<EngineId, boolean> = {
    gemini: settings.geminiEnabled,
    zai: settings.zaiEnabled,
  }

  const order: EngineId[] = []
  if (enabled[primary]) order.push(primary)
  if (settings.fallbackEnabled && enabled[secondary] && !order.includes(secondary)) {
    order.push(secondary)
  }
  if (order.length === 0) throw new GeminiError(503, 'NO_ENGINES_ENABLED')

  // পাস ১
  let outcome = await runPass(order, prompt, system, settings)

  // পাস ২+: ট্রানজিয়েন্ট ব্যর্থতা (রেট-লিমিট/ব্যস্ত/ব্রেকার) → deadline-ভিত্তিক queue:
  // - ছোট ঝামেলা হলে ছোট অপেক্ষা (jitter সহ)
  // - কোনো ইঞ্জিনের ব্রেকার ট্রিপ থাকলে তার মেয়াদ শেষ না হওয়া পর্যন্ত অপেক্ষা (সর্বোচ্চ ২৫ সে)
  // - মোট ~৯০ সেকেন্ড ধৈর্য — এর মধ্যে ফ্রি টিয়ারের রেট-লিমিট কয়েকবার রিকভার করে
  // শিক্ষার্থীর প্রশ্ন পুরো সময়টা queue-তে দাঁড়িয়ে থাকে, এরর দেখে না
  const DEADLINE_MS = 90_000
  const start = Date.now()
  const WAITS = [1500, 3000, 5000, 8000, 12000, 15000, 20000, 25000]
  let pass = 0
  while (!outcome.result && pass < WAITS.length && Date.now() - start < DEADLINE_MS) {
    if (outcome.err && isPermanentAiError(outcome.err)) break
    if (!outcome.err || !isTransientAiError(outcome.err)) break
    const wake = nextEngineWakeMs()
    const wait = Math.max(WAITS[pass] + Math.floor(Math.random() * 500), Math.min(wake, 25_000))
    await new Promise((r) => setTimeout(r, wait))
    outcome = await runPass(order, prompt, system, settings)
    pass++
  }

  if (outcome.result) return outcome.result
  if (outcome.blocked) return outcome.blocked // সব ইঞ্জিন সেফটি-ব্লক করেছে
  throw outcome.err ?? new GeminiError(503, 'ALL_ENGINES_DOWN')
}
