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
