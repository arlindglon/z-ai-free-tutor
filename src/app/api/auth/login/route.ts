import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword } from '@/lib/password'
import { createSession, safeUser } from '@/lib/session'
import { ensureAdmin } from '@/lib/seed'
import { getSettings } from '@/lib/settings'
import { getUsedToday } from '@/lib/credits'

/** লগইন — স্টুডেন্ট একাউন্ট তার বাঁধা ডিভাইস ছাড়া খোলা যায় না */
export async function POST(req: NextRequest) {
  try {
    await ensureAdmin()
    const body = await req.json().catch(() => ({}))
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    const deviceHash = String(body.deviceHash ?? '').trim()

    const user = await db.user.findUnique({ where: { email } })
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json({ error: 'ইমেইল বা পাসওয়ার্ড ভুল।' }, { status: 401 })
    }

    // 🔒 ডিভাইস বাইন্ডিং (অ্যাডমিন বাদ — যেকোনো ডিভাইস থেকে লগইন করতে পারে)
    if (user.role !== 'admin' && user.deviceHash && deviceHash && user.deviceHash !== deviceHash) {
      return NextResponse.json(
        {
          code: 'DEVICE_MISMATCH',
          error: 'এই একাউন্টটি অন্য একটি ডিভাইসের সাথে বাঁধা। নিরাপত্তার জন্য এটি শুধু সেই ডিভাইস থেকেই ব্যবহার করা যাবে।',
        },
        { status: 403 }
      )
    }

    await createSession(user.id)

    const settings = await getSettings()
    const used = await getUsedToday(user.id)
    return NextResponse.json({
      user: safeUser(user),
      credits: { used, limit: user.role === 'admin' ? 0 : settings.dailyCredits },
    })
  } catch (e) {
    console.error('login error', e)
    return NextResponse.json({ error: 'লগইন করা গেল না, আবার চেষ্টা করো।' }, { status: 500 })
  }
}
