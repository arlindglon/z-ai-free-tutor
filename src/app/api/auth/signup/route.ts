import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/password'
import { createSession, safeUser } from '@/lib/session'
import { ensureAdmin } from '@/lib/seed'
import { getSettings } from '@/lib/settings'

/**
 * সাইন-আপ — ডিভাইস লক চেকসহ:
 * একই deviceHash দিয়ে দ্বিতীয় একাউন্ট খোলা যাবে না (ক্যাশ ক্লিয়ার/ইনকগনিটোতেও না)
 */
export async function POST(req: NextRequest) {
  try {
    await ensureAdmin()
    const body = await req.json().catch(() => ({}))
    const name = String(body.name ?? '').trim()
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    const deviceHash = String(body.deviceHash ?? '').trim()

    if (name.length < 2) {
      return NextResponse.json({ code: 'BAD_NAME', error: 'নাম কমপক্ষে ২ অক্ষরের দাও।' }, { status: 400 })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ code: 'BAD_EMAIL', error: 'সঠিক ইমেইল লেখো।' }, { status: 400 })
    }
    if (password.length < 6) {
      return NextResponse.json({ code: 'BAD_PASSWORD', error: 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের দাও।' }, { status: 400 })
    }
    if (deviceHash.length < 16) {
      return NextResponse.json(
        { code: 'BAD_DEVICE', error: 'ডিভাইস যাচাই হয়নি — পেজ রিলোড করে আবার চেষ্টা করো।' },
        { status: 400 }
      )
    }

    // 🔒 এক ডিভাইসে একটাই ফ্রি একাউন্ট
    const deviceUser = await db.user.findUnique({ where: { deviceHash } })
    if (deviceUser) {
      return NextResponse.json(
        {
          code: 'DEVICE_EXISTS',
          error: 'এই ডিভাইসে ইতিমধ্যে একটি একাউন্ট আছে! এক ডিভাইসে শুধুমাত্র একটি ফ্রি একাউন্ট করা যায়। লগইন করে দেখো।',
        },
        { status: 409 }
      )
    }

    const emailUser = await db.user.findUnique({ where: { email } })
    if (emailUser) {
      return NextResponse.json(
        { code: 'EMAIL_EXISTS', error: 'এই ইমেইলে ইতিমধ্যে একাউন্ট আছে — লগইন করো।' },
        { status: 409 }
      )
    }

    const user = await db.user.create({
      data: { name, email, passwordHash: hashPassword(password), role: 'student', deviceHash },
    })
    await createSession(user.id)

    const settings = await getSettings()
    return NextResponse.json({
      user: safeUser(user),
      credits: { used: 0, limit: settings.dailyCredits },
    })
  } catch (e) {
    console.error('signup error', e)
    return NextResponse.json({ error: 'সাইন-আপ করা গেল না, আবার চেষ্টা করো।' }, { status: 500 })
  }
}
