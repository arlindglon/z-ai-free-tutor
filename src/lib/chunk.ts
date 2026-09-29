export type Piece = { idx: number; content: string; offsetChars: number }

export type PagePiece = { idx: number; content: string; page: number | null }

export type Block = { kind: 'text' | 'table' | 'heading'; content: string }

const IS_TABLE_ROW_RE = /^\s*\|/
const IS_HEADING_RE = /^\s*#{1,6}\s+\S/
const ALIGN_ROW_RE = /^[\s|:\-]+$/

/**
 * লেখাকে ব্লকে ভাগ — টেক্সট-প্যারা / টেবিল / শিরোনাম।
 * টেবিল ও শিরোনাম অ্যাটমিক: চাঙ্কিং-এ কখনো ভাঙবে না, ফলে মার্কডাউন
 * টেবিল/হেডিং হিসেবেই সুন্দর রেন্ডার হয় (রেফারেন্সে ও উত্তরে)।
 */
export function splitBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let textBuf: string[] = []
  let tableBuf: string[] = []

  const flushText = () => {
    if (textBuf.length) {
      const content = textBuf.join('\n').replace(/\n{3,}/g, '\n\n').trim()
      if (content) blocks.push({ kind: 'text', content })
      textBuf = []
    }
  }
  const flushTable = () => {
    if (tableBuf.length) {
      const content = tableBuf.join('\n').trim()
      if (content) blocks.push({ kind: 'table', content })
      tableBuf = []
    }
  }

  for (const ln of lines) {
    if (IS_TABLE_ROW_RE.test(ln)) {
      flushText()
      tableBuf.push(ln)
    } else {
      flushTable()
      if (IS_HEADING_RE.test(ln)) {
        flushText()
        const h = ln.trim()
        if (h) blocks.push({ kind: 'heading', content: h })
      } else {
        textBuf.push(ln)
      }
    }
  }
  flushText()
  flushTable()
  return blocks
}

/**
 * বাক্য বিভাজক — বাংলা দাঁড়ি (।/॥) ও ইংরেজি বিরামচিহ্ন।
 * লাইনের ভেতরের ফাঁক কমে, কিন্তু শিরোনাম/টেবিল আগেই আলাদা ব্লক — এখানে আসে না।
 */
function splitSentences(text: string, max = 1150): string[] {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)

  const out: string[] = []
  for (const para of paras) {
    const parts = para
      .split(/(?<=[।॥.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
    for (const p of parts) {
      if (p.length <= max) {
        out.push(p)
        continue
      }
      // খুব লম্বা বাক্য (টেবিল-হীন কিন্তু লম্বা লাইন) হলে অক্ষরে ভাগ
      for (let i = 0; i < p.length; i += max) out.push(p.slice(i, i + max))
    }
  }
  return out
}

/**
 * লম্বা টেবিল → সারি-গ্রুপে ভাগ (হেডার + অ্যালাইনমেন্ট রো প্রতিটি গ্রুপে রিপিট হয়,
 * তাই প্রতিটি চাঙ্ক নিজেই একটা সম্পূর্ণ রেন্ডার-যোগ্য টেবিল থাকে)
 */
function splitTableRows(content: string, max = 1150): string[] {
  if (content.length <= max) return [content]
  const lines = content.split('\n').filter((l) => l.trim())
  const header = lines[0]
  const align = lines.length > 1 && IS_TABLE_ROW_RE.test(lines[1]) && ALIGN_ROW_RE.test(lines[1]) ? lines[1] : null
  const rows = lines.slice(align ? 2 : 1)

  const headLen = header.length + (align ? align.length + 1 : 0)
  const groups: string[][] = []
  let g: string[] = []
  for (const r of rows) {
    if (g.length && g.join('\n').length + r.length + 1 > max - headLen) {
      groups.push(g)
      g = [r]
    } else {
      g.push(r)
    }
  }
  if (g.length) groups.push(g)

  const head = align ? `${header}\n${align}` : header
  return groups.map((grp) => `${head}\n${grp.join('\n')}`)
}

/** চাঙ্ক জমাকারী — টেক্সট বাক্য জোড়া লাগায়, টেবিল/শিরোনাম নিজের লাইনে রাখে */
function createAccumulator(target: number, out: PagePiece[]) {
  let cur = ''
  let curPage: number | null = null
  let lastWasBlock = false

  const close = () => {
    const content = cur.trim()
    if (content) out.push({ idx: out.length, content, page: curPage })
    cur = ''
    curPage = null
    lastWasBlock = false
  }

  const addText = (s: string, page: number | null) => {
    if (!cur) curPage = page
    else if (cur.length + s.length + 2 > target) {
      close()
      curPage = page
    }
    cur = cur ? (lastWasBlock ? `${cur}\n\n${s}` : `${cur} ${s}`) : s
    lastWasBlock = false
  }

  const addBlock = (s: string, page: number | null) => {
    if (!cur) curPage = page
    else if (cur.length + s.length + 2 > target) {
      close()
      curPage = page
    }
    cur = cur ? `${cur}\n\n${s}` : s
    lastWasBlock = true
  }

  return { close, addText, addBlock, get length() { return cur.length } }
}

/**
 * OCR-পরিষ্কার পৃষ্ঠার টেক্সট → চাঙ্ক (প্রকৃত পৃষ্ঠা নম্বরসহ!)
 * টেবিল-ব্লক অ্যাটমিক — বাক্য-সীমায় ভাঙে না; বড় টেবিল সারি-গ্রুপে ভাগ হয়।
 */
export function chunkPages(
  pagesText: { page: number; text: string }[],
  target = 850
): PagePiece[] {
  const out: PagePiece[] = []
  const acc = createAccumulator(target, out)

  for (const { page, text } of pagesText) {
    for (const block of splitBlocks(text)) {
      if (block.kind === 'table') {
        for (const piece of splitTableRows(block.content)) acc.addBlock(piece, page)
      } else if (block.kind === 'heading') {
        acc.addBlock(block.content, page)
      } else {
        for (const s of splitSentences(block.content)) acc.addText(s, page)
      }
    }
    // পৃষ্ঠা-সীমায় ভাগ — রেফারেন্স নির্ভুল রাখতে
    if (acc.length >= 380) acc.close()
  }
  acc.close()
  return out
}

/**
 * পরিষ্কার টেক্সট → RAG-ফ্রেন্ডলি চাঙ্ক (~৮৫০ অক্ষর)
 * টেবিল-সচেতন: টেবিল অ্যাটমিক থাকে, শিরোনাম নিজের লাইনে থাকে।
 */
export function chunkContent(content: string, target = 850, max = 1150): Piece[] {
  const out: PagePiece[] = []
  const acc = createAccumulator(target, out)

  for (const block of splitBlocks(content)) {
    if (block.kind === 'table') {
      for (const piece of splitTableRows(block.content, max + 200)) acc.addBlock(piece, null)
    } else if (block.kind === 'heading') {
      acc.addBlock(block.content, null)
    } else {
      for (const s of splitSentences(block.content, max)) acc.addText(s, null)
    }
  }
  acc.close()

  let accChars = 0
  return out.map((p) => {
    const piece = { idx: p.idx, content: p.content, offsetChars: accChars }
    accChars += p.content.length
    return piece
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
