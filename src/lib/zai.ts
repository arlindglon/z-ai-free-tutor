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
const ENV_MODEL = process.env.ZAI_MODEL?.trim() || 'glm-4.5-flash'
const ENV_BASE_URL =
  (process.env.ZAI_BASE_URL?.trim() || 'https://api.z.ai/api/paas/v4').replace(/\/+$/, '')

const envConfigured = ENV_API_KEY.length > 0

interface ChatChoice {
  message?: { content?: string | null }
}
interface OpenAiLikeResponse {
  choices?: ChatChoice[]
}

// ১) নিজের Z.ai key দিয়ে পাবলিক প্ল্যাটফর্ম — OpenAI-compatible এন্ডপয়েন্ট
async function envChat(system: string, prompt: string): Promise<string> {
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
