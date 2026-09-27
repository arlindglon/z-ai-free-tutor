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
