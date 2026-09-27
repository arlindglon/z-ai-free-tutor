import {
  getActiveKeys,
  GeminiError,
  withKeyFailover,
  isEngineHealthy,
  isTransientAiError,
  isPermanentAiError,
} from '@/lib/keypool'
import { generateContent, type GeneratedAnswer } from '@/lib/gemini'
import { zaiChat, zaiChatWithKey } from '@/lib/zai'
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

  // পাস ২+৩: ট্রানজিয়েন্ট ব্যর্থতা (রেট-লিমিট/ব্যস্ত) হলে অপেক্ষা করে আবার —
  // শিক্ষার্থীর প্রশ্ন queue-তে দাঁড়িয়ে থাকে, এরর দেখে না
  const WAITS = [2500, 4000]
  for (let pass = 0; !outcome.result && pass < WAITS.length; pass++) {
    if (outcome.err && isPermanentAiError(outcome.err)) break
    if (!outcome.err || !isTransientAiError(outcome.err)) break
    await new Promise((r) => setTimeout(r, WAITS[pass]))
    outcome = await runPass(order, prompt, system, settings)
  }

  if (outcome.result) return outcome.result
  if (outcome.blocked) return outcome.blocked // সব ইঞ্জিন সেফটি-ব্লক করেছে
  throw outcome.err ?? new GeminiError(503, 'ALL_ENGINES_DOWN')
}
