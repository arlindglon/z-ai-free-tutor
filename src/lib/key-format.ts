/**
 * API কী-এর আকৃতি দেখে ইঞ্জিন শনাক্তকারী হেল্পার —
 * ভুল ইঞ্জিন সিলেক্ট করলেও সার্ভার/ফর্ম অটো ঠিক করে নেয়।
 *
 * - Z.ai GLM key:  <৩২ হেক্স>.<১০-২৪ অক্ষর>   যেমন f599c81b...ce9.9m49IL6fxJcl6xVI
 * - Gemini key:    "AQ." দিয়ে শুরু (নতুন ফরম্যাট) বা "AIzaSy" দিয়ে শুরু (পুরনো ফরম্যাট)
 */
export function detectKeyEngine(rawKey: string): 'gemini' | 'zai' | null {
  const key = rawKey.trim()
  if (!key) return null
  if (/^[0-9a-f]{32}\.[A-Za-z0-9_-]{10,24}$/.test(key)) return 'zai'
  if (/^AQ\./.test(key) || /^AIzaSy/.test(key)) return 'gemini'
  return null
}
