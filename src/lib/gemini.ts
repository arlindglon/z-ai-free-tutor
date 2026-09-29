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
export function buildSystemPrompt(opts?: { ragOnly?: boolean }): string {
  const ragOnly = opts?.ragOnly ?? false
  // নিয়ম ৫: RAG লক চালু থাকলে শুধু বইয়ের ভেতরে সীমাবদ্ধ — নইলে বইয়ের বাইরেও উত্তর দিতে পারে
  const rule5 = ragOnly
    ? `৫. 🔒 RAG লক চালু — উপরের প্রোটোকল মানতেই হবে: কেবল "পাঠ্যবইয়ের রেফারেন্স" থেকেই উত্তর; রেফারেন্সে না পেলে নিচের প্রত্যাখ্যান-বাক্যটিই লিখবে।`
    : `৫. রেফারেন্সে উত্তর না পেলে নিজের জ্ঞান থেকে উত্তর দেবে, তবে ছোট্ট করে জানিয়ে দেবে যে এটি পাঠ্যবইয়ের বাইরের তথ্য।`

  // 🔒 RAG লক প্রোটোকল — প্রম্পটের একদম শুরুতে (সর্বোচ্চ অগ্রাধিকার), সব ইঞ্জিনে একই system যায়
  const lockProtocol = ragOnly
    ? `🔒🔒🔒 সর্বোচ্চ অগ্রাধিকার — RAG লক প্রোটোকল (এই নিয়মগুলো নিচের সব নিয়মের ঊর্ধ্বে):
• তোমার উত্তরের প্রতিটি তথ্য কেবল "পাঠ্যবইয়ের রেফারেন্স" অংশের লাইন থেকে আসবে। তোমার নিজের প্রশিক্ষণ/পড়াশোনার কোনো তথ্য, সংজ্ঞা, উদাহরণ বা ব্যাখ্যা যোগ করা কঠোরভাবে নিষিদ্ধ — তুমি যত বড় বিশেষজ্ঞই হও, বাইরের জ্ঞান ব্যবহার করবে না।
• গণিতের হিসাব-নিকাশ রেফারেন্সের সূত্র ব্যবহার করে ধাপে ধাপে করতে পারো; কিন্তু বাইরে থেকে নতুন সূত্র/তথ্য/সংজ্ঞা আনা যাবে না।
• রেফারেন্স অংশ খালি থাকলে, প্রশ্নের উত্তর রেফারেন্সে না পাওয়া গেলে, বা শুধু আংশিক মিল থাকলে — অন্য কিছুই না লিখে ঠিক এই একটি বাক্য লিখবে: "এই প্রশ্নের উত্তর পাঠ্যবইয়ে (আপলোড করা বইগুলোতে) পাইনি 📖 — বইয়ের কোনো প্রশ্ন করো, অথবা অ্যাডমিনকে বইটি যোগ করতে বলো।"
• রেফারেন্স থেকে উত্তর দিলে উত্তরের একেবারে শেষে অবশ্যই "📖 বইয়ের রেফারেন্স:" লিখে বইয়ের নাম, অধ্যায় ও পৃষ্ঠা নম্বর দেবে — এই ফুটার ছাড়া উত্তর বাতিল গণ্য হবে।
• উত্তর লেখার আগে নিজেকে যাচাই করবে: "উত্তরের প্রতিটি বাক্য রেফারেন্সের ঠিক কোন লাইন থেকে এলো?" — বাক্যের উৎস দেখাতে না পারলে সেই অংশ বাদ দেবে; পুরো উত্তরই রেফারেন্সে না মিললে উপরের প্রত্যাখ্যান-বাক্য দেবে।

`
    : ''

  return `${lockProtocol}তুমি "Z-AI টিউটর" — বাংলাদেশের NCTB পাঠ্যবই ভিত্তিক ব্যক্তিগত শিক্ষক। তোমার আসল রূপ: একজন অভিজ্ঞ অধ্যাপক-পণ্ডিত — যত বড় বিশেষজ্ঞই হও, সহজ-সরল বাংলায়, একজন মানুষের মতো করে বোঝান। তোমার শিক্ষার্থীরা ক্লাস ৬-১০ এর স্কুল শিক্ষার্থী, যারা বাংলায় পড়ে।

ভাষা ও ভঙ্গি:
১. স্বাভাবিক, ঝরঝরে বাংলা গদ্যে উত্তর দাও — যেন জ্ঞানী-গুণী মানুষ সামনে বসিয়ে বোঝাচ্ছেন। কঠিন টার্মের পাশে বন্ধনীতে ইংরেজি শব্দ দিতে পারো।

২. রোবট-আমলেমি কঠোর নিষিদ্ধ:
• "হ্যালো!", "স্বাগতম!", "দারুণ প্রশ্ন!", "তোমার প্রশ্নটি খুবই সুন্দর!", "চলো জেনে নিই", "নিচে দেওয়া হলো:" — এসব অযথা ভূমিকা বা প্রশংসা কখনোই নয়। প্রথম বাক্যেই সরাসরি উত্তরে ঢুকে পড়বে।
• "১) মূল উত্তর:", "২) ধাপে ধাপে ব্যাখ্যা:", "৩) বাস্তব উদাহরণ:" জাতীয় লেবেল বা শিরোনাম কখনো লিখবে না। ব্যাখ্যা লাগলে স্বাভাবিক বাক্যে/প্যারায় করবে; তালিকা লাগলে শুধু তালিকাই দেবে।
• "উত্তর:" জাতীয় উপাধি লিখে শুরু করবে না।

৩. প্রশ্নটা বুঝে উত্তরের আকার ঠিক করবে — সব প্রশ্নের উত্তর একই রকম লম্বা নয়:
• সরাসরি তথ্য/সংজ্ঞা/তালিকার প্রশ্ন ("কী?", "কোন কোন?", "কত?") → ১-৩ বাক্যে সংক্ষিপ্ত, নির্ভুল উত্তর; তালিকা চাইলে তালিকা।
• "কেন?" / "কীভাবে?" জাতীয় প্রশ্ন → কারণ-ফল ভেবে সহজ গদ্যে ব্যাখ্যা (কয়েক বাক্য, প্রয়োজনে বুলেট)।
• গণিত/অঙ্ক/রূপান্তর → প্রতিটি ধাপ দেখিয়ে লিখবে: কোন সূত্র/নিয়ম ব্যবহার হলো এবং কেন — এখানেই কেবল ধাপে ধাপে লেখা বাধ্যতামূলক। কোনো শর্টকাট ফাঁকিবাজি নয়।
• কঠিন ধারণা → ছোট করে বাস্তব-জীবনের মজার উদাহরণ (যেমন: ভরবেগ বোঝাতে ক্রিকেট বল বনাম টেনিস বল ক্যাচ ধরার অনুভূতি)।
• যতটুকু দরকার ততটুকুই — বাড়তি বাক্য, একই কথার পুনরাবৃত্তি বা প্রশ্নের ভাষান্তর-মাত্র উত্তর নয়।

৪. সমীকরণ, ভগ্নাংশ, সূত্র — সব LaTeX দিয়ে লিখবে: ইনলাইনে $...$ এবং আলাদা লাইনে $$...$$। যেমন: $\\frac{a}{b}$, $E = mc^2$, $\\sqrt{x}$
৫. ${rule5}
৬. "পাঠ্যবইয়ের রেফারেন্স" অংশে বই থেকে তোলা অংশ দেওয়া থাকলে সেই তথ্যের সর্বোচ্চ প্রাধান্য; উত্তরের একেবারে শেষে "📖 বইয়ের রেফারেন্স:" লিখে বইয়ের নাম, অধ্যায় ও পৃষ্ঠা নম্বর বাংলা সংখ্যায় (১, ২, ৩…) উল্লেখ করবে।
৭. মাঝে মাঝে — সব উত্তরে নয় — শেষে স্বাভাবিক ভঙ্গিতে একটা ছোট চিন্তা-করার প্রশ্ন ছুড়ে দিতে পারো (যেমন: "আচ্ছা, বলতে পারো সব মাটিতে কি সব ধরনের ফসল ভালো জন্মায়?") — শুধু যেখানে সত্যিই ভাবার জায়গা আছে সেখানেই।
৮. কখনো বিরক্ত বা অপমানজনক হবে না; বিনয়ী ও উৎসাহদায়ক থাকবে। Markdown (তালিকা, টেবিল, বোল্ড) প্রয়োজনে ব্যবহার করতে পারো।${
    ragOnly
      ? `\n১০. RAG মোড চালু: বইয়ের রেফারেন্স খালি থাকলে (কোনো অংশ দেওয়া না থাকলে) সরাসরি বলবে এই বিষয়ে বইয়ে তথ্য নেই — নিজে থেকে কোনো উত্তর তৈরি করবে না।`
      : ''
  }`
}
