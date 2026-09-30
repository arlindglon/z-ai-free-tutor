/** শেয়ার্ড টাইপস — ফ্রন্টএন্ড ও ব্যাকএন্ড উভয়ে ব্যবহার করে */

export type UserInfo = {
  id: string
  name: string
  email: string
  role: 'student' | 'admin'
}

export type Credits = {
  used: number
  /** ০ মানে আনলিমিটেড (অ্যাডমিন) */
  limit: number
}

export type BookReference = {
  book: string
  chapter: string
  page: number | null
  /** ছোট প্রিভিউ (চিপের নিচে এক লাইন) */
  snippet: string
  /** পুরো চাঙ্ক — মার্কডাউন (টেবিল/শিরোনাম) + KaTeX ম্যাথ — খুললে সুন্দর রেন্ডার হয় */
  content?: string
}

export type ChatApiResponse = {
  id: string
  answer: string
  /** উত্তরের স্বাক্ষর — জেতা মডেলের পুল থেকে র‍্যান্ডম নাম/কোড (অ্যাডমিন সেট করলেই আসবে) */
  answerTag?: string | null
  references: BookReference[]
  credits: Credits
  /** ⚡ ক্যাশ-হিট — রিপিট প্রশ্ন, ইঞ্জিন-কল হয়নি (তাৎক্ষণিক + কোটা বাঁচলো) */
  cached?: boolean
}

export type HistoryMessage = {
  id: string
  question: string
  answer: string | null
  answerTag?: string | null
  references: BookReference[] | null
  createdAt: string
}

export type EngineId = 'gemini' | 'zai'

export type ApiKeyInfo = {
  id: string
  engine: EngineId
  label: string | null
  masked: string
  active: boolean
  lastError: string | null
  createdAt: string
}

export type ChapterInfo = {
  id: string
  title: string
  number: number | null
  chunkCount: number
  embeddedCount: number
}

export type BookInfo = {
  id: string
  title: string
  subject: string
  /** স্তর — প্রাক-প্রাথমিক / প্রাথমিক / মাধ্যমিক / দাখিল ইত্যাদি */
  level?: string | null
  board: string | null
  /** ব্যাকগ্রাউন্ডে অটো-এমবেড চলছে কি না (PDF আপলোড/সেভের পরে) */
  autoEmbedding?: boolean
  /** অটো-এমবেড থেমে গেলে কারণ (কী নেই / জিও-ব্লক / রেট-লিমিট) — null মানে সব ঠিক */
  embedError?: string | null
  chapters: ChapterInfo[]
}

/** স্তর/বিষয় রেজিস্ট্রি — অ্যাডমিন ইচ্ছেমতো যোগ/বদল/মুছতে পারে */
export type CategoryInfo = { id: string; name: string }

export type StatsInfo = {
  users: number
  questionsToday: number
  totalQuestions: number
  totalChunks: number
  embeddedChunks: number
  activeKeys: number
  totalKeys: number
  /** ⚡ উত্তর-ক্যাশ */
  cachedAnswers: number
  cacheHits: number
}

export type SettingsInfo = {
  chatModel: string
  embeddingModel: string
  dailyCredits: number
  /** মূল চ্যাট ইঞ্জিন — ফেইল হলে অন্যটা fallback */
  primaryEngine: EngineId
  geminiEnabled: boolean
  zaiEnabled: boolean
  /** মূল ইঞ্জিন ফেইল করলে অন্য ইঞ্জিন অটো-চেষ্টা হবে কি না */
  fallbackEnabled: boolean
  /** RAG লক — চালু থাকলে শুধু বইয়ের রেফারেন্স থেকেই উত্তর দেবে */
  ragOnlyMode: boolean
  /** ⚡ উত্তর-ক্যাশ চালু/বন্ধ */
  cacheEnabled: boolean
}

/** মডেল রেজিস্ট্রি — ইঞ্জিন প্রতি চ্যাট মডেল + প্রতিটার স্বাক্ষর পুল */
export type ModelAliasInfo = {
  id: string
  alias: string
}

export type ModelInfo = {
  id: string
  engine: EngineId
  modelId: string
  label: string | null
  active: boolean
  /** এই মডেল এখন পর্যন্ত কতগুলো উত্তর দিয়েছে (অ্যাডমিন অডিট) */
  usageCount: number
  aliases: ModelAliasInfo[]
  createdAt: string
}
