import {
  getActiveKeys,
  GeminiError,
  withKeyFailover,
  isEngineHealthy,
  isTransientAiError,
  isPermanentAiError,
  isModelNotFoundAiError,
  asGeminiError,
  nextEngineWakeMs,
} from '@/lib/keypool'
import { generateContent, type GeneratedAnswer, type ChatImage } from '@/lib/gemini'
import { zaiChat, zaiChatWithKey, tuneZaiCapacity, zaiDefaultModel, zaiEnvConfigured } from '@/lib/zai'
import { getActiveModelIds } from '@/lib/models'
import { DEFAULT_SETTINGS, type AppSettings } from '@/lib/settings'
import type { EngineId } from '@/lib/types'

/**
 * ইউনিফাইড ডুয়াল-ইঞ্জিন — Zero-Cost Load Balancing + নেভার-ফেইল নীতি:
 * ১. অ্যাডমিন সেটিংস অনুযায়ী মূল ইঞ্জিন (Gemini বা Z.ai) — দুটোরই নিজস্ব কী-পুল
 * ২. প্রতি ইঞ্জিনে অ্যাডমিনের মডেল রেজিস্ট্রির চালু মডেলগুলো পালা করে চেষ্টা হয় —
 *    ভুল/বন্ধ মডেল হলে নিঃশব্দে পরের মডেল (স্টুডেন্ট কিছুই টের পায় না)
 * ৩. মূল ইঞ্জিন ফেইল (কী নেই/রেট-লিমিট/এরর) → অন্য ইঞ্জিন (fallbackEnabled হলে)
 * ৪. ট্রানজিয়েন্ট ব্যর্থতা (রেট-লিমিট/ব্যস্ত) → অপেক্ষা করে আরও পাস — queue-র মতো
 * ৫. সেফটি-ব্লক হলে পরের ইঞ্জিন — শিক্ষার্থী কোনো টেকনিক্যাল এরর দেখবে না
 */
export type EngineResult = GeneratedAnswer & { engine: EngineId; modelId: string | null }

/** স্বাক্ষর-রাউটিং: প্রশ্নে অ্যাডমিনের কোড থাকলে এই ইঞ্জিন+মডেল সবার আগে চেষ্টা হয় */
export type ForceModel = { engine: EngineId; modelId: string }

type AttemptResult = GeneratedAnswer & { modelId: string | null }

/** এক ইঞ্জিনের চালু মডেলগুলো পালা করে চেষ্টা — সফল মডেলের আইডিসহ ফেরত */
async function attemptWithModels(
  engine: EngineId,
  prompt: string,
  system: string,
  settings: AppSettings,
  forceModelId?: string,
  image?: ChatImage
): Promise<AttemptResult> {
  const fallback =
    engine === 'gemini'
      ? settings.chatModel || DEFAULT_SETTINGS.chatModel
      : zaiDefaultModel()
  const registryModels = await getActiveModelIds(engine, fallback)
  // জেতা স্বাক্ষর-কোডের মডেল থাকলে তালিকার একেবারে আগে
  const models = forceModelId
    ? [forceModelId, ...registryModels.filter((m) => m !== forceModelId)]
    : registryModels

  let lastErr: unknown = null
  for (const model of models) {
    try {
      if (engine === 'gemini') {
        const keys = await getActiveKeys('gemini')
        if (keys.length === 0) throw new GeminiError(503, 'NO_KEYS')
        const r = await generateContent(prompt, system, model, image)
        return { ...r, modelId: model }
      }
      const keys = await getActiveKeys('zai')
      if (keys.length === 0) break // Z.ai কী নেই → নিচে sandbox/env পথ
      // key যত আছে তত slot খুলে দাও — key যোগ করলেই সাথে সাথে ক্ষমতা বাড়ে
      tuneZaiCapacity(keys.length)
      const text = await withKeyFailover('zai', (key) => zaiChatWithKey(key, system, prompt, model, image))
      return { text, blocked: false, modelId: model }
    } catch (e) {
      lastErr = e
      // মডেলটাই ভুল/নেই (404) → নিঃশব্দে পরের মডেল; বাকি এরর বাইরে — ইঞ্জিন-ফেইলওভার সামলাবে
      if (!isModelNotFoundAiError(asGeminiError(e))) throw e
    }
  }
  if (lastErr) throw lastErr

  // এখানে এলে দাঁড়ায় শুধু Z.ai: রেজিস্ট্রি খালি বা সব মডেল skip — DB পুল খালি মানে
  // env key (ZAI_API_KEY) বা sandbox credential — zaiChat ভিতরেই সামলায়
  // (sandbox SDK পথে মডেল প্যারাম কার্যকর না — তখন অডিটে মডেল null রাখাই সঠিক)
  const text = await zaiChat(system, prompt, forceModelId, image)
  return { text, blocked: false, modelId: forceModelId && zaiEnvConfigured() ? forceModelId : null }
}

// এক ইঞ্জিনে একবার চেষ্টা
interface PassOutcome {
  result: EngineResult | null
  blocked: EngineResult | null
  err: unknown
  /** কোনো এক ইঞ্জিন "কী নেই" (NO_KEYS) বলেছে — শেষ এররটা জেনেরিক হলেও এটা জানা জরুরি */
  noKeys: boolean
}

async function runPass(
  order: EngineId[],
  prompt: string,
  system: string,
  settings: AppSettings,
  force?: ForceModel,
  image?: ChatImage
): Promise<PassOutcome> {
  let blocked: EngineResult | null = null
  let err: unknown = null
  let noKeys = false
  for (const engine of order) {
    if (!isEngineHealthy(engine)) {
      err = new GeminiError(503, 'ENGINE_DOWN')
      continue
    }
    try {
      const r = await attemptWithModels(
        engine,
        prompt,
        system,
        settings,
        force && force.engine === engine ? force.modelId : undefined,
        image
      )
      if (!r.blocked && r.text.trim()) return { result: { ...r, engine }, blocked, err, noKeys }
      // সেফটি-ব্লক/খালি উত্তর — পরের ইঞ্জিন দেখো
      blocked = { ...r, engine }
    } catch (e) {
      err = e
      // "কী নেই" মনে রাখো — অন্য ইঞ্জিনের জেনেরিক এরর (যেমন Z.ai স্যান্ডবক্স ফেল)
      // এটাকে ঢেকে দিলে সিস্টেম ভুল করে ৯০ সেকেন্ড "ট্রানজিয়েন্ট" রিট্রাই করে ভুল
      // "ব্যস্ত" বার্তা দেখায়; আসলে সেটআপ-সমস্যা, সাথে সাথে সেটআপ-নোটিশ দেখানোই ঠিক
      if (e instanceof GeminiError && e.message === 'NO_KEYS') noKeys = true
      console.error(`[ai-engine] ${engine} failed:`, e instanceof Error ? e.message : e)
    }
  }
  return { result: null, blocked, err, noKeys }
}

export async function generateTutorAnswer(
  prompt: string,
  system: string,
  settings: AppSettings,
  force?: ForceModel,
  image?: ChatImage
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

  // স্বাক্ষর-রাউটিং: প্রশ্নে অ্যাডমিনের দেওয়া কোড থাকলে সেই ইঞ্জিন লাইনের একেবারে সামনে
  if (force && order.includes(force.engine)) {
    order.splice(order.indexOf(force.engine), 1)
    order.unshift(force.engine)
  }

  // পাস ১
  let outcome = await runPass(order, prompt, system, settings, force, image)

  // কোনো ইঞ্জিন "কী নেই" বলেছে আর ফলাফলও নেই → এটা সেটআপ-সমস্যা, ট্রানজিয়েন্ট নয়।
  // সাথে সাথে NO_KEYS ছুঁড়ে দাও — নইলে অন্য ইঞ্জিনের জেনেরিক এররকে "ব্যস্ত" ভেবে
  // ৯০ সেকেন্ড অর্থহীন রিট্রাই চলে আর শিক্ষার্থী ভুল "ব্যস্ত" বার্তা দেখে।
  if (!outcome.result && outcome.noKeys) {
    throw new GeminiError(503, 'NO_KEYS')
  }

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
    outcome = await runPass(order, prompt, system, settings, force, image)
    pass++
  }

  if (outcome.result) return outcome.result
  if (outcome.blocked) return outcome.blocked // সব ইঞ্জিন সেফটি-ব্লক করেছে
  throw outcome.err ?? new GeminiError(503, 'ALL_ENGINES_DOWN')
}
