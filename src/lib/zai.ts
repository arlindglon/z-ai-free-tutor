import ZAI from 'z-ai-web-dev-sdk'
import type { ChatImage } from '@/lib/gemini'

/**
 * z-ai ইঞ্জিন (ফলব্যাক):
 * Gemini কী না থাকলে / জিও-ব্লকড হলে / রেট-লিমিটে গেলে —
 * স্টুডেন্ট যেন কখনো খালি হাতে না ফেরে। শুধু ব্যাকএন্ডে ব্যবহারযোগ্য।
 *
 * দুইভাবে চলে:
 * ১. Env কনফিগ (ZAI_API_KEY থাকলে) → Z.ai পাবলিক প্ল্যাটফর্ম (api.z.ai)
 *    — নিজের API key, Vercel/যেকোনো হোস্টে চলে। ফ্রি Flash মডেল পাওয়া যায়।
 * ২. Env না থাকলে → স্যান্ডবক্স SDK (.z-ai-config ফাইল) — শুধু এই স্যান্ডবক্সে চলে।
 *
 * Env variables (DB pool খালি থাকলে ব্যবহৃত হয়):
 *   ZAI_API_KEY   (ঐচ্ছিক) https://z.ai Model API থেকে নিজের key
 *   ZAI_MODEL     (ঐচ্ছিক)   ডিফল্ট: glm-4.7-flash — ড্যাশবোর্ডে যে ফ্রি Flash মডেল আছে সেটা
 *   ZAI_BASE_URL  (ঐচ্ছিক)   ডিফল্ট: https://api.z.ai/api/paas/v4
 *   ZAI_CONCURRENCY (ঐচ্ছিক) ডিফল্ট ২ — ফ্রি টিয়ারের একসাথে request লিমিট
 */

type ZAIInstance = Awaited<ReturnType<typeof ZAI.create>>
let instance: ZAIInstance | null = null

const ENV_API_KEY = process.env.ZAI_API_KEY?.trim() || ''
const ENV_MODEL = process.env.ZAI_MODEL?.trim() || 'glm-4.7-flash'
/** ভিশন-মডেল — ছবি-প্রশ্ন (sandbox SDK createVision পথ) এই মডেলে যায় */
const ZAI_VISION_MODEL = process.env.ZAI_VISION_MODEL?.trim() || 'glm-4.5v'

/** Z.ai-এর ডিফল্ট ফ্রি মডেল — মডেল রেজিস্ট্রি খালি হলে এটাই fallback */
export function zaiDefaultModel(): string {
  return ENV_MODEL
}

/** Env key (ZAI_API_KEY) সেট আছে কি না — অডিটের জন্য (sandbox SDK পথে মডেল প্যারাম কাজ করে না) */
export function zaiEnvConfigured(): boolean {
  return envConfigured
}
const ENV_BASE_URL =
  (process.env.ZAI_BASE_URL?.trim() || 'https://api.z.ai/api/paas/v4').replace(/\/+$/, '')

const envConfigured = ENV_API_KEY.length > 0

// ফ্রি টিয়ারে concurrency লিমিট (429 code 1302/1305 "temporarily overloaded") →
// লোকাল সেমাফোর: লিমিটের বেশি request লাইনে অপেক্ষা করে (queue), 429 আসেই না।
// সার্ভারলেসে একাধিক instance থাকলে এটা per-instance — বাকি থাকলে নিচের retry ধরে।
//
// ক্ষমতা (capacity):
// - ZAI_CONCURRENCY স্পষ্ট সেট করা থাকলে সেটাই চূড়ান্ত
// - না থাকলে ডায়নামিক: DB key-pool-এর প্রতিটা key-এর জন্য ১টা করে slot
//   (১ key = পরপর চলবে, ৪ key = ৪টা একসাথে) — key যোগ করলেই ক্ষমতা বাড়ে
const EXPLICIT_CONCURRENCY =
  process.env.ZAI_CONCURRENCY !== undefined && process.env.ZAI_CONCURRENCY !== ''
const BASE_CONCURRENCY = Math.max(1, Number(process.env.ZAI_CONCURRENCY ?? '2') || 2)
let capacity = BASE_CONCURRENCY

/** key-pool-এ কয়টা active key আছে জানিয়ে দাও — প্রতি key-এ ঠিক ১টা slot
 *  (key কমলে slot-ও কমে, যাতে ৪২৯-এ একসাথে ধাক্কা না লাগে; সর্বোচ্চ ১২) */
export function tuneZaiCapacity(keyCount: number): void {
  if (EXPLICIT_CONCURRENCY) return
  capacity = Math.min(12, Math.max(1, Math.floor(keyCount) || 1))
}

let active = 0
const waiters: Array<() => void> = []

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= capacity) {
    await new Promise<void>((resolve) => waiters.push(resolve))
  }
  active++
  try {
    return await fn()
  } finally {
    active--
    waiters.shift()?.()
  }
}

interface ChatChoice {
  message?: { content?: string | null }
}
interface OpenAiLikeResponse {
  choices?: ChatChoice[]
}

// ১) একটি নির্দিষ্ট key দিয়ে Z.ai পাবলিক প্ল্যাটফর্ম কল — OpenAI-compatible এন্ডপয়েন্ট
//    (key-pool থেকে key এসে ডাকা হয়; semaphore + 429-retry ভিতরেই)
//    image থাকলে OpenAI-ভিশন content অ্যারে (data URL) — টেক্সট ও ছবি একই request pipeline
export async function zaiChatWithKey(
  apiKey: string,
  system: string,
  prompt: string,
  model?: string,
  image?: ChatImage
): Promise<string> {
  return withSlot(() => zaiCall(apiKey, system, prompt, model, image))
}

/** ইউজার-মেসেজ content — ছবি থাকলে OpenAI-ভিশন অ্যারে, নইলে সাদামাটা স্ট্রিং */
function userContent(prompt: string, image?: ChatImage): string | Array<Record<string, unknown>> {
  if (!image) return prompt
  return [
    { type: 'text', text: prompt },
    { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } },
  ]
}

async function zaiHttp(apiKey: string, system: string, prompt: string, model?: string, image?: ChatImage): Promise<string> {
  const res = await fetch(`${ENV_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || ENV_MODEL,
      messages: [
        { role: 'assistant', content: system },
        { role: 'user', content: userContent(prompt, image) },
      ],
      thinking: { type: 'disabled' },
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    // মডেল-না-পাওয়া আলাদা করে চিনাও (Z.ai 404/কোড 1211 দেয়) — তাহলে ai-engine
    // নিঃশব্দে পরের চালু মডেল চেষ্টা করতে পারে, কী-পুল/ব্রেকার না জ্বালিয়ে
    if (res.status === 404 || /"code"\s*:\s*"?1211"?|model.{0,40}(not exist|not found|invalid)|不存在/i.test(body)) {
      throw new Error(`ZAI_MODEL_NOT_FOUND (HTTP ${res.status}): ${body.slice(0, 200)}`)
    }
    throw new Error(`ZAI_ENV_HTTP_${res.status}: ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as OpenAiLikeResponse
  const text = data.choices?.[0]?.message?.content ?? ''
  if (!text.trim()) throw new Error('ZAI_EMPTY_RESPONSE')
  return text
}

async function zaiCall(apiKey: string, system: string, prompt: string, model?: string, image?: ChatImage): Promise<string> {
  const RETRIES = 3
  const BACKOFFS = [1500, 3000, 5000] // 429 (1302/1305) হলে অপেক্ষা + jitter — লাইনে দাঁড়িয়ে আবার
  for (let attempt = 0; ; attempt++) {
    try {
      return await zaiHttp(apiKey, system, prompt, model, image)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const isRateLimit = msg.startsWith('ZAI_ENV_HTTP_429')
      if (!isRateLimit || attempt >= RETRIES) throw e
      const base = BACKOFFS[attempt] ?? 5000
      await new Promise((r) => setTimeout(r, base + Math.floor(Math.random() * 800)))
    }
  }
}

// ২) স্যান্ডবক্স SDK পথ (.z-ai-config ফাইল থেকে credential)
async function getZai(): Promise<ZAIInstance> {
  if (!instance) instance = await ZAI.create()
  return instance
}

export async function zaiChat(system: string, prompt: string, model?: string, image?: ChatImage): Promise<string> {
  // DB key-pool-এ Z.ai key থাকলে সেগুলোই আগে (withKeyFailover রাউন্ড-রবিন)
  const { getActiveKeys, withKeyFailover } = await import('@/lib/keypool')
  const keys = await getActiveKeys('zai')
  if (keys.length > 0) {
    return withKeyFailover('zai', (key) => zaiCall(key, system, prompt, model, image))
  }
  if (envConfigured) {
    // Env key (Vercel/সেলফ-হোস্ট)
    return withSlot(() => zaiCall(ENV_API_KEY, system, prompt, model, image))
  }
  // শেষ ভরসা: স্যান্ডবক্স SDK credential (.z-ai-config ফাইল) — ছবি থাকলে createVision
  const zai = await getZai()
  if (image) {
    // SDK-র Vision টাইপ — VisionMultimodalContentItem[] content
    const completion = await zai.chat.completions.createVision({
      model: ZAI_VISION_MODEL,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: `data:${image.mimeType};base64,${image.data}` },
            },
          ],
        },
      ],
    })
    const text = completion.choices[0]?.message?.content ?? ''
    if (!text.trim()) throw new Error('ZAI_EMPTY_RESPONSE')
    return text
  }
  const completion = await zai.chat.completions.create({
    messages: [
      { role: 'assistant', content: system },
      { role: 'user', content: prompt },
    ],
    thinking: { type: 'disabled' },
  })
  const text = completion.choices[0]?.message?.content ?? ''
  if (!text.trim()) throw new Error('ZAI_EMPTY_RESPONSE')
  return text
}
