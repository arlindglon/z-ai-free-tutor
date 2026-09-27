/**
 * PDF → টেক্সট পাইপলাইন (সম্পূর্ণ অটোমেটিক)
 * অ্যাডমিন শুধু PDF আপলোড করবে — এখানে স্বয়ংক্রিয়ভাবে:
 *  ১) পৃষ্ঠা-ভিত্তিক টেক্সট বের করা (unpdf / pdf.js)
 *  ২) হেডার-ফুটার ও পৃষ্ঠা-নম্বরের লাইন পরিষ্কার করা
 *  ৩) "অধ্যায় / পাঠ / Chapter" শিরোনাম চিনে অধ্যায়ে ভাগ করা
 */
import { extractText, getDocumentProxy } from 'unpdf'

export type PdfSection = {
  title: string
  number: number | null
  startPage: number // 1-based
  endPage: number // exclusive
}

export type PdfExtractResult = {
  pageCount: number
  pages: { page: number; text: string }[]
  sections: PdfSection[]
  totalChars: number
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯'

/** বাংলা সংখ্যা → ইংরেজি সংখ্যা (না পারলে NaN) */
function bnToNumber(s: string): number {
  const clean = s.trim()
  if (/^[0-9]+$/.test(clean)) return parseInt(clean, 10)
  if (!/^[০-৯]+$/.test(clean)) return NaN
  let n = 0
  for (const ch of clean) {
    const d = BN_DIGITS.indexOf(ch)
    if (d < 0) return NaN
    n = n * 10 + d
  }
  return n
}

/** এক লাইন কি শুধু পৃষ্ঠা-নম্বর? (যেমন: "৪৫", "12", "- 13 -") */
function isPageNumberLine(line: string): boolean {
  return /[০-৯0-9]/.test(line) && /^[০-৯0-9\s\-–—.|·:]+$/.test(line)
}

/** পৃষ্ঠার কাঁচা টেক্সট → পরিষ্কার লাইনগুলো */
function cleanLines(raw: string): string[] {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0 && !isPageNumberLine(l))
}

/**
 * সব পৃষ্ঠায় বারবার আসা লাইন (বইয়ের নাম হেডার/ফুটার) বাদ দাও —
 * ৬০%+ পৃষ্ঠায় একই লাইন থাকলে সেটা কনটেন্ট না, হেডার।
 */
function stripRepeatingLines(pages: string[][]): string[][] {
  const n = pages.length
  if (n < 4) return pages
  const seen = new Map<string, Set<number>>()
  pages.forEach((lines, pi) => {
    for (const l of lines) {
      const k = l.toLowerCase()
      if (!seen.has(k)) seen.set(k, new Set())
      seen.get(k)!.add(pi)
    }
  })
  const threshold = Math.max(4, Math.ceil(n * 0.6))
  const repeated = new Set(
    [...seen.entries()].filter(([, ps]) => ps.size >= threshold).map(([k]) => k)
  )
  if (!repeated.size) return pages
  return pages.map((lines) => lines.filter((l) => !repeated.has(l.toLowerCase())))
}

/** অধ্যায় শিরোনাম চেনার প্যাটার্ন */
const CHAPTER_RE =
  /^\s*(?:অধ্যায়|অনুচ্ছেদ|পাঠ|ইউনিট|chapter|CHAPTER|Chapter|unit|UNIT|Unit)\s*[-–—:.]?\s*([০-৯0-9]+)?\s*[-–—:.)]?\s*(.*)$/i

type Boundary = { pageIndex: number; lineIndex: number; number: number | null; title: string }

function detectBoundaries(pages: string[][]): Boundary[] {
  const found: Boundary[] = []
  pages.forEach((lines, pi) => {
    lines.forEach((line, li) => {
      if (line.length > 90) return
      const m = CHAPTER_RE.exec(line)
      if (!m) return
      const number = m[1] ? bnToNumber(m[1]) : NaN
      let title = (m[2] ?? '').replace(/[।.:\s]+$/, '').trim()
      // শিরোনামের শেষে পৃষ্ঠা-নম্বর থাকলে এটা সূচিপত্রের লাইন (TOC) — বাদ
      if (/[\s.·\-–—]*[০-৯0-9]{1,4}$/.test(title)) return
      // খুব লম্বা "শিরোনাম" আসলে সাধারণ বাক্য
      if (title.split(/\s+/).length > 12) return
      // পাতার শুরুর দিকে না হলে/লাইন ছোট না হলে আসল শিরোনাম না
      if (li > 6 && line.length > 70) return
      if (!Number.isFinite(number)) {
        return found.push({ pageIndex: pi, lineIndex: li, number: null, title })
      }
      if (found.length) {
        const prev = found[found.length - 1]
        // পরপর দুই লাইনে ভাঙা শিরোনাম — আগেরটার সাথে জুড়ে দাও
        if (prev.pageIndex === pi && li - prev.lineIndex <= 2 && prev.number === number) {
          if (title && !prev.title) prev.title = title
          return
        }
      }
      found.push({ pageIndex: pi, lineIndex: li, number, title })
    })
  })

  // একই নম্বরের বেশি বার (সূচিপত্র + আসল অধ্যায়) — শেষ occurrence রাখো
  const byNumber = new Map<number, Boundary>()
  const unnumbered: Boundary[] = []
  for (const b of found) {
    if (b.number === null) unnumbered.push(b)
    else byNumber.set(b.number, b)
  }
  const merged = [...byNumber.values(), ...unnumbered]
  merged.sort((a, b) => a.pageIndex - b.pageIndex || a.lineIndex - b.lineIndex)
  // খুব কাছাকাছি (একই পাতায় ৩ লাইনের মধ্যে) ডুপ্লিকেট বাদ
  return merged.filter((b, i) => {
    if (i === 0) return true
    const p = merged[i - 1]
    return !(b.pageIndex === p.pageIndex && b.lineIndex - p.lineIndex <= 3)
  })
}

function titleFallback(b: Boundary, idx: number): string {
  if (b.title) return b.title.slice(0, 80)
  return b.number !== null ? `অধ্যায় ${b.number}` : `অংশ ${idx + 1}`
}

/**
 * PDF বাইনারি → { পৃষ্ঠাগুলোর পরিষ্কার টেক্সট, অটো-শনাক্ত অধ্যায়সীমা }
 * এটাই "আপলোড করলাই হলো" ম্যাজিকের মূল ইঞ্জিন।
 */
export async function extractPdfPages(buf: Buffer): Promise<PdfExtractResult> {
  const pdf = await getDocumentProxy(new Uint8Array(buf))
  const { totalPages, text } = await extractText(pdf, { mergePages: false })
  const rawPages: string[] = Array.isArray(text) ? text : [String(text)]

  // পরিষ্কার করা লাইন (পৃষ্ঠা-নম্বর বাদ) → রিপিটিং হেডার/ফুটার বাদ
  const cleaned = stripRepeatingLines(rawPages.map((t) => cleanLines(t ?? '')))

  const pages = cleaned.map((lines, i) => ({
    page: i + 1,
    text: lines.join('\n'),
    lines,
  }))
  const totalChars = pages.reduce((a, p) => a + p.text.replace(/\s/g, '').length, 0)

  const boundaries = detectBoundaries(pages.map((p) => p.lines))
  const sections: PdfSection[] = []

  const pushSection = (title: string, number: number | null, start: number, end: number) => {
    if (end <= start) return
    sections.push({ title, number, startPage: start, endPage: end })
  }

  if (boundaries.length === 0) {
    // কোনো অধ্যায় চেনা যায়নি — পুরো PDF এক অধ্যায়
    if (totalChars > 0) pushSection('সম্পূর্ণ বই', null, 1, pages.length + 1)
  } else {
    // প্রথম অধ্যায়ের আগের অংশ (সূচিপত্র/ভূমিকা)
    const first = boundaries[0]
    if (first.pageIndex > 0) {
      const preChars = pages
        .slice(0, first.pageIndex)
        .reduce((a, p) => a + p.text.replace(/\s/g, '').length, 0)
      // বেশ বড় হলে আলাদা অংশ, ছোট হলে প্রথম অধ্যায়ের সাথে যোগ
      if (preChars > 400) pushSection('ভূমিকা ও সূচিপত্র', null, 1, first.pageIndex + 1)
    }
    boundaries.forEach((b, i) => {
      const end = i + 1 < boundaries.length ? boundaries[i + 1].pageIndex + 1 : pages.length + 1
      pushSection(titleFallback(b, i), b.number, b.pageIndex + 1, end)
    })
  }

  return {
    pageCount: Number(totalPages) || pages.length,
    pages: pages.map((p) => ({ page: p.page, text: p.text })),
    sections,
    totalChars,
  }
}
