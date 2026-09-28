import { db } from '@/lib/db'
import type { EngineId } from '@/lib/types'

export type AppSettings = {
  chatModel: string
  embeddingModel: string
  dailyCredits: number
  primaryEngine: EngineId
  geminiEnabled: boolean
  zaiEnabled: boolean
  fallbackEnabled: boolean
  /** উত্তরের স্বাক্ষর পুল — প্রতি লাইনে একটা নাম/কোড, যত খুশি (নিউলাইন-সেপারেটেড) */
  tagNameGemini: string
  tagNameZai: string
  /** RAG লক — চালু থাকলে শুধু বইয়ের রেফারেন্স থেকেই উত্তর দেবে */
  ragOnlyMode: boolean
}

/** ডিফল্ট: ফ্রি টিয়ারে চলে এমন আসল Gemini মডেল। অ্যাডমিন প্যানেল থেকে যেকোনো সময় বদলানো যায় */
export const DEFAULT_SETTINGS: AppSettings = {
  chatModel: 'gemini-3.5-flash-lite',
  embeddingModel: 'gemini-embedding-001', // 3072 ডাইমেনশন, মাল্টিমোডাল-ক্যাপাবল
  dailyCredits: 30,
  primaryEngine: 'gemini',
  geminiEnabled: true,
  zaiEnabled: true,
  fallbackEnabled: true,
  tagNameGemini: '',
  tagNameZai: '',
  ragOnlyMode: false,
}

let cache: { at: number; value: AppSettings } | null = null

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === '') return fallback
  return v === 'true'
}

export async function getSettings(): Promise<AppSettings> {
  if (cache && Date.now() - cache.at < 15_000) return cache.value
  const rows = await db.setting.findMany()
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const value: AppSettings = {
    chatModel: map.chatModel || DEFAULT_SETTINGS.chatModel,
    embeddingModel: map.embeddingModel || DEFAULT_SETTINGS.embeddingModel,
    dailyCredits: Number(map.dailyCredits) || DEFAULT_SETTINGS.dailyCredits,
    primaryEngine: map.primaryEngine === 'zai' ? 'zai' : 'gemini',
    geminiEnabled: parseBool(map.geminiEnabled, DEFAULT_SETTINGS.geminiEnabled),
    zaiEnabled: parseBool(map.zaiEnabled, DEFAULT_SETTINGS.zaiEnabled),
    fallbackEnabled: parseBool(map.fallbackEnabled, DEFAULT_SETTINGS.fallbackEnabled),
    tagNameGemini: map.tagNameGemini ?? DEFAULT_SETTINGS.tagNameGemini,
    tagNameZai: map.tagNameZai ?? DEFAULT_SETTINGS.tagNameZai,
    ragOnlyMode: parseBool(map.ragOnlyMode, DEFAULT_SETTINGS.ragOnlyMode),
  }
  cache = { at: Date.now(), value }
  return value
}

export async function putSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const entries: [string, string][] = []
  if (patch.chatModel?.trim()) entries.push(['chatModel', patch.chatModel.trim()])
  if (patch.embeddingModel?.trim()) entries.push(['embeddingModel', patch.embeddingModel.trim()])
  if (patch.dailyCredits !== undefined && Number(patch.dailyCredits) > 0 && Number(patch.dailyCredits) <= 1000) {
    entries.push(['dailyCredits', String(Math.floor(Number(patch.dailyCredits)))])
  }
  if (patch.primaryEngine === 'gemini' || patch.primaryEngine === 'zai') {
    entries.push(['primaryEngine', patch.primaryEngine])
  }
  if (typeof patch.geminiEnabled === 'boolean') entries.push(['geminiEnabled', String(patch.geminiEnabled)])
  if (typeof patch.zaiEnabled === 'boolean') entries.push(['zaiEnabled', String(patch.zaiEnabled)])
  if (typeof patch.fallbackEnabled === 'boolean') entries.push(['fallbackEnabled', String(patch.fallbackEnabled)])
  // স্বাক্ষর পুল — খালি করার সুবিধাও দরকার, তাই undefined ছাড়া সব সেভ হয় (সর্বোচ্চ ৪০০০ অক্ষর)
  if (patch.tagNameGemini !== undefined) entries.push(['tagNameGemini', patch.tagNameGemini.slice(0, 4000)])
  if (patch.tagNameZai !== undefined) entries.push(['tagNameZai', patch.tagNameZai.slice(0, 4000)])
  if (typeof patch.ragOnlyMode === 'boolean') entries.push(['ragOnlyMode', String(patch.ragOnlyMode)])
  for (const [key, value] of entries) {
    await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } })
  }
  cache = null
  return getSettings()
}

/**
 * স্বাক্ষর পুল (নিউলাইন-সেপারেটেড) থেকে র‍্যান্ডম একটা নাম/কোড বেছে দেয়।
 * পুল খালি হলে null — তখন উত্তরে কোনো স্বাক্ষর যোগ হয় না।
 */
export function pickTagName(pool: string): string | null {
  const names = pool
    .split('\n')
    .map((n) => n.trim())
    .filter(Boolean)
    .slice(0, 500) // সেফটি ক্যাপ — ব্যাকএন্ড হিসেব সহজ রাখতে
  if (names.length === 0) return null
  return names[Math.floor(Math.random() * names.length)]
}
