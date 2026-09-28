import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getSessionUser, forbidden, unauthorized } from '@/lib/session'
import { invalidateModelCache } from '@/lib/models'

/**
 * মডেল-প্রতি স্বাক্ষর পুল — প্রতি লাইনে একটা করে নাম/কোড, যত খুশি যোগ করা যায়।
 * উত্তর দেওয়ার সময় জেতা মডেলের পুল থেকে র‍্যান্ডম একটা বেছে উত্তরে বসানো হয়।
 */

const MAX_ALIASES_PER_MODEL = 500 // সেফটি ক্যাপ
const ALIAS_MIN = 2
const ALIAS_MAX = 40

async function requireAdmin() {
  const user = await getSessionUser()
  if (!user) return { err: unauthorized() }
  if (user.role !== 'admin') return { err: forbidden() }
  return { user }
}

function dbError(e: unknown): { status: number; error: string } {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') {
      return { status: 409, error: 'এই স্বাক্ষর আগেই আছে — একই নাম দুই জায়গায় চলবে না।' }
    }
    if (e.code === 'P2021' || e.code === 'P2022') {
      return {
        status: 500,
        error: 'ডাটাবেসের স্কিমা পুরনো — টার্মিনালে "DATABASE_URL=<TiDB URL> bunx prisma db push" চালাও।',
      }
    }
    return { status: 500, error: `ডাটাবেস সমস্যা (কোড: ${e.code}) — আবার চেষ্টা করো।` }
  }
  console.error('[admin/models/aliases] ডাটাবেস এরর:', e)
  return { status: 500, error: 'সার্ভারে সমস্যা হয়েছে — আবার চেষ্টা করো।' }
}

/** স্বাক্ষর যোগ — টেক্সটেআরিয়ার লাইনগুলো একসাথে (এক লাইনে একটা নাম/কোড) */
export async function POST(req: NextRequest) {
  const { err } = await requireAdmin()
  if (err) return err
  const body = await req.json().catch(() => ({}))
  const aiModelId = String(body.aiModelId ?? '')
  const raw = Array.isArray(body.aliases)
    ? body.aliases.map((a: unknown) => String(a))
    : String(body.aliases ?? '').split('\n')

  const lines = raw
    .map((l: string) => l.trim())
    .filter((l: string) => l.length > 0)
  if (!aiModelId) return NextResponse.json({ error: 'মডেল খুঁজে পাওয়া গেল না।' }, { status: 404 })
  if (lines.length === 0) {
    return NextResponse.json({ error: 'অন্তত একটা নাম/কোড লেখো।' }, { status: 400 })
  }

  try {
    const model = await db.aiModel.findUnique({ where: { id: aiModelId } })
    if (!model) return NextResponse.json({ error: 'মডেল খুঁজে পাওয়া গেল না।' }, { status: 404 })

    const existingCount = await db.modelAlias.count({ where: { aiModelId } })
    const room = MAX_ALIASES_PER_MODEL - existingCount
    if (room <= 0) {
      return NextResponse.json(
        { error: `এই মডেলে সর্বোচ্চ ${MAX_ALIASES_PER_MODEL}টা স্বাক্ষর রাখা যায় — আগে কিছু মুছে ফেলো।` },
        { status: 400 }
      )
    }

    // ডুপ্লিকেট আগেই বাদ — একই রিকোয়েস্টে + ডাটাবেসে (ছোট-বড় হাতের পার্থক্য ছাড়া)
    const [allAliases, seen] = await Promise.all([
      db.modelAlias.findMany({ select: { alias: true } }),
      new Set<string>(),
    ])
    const taken = new Set(allAliases.map((a) => a.alias.toLowerCase()))
    let added = 0
    let skipped = 0
    for (let i = 0; i < lines.length; i++) {
      if (added >= room) {
        skipped += lines.length - i // আর জায়গা নেই — বাকিগুলো বাদ
        break
      }
      const alias = lines[i].slice(0, ALIAS_MAX)
      if (alias.length < ALIAS_MIN) {
        skipped++
        continue
      }
      const lower = alias.toLowerCase()
      if (seen.has(lower) || taken.has(lower)) {
        skipped++
        continue
      }
      seen.add(lower)
      try {
        await db.modelAlias.create({ data: { aiModelId, alias } })
        added++
      } catch (e) {
        // রেসে অন্য রিকোয়েস্ট আগে ঢুকিয়ে ফেললে শুধু ওই লাইনটা স্কিপ
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          skipped++
          continue
        }
        throw e
      }
    }
    invalidateModelCache()
    return NextResponse.json({
      added,
      skipped,
      message:
        added > 0
          ? `${added}টা স্বাক্ষর যোগ হয়েছে${skipped > 0 ? ` (${skipped}টা বাদ — ডুপ্লিকেট/ছোট)` : ''} ✓`
          : 'কোনোটাই যোগ হয়নি — সবগুলো আগেই ছিল বা খুব ছোট (২ অক্ষরের কম)।',
    })
  } catch (e) {
    const { status, error } = dbError(e)
    return NextResponse.json({ error }, { status })
  }
}

/** একটা স্বাক্ষর মুছে ফেলা */
export async function DELETE(req: NextRequest) {
  const { err } = await requireAdmin()
  if (err) return err
  const id = req.nextUrl.searchParams.get('id') ?? ''
  try {
    await db.modelAlias.delete({ where: { id } })
    invalidateModelCache()
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'স্বাক্ষর খুঁজে পাওয়া গেল না।' }, { status: 404 })
  }
}
