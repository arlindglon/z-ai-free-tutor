/** ইংরেজি সংখ্যা → বাংলা সংখ্যা */
const BN_DIGITS = '০১২৩৪৫৬৭৮৯'

export function toBn(value: number | string): string {
  return String(value).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)])
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
