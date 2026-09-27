import { getActiveKeys } from '@/lib/keypool'
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
  const text = await zaiChat(system, prompt)
  return { text, blocked: false, engine: 'z-ai' }
}
