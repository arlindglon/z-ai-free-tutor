import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, forbidden, unauthorized } from '@/lib/session'
import { SUBJECTS } from '@/lib/bn'

async function requireAdmin() {
  const user = await getSessionUser()
  if (!user) return { err: unauthorized() }
  if (user.role !== 'admin') return { err: forbidden() }
  return { user }
}

// NCTB-র অফিসিয়াল স্তর তালিকা — প্রথমবার অটো-সিড হয়, পরে অ্যাডমিন ইচ্ছেমতো বদলাতে পারে
export const DEFAULT_LEVELS = [
  'প্রাক-প্রাথমিক স্তর',
  'প্রাথমিক স্তর',
  'ইবতেদায়ি স্তর',
  'ক্ষুদ্র নৃ-গোষ্ঠী',
  'মাধ্যমিক স্তর',
  'দাখিল স্তর',
  'কারিগরি স্তর',
  'উচ্চ মাধ্যমিক স্তর',
]

const CATEGORY_TYPES = ['level', 'subject'] as const
type CategoryType = (typeof CATEGORY_TYPES)[number]

function isCategoryType(v: unknown): v is CategoryType {
  return typeof v === 'string' && (CATEGORY_TYPES as readonly string[]).includes(v)
}

/** প্রথমবার খালি থাকলে ডিফল্ট স্তর + বিষয় বসাও */
async function ensureSeeded() {
  const [levelCount, subjectCount] = await Promise.all([
    db.category.count({ where: { type: 'level' } }),
    db.category.count({ where: { type: 'subject' } }),
  ])
  if (levelCount === 0) {
    for (const name of DEFAULT_LEVELS) {
      await db.category.upsert({
        where: { type_name: { type: 'level', name } },
        update: {},
        create: { type: 'level', name },
      })
    }
  }
  if (subjectCount === 0) {
    for (const name of SUBJECTS) {
      await db.category.upsert({
        where: { type_name: { type: 'subject', name } },
        update: {},
        create: { type: 'subject', name },
      })
    }
  }
}

function dbError(e: unknown) {
  const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : ''
  if (code === 'P2002') {
    return NextResponse.json({ error: 'এই নামটি আগেই আছে — অন্য নাম দাও।' }, { status: 409 })
  }
  if (code === 'P2021' || code === 'P2022') {
    return NextResponse.json(
      { error: 'ডাটাবেস টেবিল নেই — DATABASE_URL ঠিক করে `bunx prisma db push` চালাও।' },
      { status: 500 }
    )
  }
  console.error('categories api error', e)
  return NextResponse.json({ error: 'সমস্যা হয়েছে, আবার চেষ্টা করো।' }, { status: 500 })
}

/** স্তর + বিষয় তালিকা (খালি হলে ডিফল্ট সিড হয়) */
export async function GET() {
  const { err } = await requireAdmin()
  if (err) return err

  try {
    await ensureSeeded()
    const rows = await db.category.findMany({ orderBy: [{ type: 'asc' }, { name: 'asc' }] })
    return NextResponse.json({
      levels: rows.filter((r) => r.type === 'level').map((r) => ({ id: r.id, name: r.name })),
      subjects: rows.filter((r) => r.type === 'subject').map((r) => ({ id: r.id, name: r.name })),
    })
  } catch (e) {
    return dbError(e)
  }
}

/** নতুন স্তর/বিষয় যোগ */
export async function POST(req: NextRequest) {
  const { err } = await requireAdmin()
  if (err) return err

  const body = await req.json().catch(() => ({}))
  const type = body.type
  const name = String(body.name ?? '').trim()

  if (!isCategoryType(type)) {
    return NextResponse.json({ error: 'ধরন ভুল — level বা subject হতে হবে।' }, { status: 400 })
  }
  if (name.length < 1 || name.length > 60) {
    return NextResponse.json({ error: 'নাম ১–৬০ অক্ষরের মধ্যে দাও।' }, { status: 400 })
  }

  try {
    const row = await db.category.upsert({
      where: { type_name: { type, name } },
      update: {},
      create: { type, name },
    })
    return NextResponse.json({ category: { id: row.id, name: row.name } }, { status: 201 })
  } catch (e) {
    return dbError(e)
  }
}

/** নাম বদলানো */
export async function PATCH(req: NextRequest) {
  const { err } = await requireAdmin()
  if (err) return err

  const body = await req.json().catch(() => ({}))
  const id = String(body.id ?? '').trim()
  const name = String(body.name ?? '').trim()

  if (!id) return NextResponse.json({ error: 'id দাও।' }, { status: 400 })
  if (name.length < 1 || name.length > 60) {
    return NextResponse.json({ error: 'নাম ১–৬০ অক্ষরের মধ্যে দাও।' }, { status: 400 })
  }

  try {
    const existing = await db.category.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'খুঁজে পাওয়া গেল না।' }, { status: 404 })
    const dup = await db.category.findUnique({
      where: { type_name: { type: existing.type, name } },
    })
    if (dup && dup.id !== id) {
      return NextResponse.json({ error: 'এই নামটি আগেই আছে — অন্য নাম দাও।' }, { status: 409 })
    }
    const row = await db.category.update({ where: { id }, data: { name } })
    return NextResponse.json({ category: { id: row.id, name: row.name } })
  } catch (e) {
    return dbError(e)
  }
}

/** মুছে ফেলা — বইয়ে স্তর/বিষয় আলাদা টেক্সট হিসেবে জমা থাকে, তাই মুছলেও পুরনো বইয়ের কিছু যায় না */
export async function DELETE(req: NextRequest) {
  const { err } = await requireAdmin()
  if (err) return err

  const id = req.nextUrl.searchParams.get('id')?.trim()
  if (!id) return NextResponse.json({ error: 'id দাও।' }, { status: 400 })

  try {
    await db.category.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const code =
      typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : ''
    if (code === 'P2025') return NextResponse.json({ error: 'খুঁজে পাওয়া গেল না।' }, { status: 404 })
    return dbError(e)
  }
}
