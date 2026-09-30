/** ইংরেজি সংখ্যা → বাংলা সংখ্যা */
const BN_DIGITS = '০১২৩৪৫৬৭৮৯'

export function toBn(value: number | string): string {
  return String(value).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)])
}

/**
 * বাংলা নুক্তা-অক্ষরের ইউনিকোড-রূপভেদ নরমালাইজ — ড়/ঢ়/য়-এর এক-কোডপয়েন্ট রূপ
 * (U+09DC/U+09DD/U+09DF) জোড়া-রূপে (ড+়, ঢ+়, য+়) নেওয়া হয়। ইউজার/ডক/OCR যে রূপেই
 * লিখ, ম্যাচিং-সব জায়গায় এক হয়ে যায়। (সম্পূর্ণ NFD নয় — সেটা ো/ৌ-ও ভাঙে!)
 */
const NUFTA_MAP: Record<string, string> = {
  '\u09DC': '\u09A1\u09BC', // ড়
  '\u09DD': '\u09A2\u09BC', // ঢ়
  '\u09DF': '\u09AF\u09BC', // য়
}

export function normalizeBnText(s: string): string {
  return s.replace(/[\u09DC\u09DD\u09DF]/g, (c) => NUFTA_MAP[c])
}

export const SUBJECTS = [
  'সাধারণ',
  'গণিত',
  'বিজ্ঞান',
  'পদার্থবিজ্ঞান',
  'রসায়ন',
  'জীববিজ্ঞান',
  'বাংলা',
  'ইংরেজি',
  'তথ্য ও যোগাযোগ প্রযুক্তি',
  'সমাজবিজ্ঞান',
  'ধর্ম',
] as const

/**
 * 🧹 মিশ্র-লিপি দূষণ শনাক্তকারী — ছোট ফ্রি মডেল মাঝে মাঝে বাংলা শব্দের ভেতরে
 * ইংরেজি অক্ষর মিশিয়ে ফেলে ("খoló" = খোলা, "কৃষিkrishi") — ছাত্র পড়তে পারে না।
 * শনাক্ত: বাংলা অক্ষর বা স্বরচিহ্নের ঠিক পরেই ২+ ছোট-হাতের লাতিন অক্ষর (স্পেস ছাড়া)।
 * সৎ মিশ্রণ যেমন "FCR", "pH", "$x=7$", "(Rancidity)" — বাংলা-অক্ষরের সরাসরি
 * পাশে লাতিন-ছোটহাতের জোড়া হিসেবে আসে না (প্যারেন্থেসিস/স্পেস/বড়হাতের আছে), তাই বাদ।
 */
const MIXED_SCRIPT_RE =
  /([\u0985-\u09B9\u09CE\u09DC-\u09DF\u0981-\u0983\u09BE-\u09CD\u09D7])[a-z\u00DF-\u00FF]{2,}/g

export function countMixedScriptWords(text: string): number {
  return (text.match(MIXED_SCRIPT_RE) ?? []).length
}
