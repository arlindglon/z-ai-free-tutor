import { db } from '@/lib/db'

export type AppSettings = {
  chatModel: string
  embeddingModel: string
  dailyCredits: number
}

/** ডিফল্ট: ফ্রি টিয়ারে চলে এমন আসল Gemini মডেল। অ্যাডমিন প্যানেল থেকে যেকোনো সময় বদলানো যায় */
export const DEFAULT_SETTINGS: AppSettings = {
  chatModel: 'gemini-3.5-flash-lite',
  embeddingModel: 'gemini-embedding-001', // 3072 ডাইমেনশন, মাল্টিমোডাল-ক্যাপাবল
  dailyCredits: 30,
}

let cache: { at: number; value: AppSettings } | null = null

export async function getSettings(): Promise<AppSettings> {
  if (cache && Date.now() - cache.at < 15_000) return cache.value
  const rows = await db.setting.findMany()
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const value: AppSettings = {
    chatModel: map.chatModel || DEFAULT_SETTINGS.chatModel,
    embeddingModel: map.embeddingModel || DEFAULT_SETTINGS.embeddingModel,
    dailyCredits: Number(map.dailyCredits) || DEFAULT_SETTINGS.dailyCredits,
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
  for (const [key, value] of entries) {
    await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } })
  }
  cache = null
  return getSettings()
}
