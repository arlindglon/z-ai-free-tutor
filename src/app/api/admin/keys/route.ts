import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getSessionUser, forbidden, unauthorized } from '@/lib/session'
import { invalidateKeyCache } from '@/lib/keypool'
import { detectKeyEngine } from '@/lib/key-format'

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

function toInfo(k: {
  id: string
  engine: string
  label: string | null
  key: string
  active: boolean
  lastError: string | null
  createdAt: Date
}) {
  return {
    id: k.id,
    engine: k.engine === 'zai' ? 'zai' : 'gemini',
    label: k.label,
    masked: maskKey(k.key),
    active: k.active,
    lastError: k.lastError,
    createdAt: k.createdAt.toISOString(),
  }
}

/**
 * Prisma এরর → পরিষ্কার বাংলা কারণ। এতে অ্যাডমিন অন্ধ "আবার চেষ্টা করো"
 * না দেখে সরাসরি জানতে পারে আসল সমস্যা কী (ডুপ্লিকেট / পুরনো স্কিমা / ডাটাবেস)।
 */
function dbError(e: unknown): { status: number; error: string } {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') {
      return { status: 409, error: 'এই কী আগেই যোগ করা আছে — নিচের তালিকায় দেখো।' }
    }
    if (e.code === 'P2021') {
      return {
        status: 500,
        error: 'প্রোডাকশন ডাটাবেসে ApiKey টেবিল নেই — টার্মিনালে "DATABASE_URL=<TiDB URL> bunx prisma db push" চালাও।',
      }
    }
    if (e.code === 'P2022') {
      return {
        status: 500,
        error: 'প্রোডাকশন ডাটাবেসের স্কিমা পুরনো (কলাম নেই) — টার্মিনালে "DATABASE_URL=<TiDB URL> bunx prisma db push" চালাও।',
      }
    }
    return { status: 500, error: `ডাটাবেস সমস্যা (কোড: ${e.code}) — আবার চেষ্টা করো।` }
  }
  console.error('[admin/keys] ডাটাবেস এরর:', e)
  return { status: 500, error: 'সার্ভারে সমস্যা হয়েছে — আবার চেষ্টা করো।' }
}

/** কী-পুলের তালিকা */
export async function GET() {
  const { err } = await requireAdmin()
  if (err) return err
  try {
    const keys = await db.apiKey.findMany({ orderBy: [{ engine: 'asc' }, { createdAt: 'asc' }] })
    return NextResponse.json({ keys: keys.map(toInfo) })
  } catch (e) {
    const { status, error } = dbError(e)
    return NextResponse.json({ error }, { status })
  }
}

/** নতুন API কী যোগ (Gemini বা Z.ai — কী-এর আকৃতি থেকে ইঞ্জিন অটো-শনাক্ত) */
export async function POST(req: NextRequest) {
  const { err } = await requireAdmin()
  if (err) return err
  const body = await req.json().catch(() => ({}))
  // কপি-পেস্টে স্পেস/নিউলাইন ঢুকে গেলেও কী ঠিক থাকে
  const key = String(body.key ?? '').replace(/\s+/g, '')
  const label = String(body.label ?? '').trim() || null
  // ফরম্যাট থেকে ইঞ্জিন বের করো — ড্রপডাউন ভুল থাকলেও অটো ঠিক হয়ে যায়
  const engine = detectKeyEngine(key) ?? (body.engine === 'zai' ? 'zai' : 'gemini')

  if (key.length < 20) {
    return NextResponse.json(
      {
        error:
          engine === 'zai'
            ? 'Z.ai API কী ঠিকমতো দাও (z.ai Model API থেকে কপি করো)।'
            : 'API কী ঠিকমতো দাও (Google AI Studio থেকে কপি করো)।',
      },
      { status: 400 }
    )
  }

  try {
    const exists = await db.apiKey.findUnique({ where: { key } })
    if (exists) {
      return NextResponse.json(
        { error: `এই কী আগেই যোগ করা আছে (${exists.engine === 'zai' ? 'Z.ai GLM' : 'জেমিনাই'}) — নিচের তালিকায় দেখো।` },
        { status: 409 }
      )
    }
    const created = await db.apiKey.create({ data: { key, label, engine } })
    invalidateKeyCache()
    return NextResponse.json({ key: toInfo(created) })
  } catch (e) {
    const { status, error } = dbError(e)
    return NextResponse.json({ error }, { status })
  }
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
