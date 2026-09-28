import { db } from '@/lib/db'
import type { EngineId } from '@/lib/types'

/**
 * মডেল রেজিস্ট্রি — ইঞ্জিন প্রতি চ্যাট মডেলের তালিকা, সম্পূর্ণ অ্যাডমিন-নিয়ন্ত্রিত:
 * - বাজারে নতুন মডেল এলে অ্যাডমিন প্যানেল থেকেই নাম যোগ/বদল — কোড ছোঁয়ার দরকার নেই
 * - প্রতিটা মডেলের নিজস্ব on/off সুইচ + স্বাক্ষর পুল (যত খুশি নাম/কোড, লাইন বাই লাইন)
 * - উত্তর দেওয়ার সময় জেতা মডেলের পুল থেকে র‍্যান্ডম একটা নাম/কোড উত্তরে বসে —
 *   স্টুডেন্ট শুধু নাম দেখে (আসল মডেল বোঝে না), অ্যাডমিন নাম দেখে মডেল ধরতে পারে
 * - স্টুডেন্ট প্রশ্নে কোনো স্বাক্ষর-কোড লিখলে সেই মডেল/ইঞ্জিনেই উত্তর রাউট হয়
 */

/** প্রথমবার সিড হওয়া ডিফল্ট মডেল — Z.ai ফ্রি ফ্ল্যাশ + গুগল ফ্রি টিয়ার (API আইডি ছোট হাতের) */
export const DEFAULT_MODELS: { engine: EngineId; modelId: string; label: string }[] = [
  { engine: 'zai', modelId: 'glm-4.7-flash', label: 'GLM-4.7-Flash' },
  { engine: 'zai', modelId: 'glm-4.5-flash', label: 'GLM-4.5-Flash' },
  { engine: 'zai', modelId: 'glm-4.6v-flash', label: 'GLM-4.6V-Flash' },
  { engine: 'gemini', modelId: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
  { engine: 'gemini', modelId: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
  { engine: 'gemini', modelId: 'gemma-4-26b', label: 'Gemma 4 26B' },
  { engine: 'gemini', modelId: 'gemma-4-31b', label: 'Gemma 4 31B' },
]

const CACHE_TTL_MS = 15_000
const ALIAS_CACHE_LIMIT = 2000 // সেফটি ক্যাপ — স্বাক্ষর যত খুশি হোক, ক্যাশে সর্বোচ্চ এতগুলো

type ActiveModel = { id: string; modelId: string }

type AliasEntry = {
  /** আসল টেক্সট — উত্তরের ব্যাজে এটাই দেখাবে */
  text: string
  /** ছোট হাতের রূপ — ম্যাচিংয়ের জন্য */
  key: string
  aiModelId: string
  engine: EngineId
  modelId: string
}

type RegistryCache = {
  at: number
  active: Record<EngineId, ActiveModel[]>
  /** লম্বা স্বাক্ষর আগে — "Z-9" এর ভেতর "Z" না ধরে সবচেয়ে নির্দিষ্ট ম্যাচ */
  aliases: AliasEntry[]
}

let cache: RegistryCache | null = null

export function invalidateModelCache(): void {
  cache = null
}

async function loadRegistry(): Promise<RegistryCache> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache
  const [models, aliases] = await Promise.all([
    db.aiModel.findMany({
      where: { active: true },
      orderBy: [{ engine: 'asc' }, { createdAt: 'asc' }],
    }),
    db.modelAlias.findMany({
      where: { aiModel: { active: true } },
      include: { aiModel: { select: { engine: true, modelId: true } } },
      orderBy: { createdAt: 'asc' },
      take: ALIAS_CACHE_LIMIT,
    }),
  ])
  const active: Record<EngineId, ActiveModel[]> = { gemini: [], zai: [] }
  for (const m of models) {
    if (m.engine === 'gemini' || m.engine === 'zai') {
      active[m.engine].push({ id: m.id, modelId: m.modelId })
    }
  }
  const value: RegistryCache = {
    at: Date.now(),
    active,
    aliases: aliases
      .filter((a) => a.aiModel.engine === 'gemini' || a.aiModel.engine === 'zai')
      .map((a) => ({
        text: a.alias,
        key: a.alias.toLowerCase(),
        aiModelId: a.aiModelId,
        engine: a.aiModel.engine as EngineId,
        modelId: a.aiModel.modelId,
      }))
      .sort((x, y) => y.key.length - x.key.length),
  }
  cache = value
  return value
}

/** ইঞ্জিনের চালু মডেলগুলোর API আইডি — রেজিস্ট্রি খালি হলে fallback মডেল (আগের আচরণ) */
export async function getActiveModelIds(engine: EngineId, fallbackModel: string): Promise<string[]> {
  const reg = await loadRegistry()
  const ids = reg.active[engine].map((m) => m.modelId)
  return ids.length > 0 ? ids : [fallbackModel]
}

/**
 * জেতা মডেলের স্বাক্ষর পুল থেকে র‍্যান্ডম নাম/কোড।
 * পুল খালি বা modelId না জানা হলে null — তখন উত্তরে কোনো স্বাক্ষর যোগ হয় না।
 */
export async function pickModelAlias(modelId: string | null): Promise<string | null> {
  if (!modelId) return null
  const reg = await loadRegistry()
  const pool = reg.aliases.filter((a) => a.modelId === modelId)
  if (pool.length === 0) return null
  return pool[Math.floor(Math.random() * pool.length)].text
}

/**
 * প্রশ্নের টেক্সটে অ্যাডমিনের দেওয়া কোনো স্বাক্ষর-কোড আছে কি না —
 * থাকলে সেই মডেল (ও তার ইঞ্জিন) সবার আগে চেষ্টা হবে। স্টুডেন্ট কোড লিখে
 * নিঃশব্দে নির্দিষ্ট "টিচার" ডাকতে পারে — আসল মডেলের নাম না জেনেই।
 */
export async function resolveAliasTarget(
  text: string
): Promise<{ engine: EngineId; modelId: string } | null> {
  const q = text.toLowerCase().trim().slice(0, 4000)
  if (!q) return null
  const reg = await loadRegistry()
  const hit = reg.aliases.find((a) => q.includes(a.key))
  return hit ? { engine: hit.engine, modelId: hit.modelId } : null
}

/**
 * প্রথমবার ডিফল্ট মডেলগুলো বসাও (শুধুমাত্র একবার — Setting ফ্ল্যাগ দিয়ে লক,
 * তাই অ্যাডমিন সব মডেল মুছে ফেললেও আর ফিরে আসে না)। অ্যাডমিন মডেল-তালিকা খুললেই ডাকা হয়।
 */
export async function ensureModelsSeeded(): Promise<void> {
  const flag = await db.setting.findUnique({ where: { key: 'modelsSeeded' } })
  if (flag) return
  const count = await db.aiModel.count()
  if (count > 0) {
    // টেবিলে আগেই মডেল আছে — শুধু ফ্ল্যাগ বসাই, কিছু যোগ করি না
    await db.setting.create({ data: { key: 'modelsSeeded', value: 'true' } }).catch(() => {})
    return
  }
  for (const m of DEFAULT_MODELS) {
    await db.aiModel.create({ data: m }).catch(() => {}) // রেসে ডুপ্লিকেট হলেও থামবে না
  }
  await db.setting.create({ data: { key: 'modelsSeeded', value: 'true' } }).catch(() => {})
  invalidateModelCache()
}
