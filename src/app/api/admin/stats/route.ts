import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, forbidden, unauthorized } from '@/lib/session'
import { startOfDhakaDay } from '@/lib/tz'

/** ড্যাশবোর্ড পরিসংখ্যান */
export async function GET() {
  const user = await getSessionUser()
  if (!user) return unauthorized()
  if (user.role !== 'admin') return forbidden()

  const [
    users,
    questionsToday,
    totalQuestions,
    totalChunks,
    embeddedChunks,
    activeKeys,
    totalKeys,
    cachedAnswers,
    cacheAgg,
  ] = await Promise.all([
    db.user.count({ where: { role: 'student' } }),
    db.question.count({ where: { createdAt: { gte: startOfDhakaDay() } } }),
    db.question.count(),
    db.chunk.count(),
    db.chunk.count({ where: { embedded: true } }),
    db.apiKey.count({ where: { active: true } }),
    db.apiKey.count(),
    db.answerCache.count(),
    db.answerCache.aggregate({ _sum: { hits: true } }),
  ])

  return NextResponse.json({
    users,
    questionsToday,
    totalQuestions,
    totalChunks,
    embeddedChunks,
    activeKeys,
    totalKeys,
    cachedAnswers,
    cacheHits: cacheAgg._sum.hits ?? 0,
  })
}
