import { getActiveKeys, GeminiError } from '@/lib/keypool'
import { generateContent, type GeneratedAnswer } from '@/lib/gemini'
import { zaiChat } from '@/lib/zai'
import type { AppSettings } from '@/lib/settings'

/**
 * ইউনিফাইড AI ইঞ্জিন — Zero-Cost Load Balancing + নেভার-ফেইল নীতি:
 * ১. Gemini কী-পুল আছে ও সুস্থ → জেমিনাই (রাউন্ড-রবিন + 429 অটো-ফেইলওভার)
 * ২. জেমিনাই ব্যর্থ (কী নেই / জিও-ব্লক / রেট-লিমিট / এরর) → z-ai ইঞ্জিন
 * স্টুডেন্ট সবসময় উত্তর পাবে — কোন ইঞ্জিন চললো সেটা রেসপনসে থাকে।
 */
export type EngineResult = GeneratedAnswer & { engine: 'gemini' | 'z-ai' }

export async function generateTutorAnswer(
  prompt: string,
  system: string,
  settings: AppSettings
): Promise<EngineResult> {
  const keys = await getActiveKeys()
  if (keys.length > 0) {
    try {
      const result = await generateContent(prompt, system, settings.chatModel)
      return { ...result, engine: 'gemini' }
    } catch (e) {
      console.error(
        '[ai-engine] gemini failed → z-ai fallback:',
        e instanceof Error ? e.message : e
      )
    }
  }
  // z-ai ইঞ্জিন শুধু এই স্যান্ডবক্স/সেলফ-হোস্টেড এনভায়রনমেন্টে চলে।
  // Vercel-এ ক্রেডেনশিয়াল নেই বলে ফেইল করলে ক্র্যাশ না করে পরিষ্কার সিগন্যাল দাও —
  // chat রুট NO_KEYS → বাংলা গাইড মেসেজ + ক্রেডিট রিফান্ড করে।
  try {
    const text = await zaiChat(system, prompt)
    return { text, blocked: false, engine: 'z-ai' }
  } catch (e) {
    console.error('[ai-engine] z-ai fallback failed:', e instanceof Error ? e.message : e)
    throw new GeminiError(503, keys.length > 0 ? 'ALL_ENGINES_DOWN' : 'NO_KEYS')
  }
}
