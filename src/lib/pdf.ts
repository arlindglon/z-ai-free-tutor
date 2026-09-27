/**
 * PDF → টেক্সট পাইপলাইন (সম্পূর্ণ অটোমেটিক)
 * অ্যাডমিন শুধু PDF আপলোড করবে — এখানে স্বয়ংক্রিয়ভাবে:
 *  ১) পৃষ্ঠা-ভিত্তিক টেক্সট বের করা (unpdf / pdf.js)
 *  ২) বাংলা ভিজুয়াল-অর্ডার সংশোধন (গিত → গতি)
 *  ৩) হেডার-ফুটার ও পৃষ্ঠা-নম্বরের লাইন পরিষ্কার করা
 *  ৪) "অধ্যায় / পাঠ / Chapter" শিরোনাম চিনে অধ্যায়ে ভাগ করা
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

/**
 * বাংলা প্রি-বেস স্বরচিহ্ন (ি ে ৈ) ভিজুয়াল-অর্ডার সংশোধন:
 * "গিত" → "গতি", "েদখা" → "দেখা"
 * শুধুমাত্র ভিজুয়াল-অর্ডার PDF-তে প্রয়োগ হয় (নিচের ডিটেক্টর দেখো)
 */
const PRE_BASE_RE =
  /([\u09BF\u09C7\u09C8])([\u0995-\u09B9\u09CE](?:\u09CD[\u0995-\u09B9\u09CE])*)/g

/** হসন্তের পরে ঢুকে যাওয়া ফাঁক মুছে ফেলা (যুক্তবর্ণ ভাঙার আর্টিফ্যাক্ট) — নিউলাইন নয়! */
const HALANT_GAP_RE = /\u09CD[ \t\u00A0]+(?=[\u0995-\u09B9\u09CE])/g

/**
 * ভিজুয়াল-অর্ডার ম্যাংলিং শনাক্তকারী:
 * সঠিক (লজিক্যাল) বাংলায় ি/ে/ৈ কখনো শব্দের শুরুতে আসতে পারে না।
 * টোকেন-শুরুতে এই চিহ্ন দেখা গেলেই বোঝা যায় টেক্সট ভিজুয়াল-অর্ডারে উল্টো।
 */
function isVisualOrderBengali(text: string): boolean {
  const hits = text.match(/(^|[\s\u00A0।,!?;:"'(\-–—])[িেৈ]/gm)
  return (hits?.length ?? 0) >= 2
}

function fixBengaliExtraction(text: string, visualOrder: boolean): string {
  let t = text.replace(/[\u0000-\u0008\u200B-\u200D\uFEFF]/g, '')
  if (visualOrder) {
    t = t.replace(PRE_BASE_RE, '$2$1')
    // ো/ৌ ভাঙা অংশ (ে+া / ে+ূ) আবার জোড়া দাও
    t = t.replace(/\u09C7\u09BE/g, '\u09CB').replace(/\u09C7\u09C2/g, '\u09CC')
  }
  t = t.replace(HALANT_GAP_RE, '\u09CD')
  return t
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

/**
 * অধ্যায় শিরোনাম চেনা — ম্যাংগল-প্রুফ:
 * শব্দের ভিতরের ফাঁক স্কোয়াশ করে ম্যাচ করাই, তাই "অধ ায় ১"-জাতীয়
 * ভাঙা এক্সট্র্যাকশনেও ধরা পড়ে।
 */
const CHAPTER_KEYWORDS = [
  'অধ্যায়',
  'অধায়', // ্য হারিয়ে গেলে
  'অধযায়', // ্ হারিয়ে গেলে
  'অনুচ্ছেদ',
  'অনচ্ছেদ',
  'পাঠ',
  'ইউনিট',
  'chapter',
  'unit',
] as const

function matchChapterLine(line: string): { number: number | null; title: string } | null {
  const trimmed = line.trim()
  if (trimmed.length > 90) return null
  const squashed = trimmed.replace(/[\s\u0000-\u001F]+/g, '')
  if (!squashed) return null
  const lower = squashed.toLowerCase()
  const hit = CHAPTER_KEYWORDS.find((kw) => lower.startsWith(kw))
  if (!hit) return null

  // নম্বর ও শিরোনাম মূল (স্কোয়াশ না-করা) লাইন থেকে নেই — স্পেস টিকে থাকে
  const digitRun = /[০-৯0-9]+/.exec(trimmed)
  if (digitRun) {
    const number = bnToNumber(digitRun[0])
    let title = trimmed
      .slice(digitRun.index + digitRun[0].length)
      .replace(/^[\s]*[-–—:.)][\s]*/, '')
      .replace(/[-–—:.।\u09CD\s]+$/g, '')
      .trim()
    if (/[.·\-–—]*[০-৯0-9]{1,4}$/.test(title)) return null // TOC লাইন
    if (!title) title = `অধ্যায় ${number}`
    return { number, title: title.slice(0, 80) }
  }

  // নম্বরহীন হেডিং — প্রথম শব্দ (কীওয়ার্ড) বাদে বাকিটা শিরোনাম
  let title = trimmed.replace(/^\S+/, '').replace(/^[-–—:.)\s]+/, '').replace(/[-–—:.।\u09CD\s]+$/g, '').trim()
  if (/[.·\-–—]*[০-৯0-9]{1,4}$/.test(title)) return null
  if (!title) return null
  return { number: null, title: title.slice(0, 80) }
}

type Boundary = { pageIndex: number; lineIndex: number; number: number | null; title: string }

function detectBoundaries(pages: string[][]): Boundary[] {
  const found: Boundary[] = []
  pages.forEach((lines, pi) => {
    lines.forEach((line, li) => {
      const hit = matchChapterLine(line)
      if (!hit) return
      if (li > 6 && line.length > 70) return // পাতার একেবারে মাঝের সাধারণ বাক্য নয়
      if (found.length) {
        const prev = found[found.length - 1]
        // পরপর দুই লাইনে ভাঙা শিরোনাম — আগেরটার সাথে জুড়ে দাও
        if (prev.pageIndex === pi && li - prev.lineIndex <= 2 && prev.number === hit.number) {
          if (hit.title && !prev.title) prev.title = hit.title
          return
        }
      }
      found.push({ pageIndex: pi, lineIndex: li, number: hit.number, title: hit.title })
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

  // পুরো ডকুমেন্টে একবার: ভিজুয়াল-অর্ডার বাংলা কি না
  const visualOrder = isVisualOrderBengali(rawPages.join('\n'))

  // সংশোধন → লাইন পরিষ্কার (পৃষ্ঠা-নম্বর বাদ) → রিপিটিং হেডার/ফুটার বাদ
  const cleaned = stripRepeatingLines(
    rawPages.map((t) => cleanLines(fixBengaliExtraction(t ?? '', visualOrder)))
  )

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
