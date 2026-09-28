import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, forbidden, unauthorized } from '@/lib/session'
import { getSettings, putSettings } from '@/lib/settings'

/** সিস্টেম সেটিংস — মডেল নাম, দৈনিক কোটা */
export async function GET() {
  const user = await getSessionUser()
  if (!user) return unauthorized()
  if (user.role !== 'admin') return forbidden()
  const settings = await getSettings()
  return NextResponse.json({ settings })
}

export async function PUT(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return unauthorized()
  if (user.role !== 'admin') return forbidden()

  const body = await req.json().catch(() => ({}))
  const settings = await putSettings({
    chatModel: body.chatModel !== undefined ? String(body.chatModel) : undefined,
    embeddingModel: body.embeddingModel !== undefined ? String(body.embeddingModel) : undefined,
    dailyCredits: body.dailyCredits !== undefined ? Number(body.dailyCredits) : undefined,
    primaryEngine:
      body.primaryEngine === 'gemini' || body.primaryEngine === 'zai'
        ? body.primaryEngine
        : undefined,
    geminiEnabled: typeof body.geminiEnabled === 'boolean' ? body.geminiEnabled : undefined,
    zaiEnabled: typeof body.zaiEnabled === 'boolean' ? body.zaiEnabled : undefined,
    fallbackEnabled: typeof body.fallbackEnabled === 'boolean' ? body.fallbackEnabled : undefined,
    tagNameGemini: body.tagNameGemini !== undefined ? String(body.tagNameGemini) : undefined,
    tagNameZai: body.tagNameZai !== undefined ? String(body.tagNameZai) : undefined,
    ragOnlyMode: typeof body.ragOnlyMode === 'boolean' ? body.ragOnlyMode : undefined,
  })
  return NextResponse.json({ settings })
}
