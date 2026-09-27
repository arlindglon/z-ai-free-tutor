export type Piece = { idx: number; content: string; offsetChars: number }

/**
 * বইয়ের অধ্যায়ের লেখা → RAG-ফ্রেন্ডলি চাঙ্ক (~৮৫০ অক্ষর)
 * প্যারাগ্রাফ (দুই লাইন ফাঁক) অনুযায়ী ভাগ, লম্বা প্যারাগ্রাফ হলে বাক্য (। .) সীমানায় ভাগ
 */
export function chunkContent(content: string, target = 850, max = 1100): Piece[] {
  const paras = content
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)

  const chunks: string[] = []
  let cur = ''

  const pushCur = () => {
    if (cur) chunks.push(cur)
    cur = ''
  }

  for (const p of paras) {
    if (!cur) cur = p
    else if ((cur + '\n\n' + p).length <= target) cur += '\n\n' + p
    else {
      pushCur()
      if (p.length <= max) cur = p
      else {
        const sentences = p.split(/(?<=।|\.)\s+/)
        let sub = ''
        for (const s of sentences) {
          if (sub && (sub + ' ' + s).length > target) {
            chunks.push(sub)
            sub = s
          } else {
            sub = sub ? sub + ' ' + s : s
          }
        }
        if (sub) chunks.push(sub)
        cur = ''
      }
    }
  }
  pushCur()

  let acc = 0
  return chunks.map((c, idx) => {
    const offsetChars = acc
    acc += c.length
    return { idx, content: c, offsetChars }
  })
}

/**
 * অধ্যায়ের শুরু পৃষ্ঠা + অক্ষর-অফসেট থেকে আনুমানিক পৃষ্ঠা নম্বর
 * (স্কুলের বইয়ে প্রতি পৃষ্ঠায় ~১৫০০ অক্ষর ধরে হিসাব)
 */
export function estimatePage(offsetChars: number, pageStart: number | null): number | null {
  if (!pageStart || pageStart < 1) return null
  return pageStart + Math.floor(offsetChars / 1500)
}

export type PagePiece = { idx: number; content: string; page: number | null }

/** বাক্য বিভাজক — বাংলা দাঁড়ি (।/॥) ও ইংরেজি বিরামচিহ্ন */
function splitSentences(text: string, max = 1150): string[] {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return []
  const parts = flat
    .split(/(?<=[।॥.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)

  // খুব লম্বা বাক্য (টেবিল/সূচি) হলে অক্ষরে ভাগ
  const out: string[] = []
  for (const p of parts) {
    if (p.length <= max) {
      out.push(p)
      continue
    }
    for (let i = 0; i < p.length; i += max) out.push(p.slice(i, i + max))
  }
  return out
}

/**
 * PDF-এর পৃষ্ঠা-ভিত্তিক টেক্সট → চাঙ্ক (প্রকৃত পৃষ্ঠা নম্বরসহ!)
 * বাক্য-সীমায় ভাগ, পৃষ্ঠা শেষে চাঙ্ক যথেষ্ট বড় হলে সেখানেই বন্ধ —
 * ফলে রেফারেন্সের পৃষ্ঠা নম্বর প্রায় নির্ভুল থাকে।
 */
export function chunkPages(
  pagesText: { page: number; text: string }[],
  target = 850
): PagePiece[] {
  const chunks: PagePiece[] = []
  let cur = ''
  let curPage: number | null = null

  const close = () => {
    const content = cur.trim()
    if (content) chunks.push({ idx: chunks.length, content, page: curPage })
    cur = ''
    curPage = null
  }

  for (const { page, text } of pagesText) {
    for (const s of splitSentences(text)) {
      if (!cur) curPage = page
      else if (cur.length + s.length + 1 > target) {
        close()
        curPage = page
      }
      cur = cur ? `${cur} ${s}` : s
      if (cur.length >= target * 1.35) close()
    }
    // পৃষ্ঠা-সীমায় ভাগ — রেফারেন্স নির্ভুল রাখতে
    if (cur.length >= 380) close()
  }
  close()
  return chunks
}
