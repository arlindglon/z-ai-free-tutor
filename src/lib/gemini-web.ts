import { GeminiError } from '@/lib/keypool'
import type { ChatImage } from '@/lib/gemini'

/**
 * 🌐 তৃতীয় ইঞ্জিন — Gemini Web (নিজস্ব সার্ভার, OpenAI-কম্প্যাটিবল)
 *
 * অ্যাডমিন নিজের VPS/হোম-সার্ভারে gemini-web2api-go জাতীয় প্রক্সি চালিয়ে
 * (https://github.com/zexadev/gemini-web2api-go) gemini.google.com ওয়েব-প্রোটোকলকে
 * /v1/chat/completions আকারে দেয় — AI-স্টুডিওর ফ্রি-কোটা শেষ হলে এই পথেই উত্তর চলে।
 *
 * কী-ফরম্যাট (কী-পুলে এক লাইনে):  baseUrl|apiKey
 * যেমন:  https://my-vps.example.com:8083|sk-gemini-xxxx
 */

const WEB_TIMEOUT_MS = 75_000

export function geminiWebDefaultModel(): string {
  return 'gemini-3.5-flash-lite'
}

/** কী-স্ট্রিং ভেঙে baseUrl + apiKey — ভুল ফরম্যাট হলে null */
export function parseWebKey(raw: string): { baseUrl: string; apiKey: string } | null {
  const idx = raw.indexOf('|')
  if (idx <= 0 || idx === raw.length - 1) return null
  const baseUrl = raw.slice(0, idx).trim().replace(/\/+$/, '')
  const apiKey = raw.slice(idx + 1).trim()
  if (!/^https?:\/\//i.test(baseUrl) || !apiKey) return null
  return { baseUrl, apiKey }
}

type WebImagePart = { type: 'image_url'; image_url: { url: string } }

/** সিস্টেম+প্রম্পট (+ঐচ্ছিক ছবি) → OpenAI-শেপের messages */
function buildMessages(system: string, prompt: string, image?: ChatImage) {
  if (image) {
    const imgPart: WebImagePart = {
      type: 'image_url',
      image_url: { url: `data:${image.mimeType};base64,${image.data}` },
    }
    return [
      { role: 'system', content: system },
      { role: 'user', content: [imgPart, { type: 'text', text: prompt }] },
    ]
  }
  return [
    { role: 'system', content: system },
    { role: 'user', content: prompt },
  ]
}

/** HTTP-স্ট্যাটাস থেকে প্রক্সি-র সার্ভার-বার্তা তুলে আনা */
async function errorFromResponse(res: Response): Promise<GeminiError> {
  let detail = ''
  try {
    const body = (await res.json()) as { error?: { message?: string } | string }
    const msg = typeof body.error === 'string' ? body.error : body.error?.message
    detail = (msg ?? '').slice(0, 190)
  } catch {
    detail = ''
  }
  return new GeminiError(res.status, detail || `gemini-web HTTP ${res.status}`)
}

/**
 * এক কী-দিয়ে একবার উত্তর — সফল হলে টেক্সট, ফেইল হলে GeminiError:
 * 401/403 → withKeyFailover কী-টা পুল থেকে বাদ দেবে; 429/5xx → পরের কী/রিট্রাই
 */
export async function geminiWebChatWithKey(
  rawKey: string,
  system: string,
  prompt: string,
  model: string,
  image?: ChatImage
): Promise<string> {
  const parsed = parseWebKey(rawKey)
  if (!parsed) throw new GeminiError(400, 'gemini-web কী-ফরম্যাট ভুল — baseUrl|apiKey আকারে দাও')

  let res: Response
  try {
    res = await fetch(`${parsed.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${parsed.apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: buildMessages(system, prompt, image),
      }),
      signal: AbortSignal.timeout(WEB_TIMEOUT_MS),
    })
  } catch (e) {
    // নেটওয়ার্ক/টাইমআউট — সার্ভার নিভে আছে বা নাগালের বাইরে → ট্রানজিয়েন্ট ধরনের
    const msg = e instanceof Error ? e.message : String(e)
    throw new GeminiError(503, `gemini-web সার্ভারে নাগাল নেই: ${msg.slice(0, 150)}`)
  }

  if (!res.ok) throw await errorFromResponse(res)

  type ChatCompletion = {
    choices?: { message?: { content?: string | null } }[]
  }
  const data = (await res.json().catch(() => null)) as ChatCompletion | null
  const text = data?.choices?.[0]?.message?.content ?? ''
  if (!text.trim()) throw new GeminiError(500, 'gemini-web খালি উত্তর দিয়েছে')
  return text
}
