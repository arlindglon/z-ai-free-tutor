/** সার্ভার-সাইড সেশন (httpOnly কুকি + DB টোকেন) */

const COOKIE_NAME = 'tutor_session'
const SESSION_DAYS = 30

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import type { User } from '@prisma/client'

export async function createSession(userId: string): Promise<void> {
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000)
  await db.session.create({ data: { id: token, userId, expiresAt } })
  const jar = await cookies()
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false, // স্যান্ডবক্স প্রিভিউ http/https দুটোতেই কাজ করার জন্য
    path: '/',
    expires: expiresAt,
  })
}

export async function getSessionUser(): Promise<User | null> {
  const jar = await cookies()
  const token = jar.get(COOKIE_NAME)?.value
  if (!token) return null
  const session = await db.session.findUnique({ where: { id: token }, include: { user: true } })
  if (!session) return null
  if (session.expiresAt.getTime() < Date.now()) {
    await db.session.delete({ where: { id: token } }).catch(() => {})
    return null
  }
  return session.user
}

export async function destroySession(): Promise<void> {
  const jar = await cookies()
  const token = jar.get(COOKIE_NAME)?.value
  if (token) {
    await db.session.deleteMany({ where: { id: token } }).catch(() => {})
  }
  jar.delete(COOKIE_NAME)
}

export function safeUser(user: User) {
  return { id: user.id, name: user.name, email: user.email, role: user.role as 'student' | 'admin' }
}

export function unauthorized() {
  return NextResponse.json({ error: 'লগইন করা নেই। আগে লগইন করো।' }, { status: 401 })
}

export function forbidden() {
  return NextResponse.json({ error: 'এই কাজের অনুমতি তোমার নেই।' }, { status: 403 })
}
