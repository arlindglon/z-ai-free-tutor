import { NextResponse } from 'next/server'
import { getSessionUser, safeUser } from '@/lib/session'
import { getSettings } from '@/lib/settings'
import { getUsedToday } from '@/lib/credits'

/** বর্তমান লগইন করা ইউজার + আজকের ক্রেডিট ব্যালেন্স */
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'লগইন করা নেই।' }, { status: 401 })

  const settings = await getSettings()
  const used = await getUsedToday(user.id)
  return NextResponse.json({
    user: safeUser(user),
    credits: { used, limit: user.role === 'admin' ? 0 : settings.dailyCredits },
  })
}
