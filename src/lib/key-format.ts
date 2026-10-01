/**
 * API কী-এর আকৃতি দেখে ইঞ্জিন শনাক্তকারী হেল্পার —
 * ভুল ইঞ্জিন সিলেক্ট করলেও সার্ভার/ফর্ম অটো ঠিক করে নেয়।
 *
 * - Z.ai GLM key:  <৩২ হেক্স>.<১০-২৪ অক্ষর>   যেমন f599c81b...ce9.9m49IL6fxJcl6xVI
 * - Gemini key:    "AQ." দিয়ে শুরু (নতুন ফরম্যাট) বা "AIzaSy" দিয়ে শুরু (পুরনো ফরম্যাট)
 * - Gemini Web:    baseUrl|apiKey   যেমন https://my-vps:8083|sk-gemini-xxxx (নিজস্ব প্রক্সি-সার্ভার)
 */
import type { EngineId } from '@/lib/types'

export function detectKeyEngine(rawKey: string): EngineId | null {
  const key = rawKey.trim()
  if (!key) return null
  if (/^https?:\/\/\S+\|\S+$/i.test(key)) return 'gemini-web'
  if (/^[0-9a-f]{32}\.[A-Za-z0-9_-]{10,24}$/.test(key)) return 'zai'
  if (/^AQ\./.test(key) || /^AIzaSy/.test(key)) return 'gemini'
  return null
}

/** DB/ফর্ম থেকে আসা স্ট্রিং-ইঞ্জিন কি বৈধ EngineId — বাইরের/পুরনো মান ছেঁকে বাদ */
export function isEngineId(v: string): v is EngineId {
  return v === 'gemini' || v === 'zai' || v === 'gemini-web'
}
