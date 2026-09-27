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
  snippet: string
}

export type ChatApiResponse = {
  id: string
  answer: string
  references: BookReference[]
  credits: Credits
  engine?: 'gemini' | 'zai'
}

export type HistoryMessage = {
  id: string
  question: string
  answer: string | null
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
  board: string | null
  /** ব্যাকগ্রাউন্ডে অটো-এমবেড চলছে কি না (PDF আপলোডের পরে) */
  autoEmbedding?: boolean
  chapters: ChapterInfo[]
}

export type StatsInfo = {
  users: number
  questionsToday: number
  totalQuestions: number
  totalChunks: number
  embeddedChunks: number
  activeKeys: number
  totalKeys: number
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
}
