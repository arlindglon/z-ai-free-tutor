import ZAI from 'z-ai-web-dev-sdk'

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
 * Env variables:
 *   ZAI_API_KEY   (প্রয়োজনীয়) https://z.ai Model API থেকে নিজের key
 *   ZAI_MODEL     (ঐচ্ছিক)   ডিফল্ট: glm-4.5-flash — ড্যাশবোর্ডে যে ফ্রি Flash মডেল আছে সেটা
 *   ZAI_BASE_URL  (ঐচ্ছিক)   ডিফল্ট: https://api.z.ai/api/paas/v4
 */

type ZAIInstance = Awaited<ReturnType<typeof ZAI.create>>
let instance: ZAIInstance | null = null

const ENV_API_KEY = process.env.ZAI_API_KEY?.trim() || ''
const ENV_MODEL = process.env.ZAI_MODEL?.trim() || 'glm-4.7-flash'
const ENV_BASE_URL =
  (process.env.ZAI_BASE_URL?.trim() || 'https://api.z.ai/api/paas/v4').replace(/\/+$/, '')

const envConfigured = ENV_API_KEY.length > 0

// ফ্রি টিয়ারে concurrency লিমিট (~২ একসাথে, 429 code 1302) →
// লোকাল সেমাফোর: লিমিটের বেশি request লাইনে অপেক্ষা করে, 429 আসেই না।
// সার্ভারলেসে একাধিক instance থাকলে এটা per-instance — বাকি থাকলে নিচের retry ধরে।
const ENV_CONCURRENCY = Math.max(1, Number(process.env.ZAI_CONCURRENCY ?? '2') || 2)
let active = 0
const waiters: Array<() => void> = []

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= ENV_CONCURRENCY) {
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

// ১) নিজের Z.ai key দিয়ে পাবলিক প্ল্যাটফর্ম — OpenAI-compatible এন্ডপয়েন্ট
// ফ্রি টিয়ারে concurrency লিমিট আছে (429 code 1302) → ছোট backoff দিয়ে অটো-রিট্রাই
async function envChatOnce(system: string, prompt: string): Promise<string> {
  const res = await fetch(`${ENV_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ENV_API_KEY}`,
    },
    body: JSON.stringify({
      model: ENV_MODEL,
      messages: [
        { role: 'assistant', content: system },
        { role: 'user', content: prompt },
      ],
      thinking: { type: 'disabled' },
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`ZAI_ENV_HTTP_${res.status}: ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as OpenAiLikeResponse
  const text = data.choices?.[0]?.message?.content ?? ''
  if (!text.trim()) throw new Error('ZAI_EMPTY_RESPONSE')
  return text
}

async function envChat(system: string, prompt: string): Promise<string> {
  const RETRIES = 2
  const BACKOFFS = [1200, 2400] // 429 হলে ছোট অপেক্ষা + jitter দিয়ে আবার
  return withSlot(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await envChatOnce(system, prompt)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const isRateLimit = msg.startsWith('ZAI_ENV_HTTP_429')
        if (!isRateLimit || attempt >= RETRIES) throw e
        const base = BACKOFFS[attempt] ?? 2400
        await new Promise((r) => setTimeout(r, base + Math.floor(Math.random() * 600)))
      }
    }
  })
}

// ২) স্যান্ডবক্স SDK পথ (.z-ai-config ফাইল থেকে credential)
async function getZai(): Promise<ZAIInstance> {
  if (!instance) instance = await ZAI.create()
  return instance
}

export async function zaiChat(system: string, prompt: string): Promise<string> {
  if (envConfigured) return envChat(system, prompt)
  const zai = await getZai()
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
