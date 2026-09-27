import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, forbidden, unauthorized } from '@/lib/session'
import { invalidateKeyCache } from '@/lib/keypool'

function maskKey(key: string): string {
  if (key.length <= 12) return '••••••••'
  return `${key.slice(0, 6)}••••${key.slice(-4)}`
}

async function requireAdmin() {
  const user = await getSessionUser()
  if (!user) return { err: unauthorized() }
  if (user.role !== 'admin') return { err: forbidden() }
  return { user }
}

function toInfo(k: { id: string; label: string | null; key: string; active: boolean; lastError: string | null; createdAt: Date }) {
  return {
    id: k.id,
    label: k.label,
    masked: maskKey(k.key),
    active: k.active,
    lastError: k.lastError,
    createdAt: k.createdAt.toISOString(),
  }
}

/** কী-পুলের তালিকা */
export async function GET() {
  const { err } = await requireAdmin()
  if (err) return err
  const keys = await db.apiKey.findMany({ orderBy: { createdAt: 'asc' } })
  return NextResponse.json({ keys: keys.map(toInfo) })
}

/** নতুন Gemini API কী যোগ */
export async function POST(req: NextRequest) {
  const { err } = await requireAdmin()
  if (err) return err
  const body = await req.json().catch(() => ({}))
  const key = String(body.key ?? '').trim()
  const label = String(body.label ?? '').trim() || null

  if (key.length < 20) {
    return NextResponse.json({ error: 'API কী ঠিকমতো দাও (Google AI Studio থেকে কপি করো)।' }, { status: 400 })
  }
  const exists = await db.apiKey.findUnique({ where: { key } })
  if (exists) {
    return NextResponse.json({ error: 'এই কী আগেই যোগ করা হয়েছে।' }, { status: 409 })
  }
  const created = await db.apiKey.create({ data: { key, label } })
  invalidateKeyCache()
  return NextResponse.json({ key: toInfo(created) })
}

/** কী চালু/বন্ধ টগল */
export async function PATCH(req: NextRequest) {
  const { err } = await requireAdmin()
  if (err) return err
  const body = await req.json().catch(() => ({}))
  const id = String(body.id ?? '')
  const active = Boolean(body.active)
  const updated = await db.apiKey
    .update({ where: { id }, data: { active, lastError: active ? null : undefined } })
    .catch(() => null)
  if (!updated) return NextResponse.json({ error: 'কী খুঁজে পাওয়া গেল না।' }, { status: 404 })
  invalidateKeyCache()
  return NextResponse.json({ key: toInfo(updated) })
}
