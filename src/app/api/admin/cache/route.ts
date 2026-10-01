import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, forbidden, unauthorized } from '@/lib/session'

/** ⚡ উত্তর-ক্যাশ ম্যানেজমেন্ট — জমানো সব ক্যাশ-উত্তর মুছে দেওয়া
 *  (যেমন: চিত্র-স্টাইল/প্রম্পট বদলানোর পরে পুরনো উত্তর নতুন স্টাইলে আবার তৈরি করাতে চাইলে) */
export async function DELETE() {
  const user = await getSessionUser()
  if (!user) return unauthorized()
  if (user.role !== 'admin') return forbidden()

  const { count } = await db.answerCache.deleteMany({})
  return NextResponse.json({ deleted: count })
}
