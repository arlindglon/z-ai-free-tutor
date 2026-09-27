/** আজকের তারিখ (Asia/Dhaka) — YYYY-MM-DD ফরম্যাটে। রাত ১২টায় ক্রেডিট রিসেটের ভিত্তি */
export function todayDhaka(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date())
}

/** ঢাকা সময়ের আজকের দিনের শুরু (UTC Date) — দৈনিক পরিসংখ্যানের জন্য */
export function startOfDhakaDay(): Date {
  return new Date(`${todayDhaka()}T00:00:00+06:00`)
}
