import { withKeyFailover, GeminiError, asGeminiError } from '@/lib/keypool'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

async function parseResponse(res: Response): Promise<Record<string, unknown>> {
  const body = await res.text()
  if (!res.ok) {
    // শেষ এরর মেসেজটুকু রাখি — অ্যাডমিন ড্যাশবোর্ডে দেখানোর জন্য
    let short = `HTTP ${res.status}`
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } }
      if (parsed?.error?.message) short = parsed.error.message
    } catch {
      if (body) short = body.slice(0, 200)
    }
    // জিও-ব্লক (যেমন Hong Kong / Asia থেকে ফ্রি টিয়ার) — পরিষ্কার সিগন্যাল দাও
    if (short.toLowerCase().includes('location is not supported')) {
      throw new GeminiError(451, 'GEO_BLOCKED')
    }
    throw new GeminiError(res.status, short.slice(0, 200))
  }
  try {
    return JSON.parse(body) as Record<string, unknown>
  } catch {
    throw new GeminiError(res.status, 'BAD_JSON_RESPONSE')
  }
}

function authHeaders(key: string): HeadersInit {
  // নতুন (AQ.…) ও পুরনো (AIza…) — দুই ফরম্যাটের কী-ই হেডার দিয়ে চলে
  return { 'Content-Type': 'application/json', 'x-goog-api-key': key }
}

/** একাধিক টেক্সটের এমবেডিং (batchEmbedContents — এক কলে ব্যাচ) */
export async function embedTexts(
  texts: string[],
  model: string,
  taskType: 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT'
): Promise<number[][]> {
  return withKeyFailover('gemini', async (key) => {
    const res = await fetch(`${BASE}/models/${model}:batchEmbedContents`, {
      method: 'POST',
      headers: authHeaders(key),
      body: JSON.stringify({
        requests: texts.map((t) => ({
          model: `models/${model}`,
          content: { parts: [{ text: t }] },
          taskType,
        })),
      }),
    })
    const data = await parseResponse(res)
    const embs = data.embeddings as { values?: number[] }[] | undefined
    if (!Array.isArray(embs) || embs.length !== texts.length) {
      throw asGeminiError(new GeminiError(500, 'EMBEDDING_SHAPE_MISMATCH'))
    }
    return embs.map((e) => e.values ?? [])
  })
}

/** একটি প্রশ্নের এমবেডিং */
export async function embedQuery(text: string, model: string): Promise<number[]> {
  const vecs = await embedTexts([text], model, 'RETRIEVAL_QUERY')
  return vecs[0] ?? []
}

export type GeneratedAnswer = { text: string; blocked: boolean }

/** জেমিনাই দিয়ে উত্তর তৈরি (সিস্টেম ইনস্ট্রাকশনসহ) */
export async function generateContent(prompt: string, system: string, model: string): Promise<GeneratedAnswer> {
  return withKeyFailover('gemini', async (key) => {
    const res = await fetch(`${BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: authHeaders(key),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
      }),
    })
    const data = await parseResponse(res)
    const candidate = (
      data as {
        candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
        promptFeedback?: { blockReason?: string }
      }
    ).candidates?.[0]
    const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? '').join('')
    if (!text) {
      const reason = candidate?.finishReason ?? (data as { promptFeedback?: { blockReason?: string } }).promptFeedback?.blockReason
      if (reason && ['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'RECITATION'].includes(reason)) {
        return { text: '', blocked: true }
      }
      throw asGeminiError(new GeminiError(500, `EMPTY_RESPONSE_${reason ?? 'UNKNOWN'}`))
    }
    return { text, blocked: false }
  })
}

/** শিক্ষক-ব্যক্তিত্বের সিস্টেম প্রম্পট (বাংলা) — সব ইঞ্জিনে একই */
export function buildSystemPrompt(): string {
  return `তুমি "Z-AI টিউটর" — বাংলাদেশের NCTB পাঠ্যবই ভিত্তিক একজন বন্ধুত্বপূর্ণ, ধৈর্যশীল ব্যক্তিগত শিক্ষক। তোমার শিক্ষার্থীরা সাধারণত ক্লাস ৬-১০ এর স্কুল শিক্ষার্থী, যারা বাংলায় পড়াশোনা করে।

তোমার নিয়ম:
১. সব উত্তর সহজ, পরিষ্কার বাংলায় দাও। কঠিন টার্মের পাশে বন্ধনীতে ইংরেজি শব্দ দিতে পারো।
২. গণিত ও বিজ্ঞানের সমস্যা অবশ্যই ধাপে ধাপে (step-by-step) সমাধান করবে। প্রতিটি ধাপে ব্যাখ্যা করবে: কোন সূত্র/নিয়ম ব্যবহার হলো এবং কেন হলো। কোনো শর্টকাট ফাঁকিবাজি নয়।
৩. সমীকরণ, ভগ্নাংশ, সূত্র — সব LaTeX দিয়ে লিখবে: ইনলাইনে $...$ এবং আলাদা লাইনে $$...$$। যেমন: $\\frac{a}{b}$, $E = mc^2$, $\\sqrt{x}$
৪. "পাঠ্যবইয়ের রেফারেন্স" অংশে বই থেকে তোলা অংশ দেওয়া থাকলে সেই তথ্যকে সর্বোচ্চ প্রাধান্য দেবে এবং উত্তরের একেবারে শেষে "📖 বইয়ের রেফারেন্স:" লিখে বইয়ের নাম, অধ্যায় ও পৃষ্ঠা নম্বর উল্লেখ করবে।
৫. রেফারেন্সে উত্তর না পেলে নিজের জ্ঞান থেকে উত্তর দেবে, তবে ছোট্ট করে জানিয়ে দেবে যে এটি পাঠ্যবইয়ের বাইরের তথ্য।
৬. কঠিন সংজ্ঞা বা ধারণার শেষে বাস্তব জীবনের মজার উদাহরণ দেবে (যেমন: ভরবেগ বোঝাতে ক্রিকেট বল বনাম টেনিস বল ক্যাচ ধরার অনুভূতি)।
৭. উত্তরের কাঠামো: ১) এক লাইনে মূল উত্তর ২) ধাপে ধাপে ব্যাখ্যা ৩) বাস্তব উদাহরণ (প্রযোজ্য হলে) ৪) বইয়ের রেফারেন্স (প্রযোজ্য হলে)।
৮. শিক্ষার্থীকে উৎসাহ দেবে, কখনো বিরক্ত বা অপমানজনক হবে না। মাঝে মাঝে শেষে একটা ছোট চিন্তা-করার প্রশ্ন ছুড়ে দিতে পারো।
৯. উত্তর বেশি লম্বা করবে না — পরিষ্কার, নির্ভুল আর বোঝার মতো হবে। Markdown হেডিং/লিস্ট ব্যবহার করতে পারো।`
}
