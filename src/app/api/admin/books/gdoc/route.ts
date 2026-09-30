import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, forbidden, unauthorized } from '@/lib/session'

/**
 * Google Docs পাবলিক লিংক → ডকের পুরো টেক্সট ফেরত।
 * অ্যাডমিন লিংক দিলে এখান থেকে টেক্সট এনে ফর্মের textarea-তে ভরা হয় —
 * তারপর সাধারণ পেস্ট-পাইপলাইনই (পৃষ্ঠা ভাগ → অধ্যায় → চাঙ্ক → অটো-এমবেড) চলে।
 *
 * শর্ত: ডকের শেয়ারিং "লিংক জানা যে কেউ — Viewer" হতে হবে।
 * না হলে Google লগইন-পেজ দেয় — সেটা ধরে পরিষ্কার বাংলা এরর জানানো হয়।
 */

const MAX_TEXT_CHARS = 3_000_000 // ~৩০ লক্ষ অক্ষর — একটা পূর্ণ বইয়ের চেয়েও বেশি

/** "docs.google.com/document/d/{ID}/..." → ডক-আইডি; bare আইডিও চলবে */
function extractDocId(rawUrl: string): string | null {
  const s = rawUrl.trim()
  const m = s.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]{10,})/)
  if (m) return m[1]
  // ভুল করে অন্য Google লিংক দিলে পরিষ্কার বার্তার জন্য আলাদা শনাক্ত
  if (/docs\.google\.com|drive\.google\.com/i.test(s)) return null
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s // শুধু আইডি-ই পেস্ট করলে
  return null
}

/** লিংকের ধরন বুঝে নির্দিষ্ট বার্তা (Drive PDF/Sheet হলে আলাদা পথ দেখানো যায়) */
function linkKindHint(url: string): string | null {
  if (/drive\.google\.com\/file\/d\//i.test(url)) return 'drive-file'
  if (/docs\.google\.com\/spreadsheets/i.test(url)) return 'sheet'
  if (/docs\.google\.com\/presentation/i.test(url)) return 'slide'
  if (/docs\.google\.com\/forms/i.test(url)) return 'form'
  return null
}

/** এক্সপোর্ট রেসপন্স আসলে লগইন/এরর HTML কি না */
function looksLikeHtml(t: string): boolean {
  const head = t.slice(0, 2000).trim().toLowerCase()
  return head.startsWith('<!doctype') || head.startsWith('<html') || head.includes('<title>sign in')
}

/** /edit পেজের <title> থেকে ডকের নাম (best-effort — ফেল হলে null) */
async function fetchDocTitle(docId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://docs.google.com/document/d/${docId}/edit`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    })
    if (!res.ok) return null
    const html = (await res.text()).slice(0, 400_000)
    const m = html.match(/<title>([^<]{1,200})<\/title>/i)
    if (!m) return null
    // "কৃষি শিক্ষা - Google Docs" → "কৃষি শিক্ষা" (লোকাল-ভাষা যাই হোক)
    return m[1].replace(/\s*-\s*Google\s+[^-]*$/i, '').trim() || null
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return unauthorized()
  if (user.role !== 'admin') return forbidden()

  const body = await req.json().catch(() => ({}))
  const url = String(body.url ?? '').trim()
  if (!url) {
    return NextResponse.json({ error: 'Google Docs-এর লিংকটা দাও।' }, { status: 400 })
  }

  const kind = linkKindHint(url)
  if (kind) {
    const msg =
      kind === 'drive-file'
        ? 'এটা Google Drive-এর PDF লিংক — PDF থেকে সরাসরি বাংলা টেক্সট আনা যায় না। ধাপ ১-এর প্রম্পট দিয়ে Gemini-তে PDF স্ক্যান করে টেক্সট আনো, অথবা লেখাগুলো Google Docs-এ পেস্ট করে ডক-লিংক দাও।'
        : 'এটা Google Docs ডকুমেন্টের লিংক না (Sheet/Slide/Form) — ডকুমেন্ট (document/d/...) লিংক দাও।'
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  const docId = extractDocId(url)
  if (!docId) {
    return NextResponse.json(
      {
        error:
          'লিংকটা Google Docs ডকুমেন্টের মনে হচ্ছে না — docs.google.com/document/d/... দিয়ে শুরু হওয়া লিংক দাও।',
      },
      { status: 400 }
    )
  }

  // ডকের টেক্সট আনা — পাবলিক ভিউয়ার ডক হলে লগইন ছাড়াই আসে
  let text = ''
  try {
    const res = await fetch(`https://docs.google.com/document/d/${docId}/export?format=txt`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(30_000),
      redirect: 'follow',
    })
    if (res.status === 404) {
      return NextResponse.json(
        { error: 'ডকটা খুঁজে পাওয়া গেল না (404) — লিংকটা পুরোটা ঠিকমতো পেস্ট করো।' },
        { status: 400 }
      )
    }
    if (!res.ok) {
      return NextResponse.json(
        {
          error: `Google ডকটা দিল না (স্ট্যাটাস ${res.status}) — শেয়ারিং "লিংক জানা যে কেউ — Viewer" করা আছে কি না দেখো।`,
        },
        { status: 400 }
      )
    }
    text = await res.text()
  } catch {
    return NextResponse.json(
      { error: 'Google Docs-এ সংযোগ করা গেল না — ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করো।' },
      { status: 504 }
    )
  }

  // প্রাইভেট ডক হলে Google লগইন-পেজ দেয় — টেক্সটের বদলে HTML আসে
  if (looksLikeHtml(text)) {
    return NextResponse.json(
      {
        error:
          'ডকটা পাবলিক না — Google টেক্সটের বদলে লগইন-পেজ দিয়েছে। Docs-এ "Share" → "Anyone with the link" → "Viewer" করে আবার চেষ্টা করো।',
      },
      { status: 403 }
    )
  }

  text = text.replace(/^\uFEFF/, '').trim()
  if (text.length < 120) {
    return NextResponse.json(
      { error: 'ডকে যথেষ্ট লেখা পাওয়া গেল না (অন্তত ১২০ অক্ষর দরকার) — খালি/অসম্পূর্ণ ডক হতে পারে।' },
      { status: 422 }
    )
  }
  if (text.length > MAX_TEXT_CHARS) {
    return NextResponse.json(
      {
        error: `ডকটা অনেক বড় (${text.length} অক্ষর) — অর্ধেক টেক্সট আলাদা ডকে রেখে ব্যাচে ব্যাচে আনো।`,
      },
      { status: 413 }
    )
  }

  // বইয়ের নাম best-effort — ফর্মে আগে থেকে নাম থাকলে নাকোচ করি না
  const title = await fetchDocTitle(docId)

  // ফর্মের অ্যাপেন্ড-সিলেক্ট ভরার জন্য বইয়ের তালিকাও পাঠাই
  const existingBooks = await db.book.findMany({
    select: { id: true, title: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  return NextResponse.json({ text, title, books: existingBooks })
}
