import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, forbidden, unauthorized } from '@/lib/session'
import { invalidateChunkCache } from '@/lib/rag'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return unauthorized()
  if (user.role !== 'admin') return forbidden()

  const { id } = await params
  await db.book.delete({ where: { id } }).catch(() => {})
  invalidateChunkCache()
  return NextResponse.json({ ok: true })
}
