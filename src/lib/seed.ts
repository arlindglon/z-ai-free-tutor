import { db } from '@/lib/db'
import { hashPassword } from '@/lib/password'

/**
 * প্রথমবার চালু হলে ডিফল্ট অ্যাডমিন একাউন্ট তৈরি হয়।
 * ক্রেডেনশিয়াল .env এর ADMIN_EMAIL / ADMIN_PASSWORD থেকে, ডিফল্ট:
 * admin@tutor.bd / admin1234
 */
export async function ensureAdmin(): Promise<void> {
  const count = await db.user.count({ where: { role: 'admin' } })
  if (count > 0) return
  const email = (process.env.ADMIN_EMAIL || 'admin@tutor.bd').trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD || 'admin1234'
  await db.user.create({
    data: {
      name: 'অ্যাডমিন',
      email,
      passwordHash: hashPassword(password),
      role: 'admin',
    },
  })
}
