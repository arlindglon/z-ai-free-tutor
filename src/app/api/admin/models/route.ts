import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getSessionUser, forbidden, unauthorized } from '@/lib/session'
import { invalidateModelCache, ensureModelsSeeded } from '@/lib/models'
import { isEngineId } from '@/lib/key-format'
import type { EngineId, ModelInfo } from '@/lib/types'

/**
 * মডেল রেজিস্ট্রি — ইঞ্জিন প্রতি চ্যাট মডেলের সম্পূর্ণ নিয়ন্ত্রণ:
 * - নতুন মডেল বাজারে এলে অ্যাডমিন শুধু নাম যোগ/বদল করবে — কোড ছোঁয়ার দরকার নেই
 * - প্রতিটা মডেলের নিজস্ব on/off, স্বাক্ষর পুল (aliases) আর ব্যবহার-হিসাব
 */

async function requireAdmin() {
  const user = await getSessionUser()
  if (!user) return { err: unauthorized() }
  if (user.role !== 'admin') return { err: forbidden() }
  return { user }
}

function dbError(e: unknown): { status: number; error: string } {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') {
      return { status: 409, error: 'এই মডেলটা এই ইঞ্জিনে আগেই আছে — তালিকায় দেখো।' }
    }
    if (e.code === 'P2021') {
      return {
        status: 500,
        error: 'ডাটাবেসে AiModel টেবিল নেই — টার্মিনালে "DATABASE_URL=<TiDB URL> bunx prisma db push" চালাও।',
      }
    }
    if (e.code === 'P2022') {
      return {
        status: 500,
        error: 'ডাটাবেসের স্কিমা পুরনো (কলাম নেই) — টার্মিনালে "DATABASE_URL=<TiDB URL> bunx prisma db push" চালাও।',
      }
    }
    return { status: 500, error: `ডাটাবেস সমস্যা (কোড: ${e.code}) — আবার চেষ্টা করো।` }
  }
  console.error('[admin/models] ডাটাবেস এরর:', e)
  return { status: 500, error: 'সার্ভারে সমস্যা হয়েছে — আবার চেষ্টা করো।' }
}

/** API মডেল আইডি পরিষ্কার — স্পেস বাদ, "models/" প্রিফিক্স বাদ (কপি-পেস্ট নিরাপদ) */
function cleanModelId(raw: string): string {
  return raw
    .replace(/\s+/g, '')
    .replace(/^models\//i, '')
    .slice(0, 120)
}

function isValidModelId(id: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._/-]{1,119}$/.test(id)
}

/** মডেল তালিকা (দুই ইঞ্জিনেই) + প্রতিটার স্বাক্ষর + ব্যবহার-হিসাব */
export async function GET() {
  const { err } = await requireAdmin()
  if (err) return err
  try {
    await ensureModelsSeeded()
    const [models, usage] = await Promise.all([
      db.aiModel.findMany({
        include: { aliases: { orderBy: { createdAt: 'asc' } } },
        orderBy: [{ engine: 'asc' }, { createdAt: 'asc' }],
      }),
      db.question.groupBy({
        by: ['answerModel'],
        _count: { _all: true },
        where: { answerModel: { not: null } },
      }),
    ])
    const usageMap = new Map(usage.map((u) => [u.answerModel, u._count._all]))
    const list: ModelInfo[] = models.map((m) => ({
      id: m.id,
      engine: isEngineId(m.engine) ? m.engine : 'gemini',
      modelId: m.modelId,
      label: m.label,
      active: m.active,
      usageCount: usageMap.get(m.modelId) ?? 0,
      aliases: m.aliases.map((a) => ({ id: a.id, alias: a.alias })),
      createdAt: m.createdAt.toISOString(),
    }))
    return NextResponse.json({ models: list })
  } catch (e) {
    const { status, error } = dbError(e)
    return NextResponse.json({ error }, { status })
  }
}

/** নতুন মডেল যোগ (ইঞ্জিন বেছে) */
export async function POST(req: NextRequest) {
  const { err } = await requireAdmin()
  if (err) return err
  const body = await req.json().catch(() => ({}))
  const engine: EngineId = isEngineId(body.engine) ? body.engine : 'gemini'
  const modelId = cleanModelId(String(body.modelId ?? ''))
  const label = String(body.label ?? '').trim().slice(0, 120) || null

  if (!isValidModelId(modelId)) {
    return NextResponse.json(
      { error: 'মডেল আইডি ঠিকমতো লেখো — যেমন gemini-3.5-flash-lite বা glm-4.5-flash (২–১২০ অক্ষর, স্পেস ছাড়া)।' },
      { status: 400 }
    )
  }

  try {
    const exists = await db.aiModel.findUnique({ where: { engine_modelId: { engine, modelId } } })
    if (exists) {
      return NextResponse.json(
        {
          error: `${engine === 'zai' ? 'Z.ai GLM' : 'জেমিনাই'} ইঞ্জিনে "${modelId}" আগেই আছে — তালিকায় দেখো।`,
        },
        { status: 409 }
      )
    }
    const created = await db.aiModel.create({ data: { engine, modelId, label } })
    invalidateModelCache()
    return NextResponse.json({ model: { id: created.id } })
  } catch (e) {
    const { status, error } = dbError(e)
    return NextResponse.json({ error }, { status })
  }
}

/** মডেল চালু/বন্ধ টগল + নাম/লেবেল বদলানো */
export async function PATCH(req: NextRequest) {
  const { err } = await requireAdmin()
  if (err) return err
  const body = await req.json().catch(() => ({}))
  const id = String(body.id ?? '')
  if (!id) return NextResponse.json({ error: 'মডেল খুঁজে পাওয়া গেল না।' }, { status: 404 })

  const data: { active?: boolean; modelId?: string; label?: string | null } = {}
  if (typeof body.active === 'boolean') data.active = body.active
  if (body.modelId !== undefined) {
    const modelId = cleanModelId(String(body.modelId))
    if (!isValidModelId(modelId)) {
      return NextResponse.json(
        { error: 'মডেল আইডি ঠিকমতো লেখো — স্পেস ছাড়া, ২–১২০ অক্ষর।' },
        { status: 400 }
      )
    }
    data.modelId = modelId
  }
  if (body.label !== undefined) {
    data.label = String(body.label ?? '').trim().slice(0, 120) || null
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'বদলানোর কিছু নেই।' }, { status: 400 })
  }

  try {
    const existing = await db.aiModel.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'মডেল খুঁজে পাওয়া গেল না।' }, { status: 404 })
    if (data.modelId && data.modelId !== existing.modelId) {
      const clash = await db.aiModel.findUnique({
        where: { engine_modelId: { engine: existing.engine, modelId: data.modelId } },
      })
      if (clash) {
        return NextResponse.json(
          { error: `এই ইঞ্জিনে "${data.modelId}" আগেই আছে — তালিকায় দেখো।` },
          { status: 409 }
        )
      }
    }
    await db.aiModel.update({ where: { id }, data })
    invalidateModelCache()
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { status, error } = dbError(e)
    return NextResponse.json({ error }, { status })
  }
}

/** মডেল মুছে ফেলা (স্বাক্ষরগুলোও একসাথে মুছে যায়) */
export async function DELETE(req: NextRequest) {
  const { err } = await requireAdmin()
  if (err) return err
  const id = req.nextUrl.searchParams.get('id') ?? ''
  try {
    await db.aiModel.delete({ where: { id } })
    invalidateModelCache()
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'মডেল খুঁজে পাওয়া গেল না।' }, { status: 404 })
  }
}
