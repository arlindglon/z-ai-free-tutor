import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, unauthorized } from '@/lib/session'

/** শেষ ৩০টি প্রশ্ন-উত্তর (পুরনো → নতুন ক্রমে) */
export async function GET() {
  const user = await getSessionUser()
  if (!user) return unauthorized()

  const rows = await db.question.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })

  return NextResponse.json({
    messages: rows.reverse().map((r) => ({
      id: r.id,
      question: r.question,
      answer: r.answer,
      references: r.references,
      createdAt: r.createdAt.toISOString(),
    })),
  })
}
