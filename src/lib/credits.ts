import { db } from '@/lib/db'
import { todayDhaka } from '@/lib/tz'

/** আজ (ঢাকা সময়ে) কতগুলো প্রশ্ন করা হয়েছে */
export async function getUsedToday(userId: string): Promise<number> {
  const row = await db.dailyCredit.findUnique({
    where: { userId_date: { userId, date: todayDhaka() } },
  })
  return row?.used ?? 0
}

/** একটি ক্রেডিট খরচ করো — কোটা শেষ হলে ok:false। নতুন দিনে অটোমেটিক নতুন রো (রিসেট) */
export async function consumeCredit(userId: string, limit: number): Promise<{ ok: boolean; used: number }> {
  const date = todayDhaka()
  const existing = await db.dailyCredit.findUnique({
    where: { userId_date: { userId, date } },
  })
  if (existing && existing.used >= limit) return { ok: false, used: existing.used }
  const row = await db.dailyCredit.upsert({
    where: { userId_date: { userId, date } },
    create: { userId, date, used: 1 },
    update: { used: { increment: 1 } },
  })
  return { ok: true, used: row.used }
}

/** জেমিনাই ফেইল হলে ক্রেডিট ফেরত (শিক্ষার্থী বঞ্চিত হবে না) */
export async function refundCredit(userId: string): Promise<void> {
  const date = todayDhaka()
  const row = await db.dailyCredit.findUnique({ where: { userId_date: { userId, date } } })
  if (!row || row.used <= 0) return
  await db.dailyCredit.update({ where: { id: row.id }, data: { used: { decrement: 1 } } })
}
