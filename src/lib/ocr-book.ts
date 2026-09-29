/**
 * Gemini OCR টেক্সট → পৃষ্ঠা + অধ্যায়ে ভাঙার পার্সার।
 * Pure TypeScript — ক্লায়েন্ট (লাইভ প্রিভিউ) ও সার্ভার (আসল সেভ) দুই জায়গায়ই চলে।
 *
 * প্রত্যাশিত ফরম্যাট (নিচের OCR_PROMPT দেখো):
 *   ### পৃষ্ঠা ১
 *   লেখা...
 *   ---
 *   ### পৃষ্ঠা ২
 *   লেখা...
 *   ---
 */

const BN_DIGITS = '০১২৩৪৫৬৭৮৯'

/** বাংলা/ইংরেজি সংখ্যা-স্ট্রিং → সংখ্যা (যেমন "২৩" → 23) */
export function bnToNumber(s: string): number | null {
  const norm = s.trim().replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)))
  if (!/^\d+$/.test(norm)) return null
  return parseInt(norm, 10)
}

/** "### পৃষ্ঠা ১" / "পৃষ্ঠা ২" / "**পৃষ্ঠা ৩**" / "### পৃষ্ঠা: 4" — পুরো লাইন শুধু মার্কার হতে হবে */
const PAGE_RE =
  /^[ \t]*(?:#{1,6})?[ \t]*\*{0,2}[ \t]*(?:পৃষ্ঠা|পেজ|page)[ \t]*(?:#|:|：|-|–|—)?[ \t]*([০-৯0-9]+)[ \t]*\*{0,2}[ \t]*$/i

/** অধ্যায়-কীওয়ার্ড দিয়ে শুরু হওয়া লাইন (শিরোনাম প্রার্থী) */
const CHAPTER_KEYWORD_RE =
  /^(?:#{1,6}[ \t]*)?\*{0,2}[ \t]*(অধ্যায়|অধায়|অধযায়|অনুচ্ছেদ|পাঠ|ইউনিট|chapter|unit|lesson)/i

/** "---" জাতীয় বিভাজক লাইন */
const SEPARATOR_RE = /^[ \t]*(?:[-*_=]{3,}|═+|—{2,}|─{2,})[ \t]*$/

/* ------------------------------------------------------------------ */
/* মার্কডাউন/HTML/LaTeX আবর্জনা নরমালাইজার                              */
/* Gemini-র OCR আউটপুটে টেবিল (| |), <br>, **, ###, $P^{H}$ ইত্যাদি     */
/* মিশে থাকে — সব থাকলেই পেস্ট করা যাবে; এখানে পরিষ্কার হয়ে যায়:        */
/*   • ভাঙা টেবিল-রো জোড়া লাগানো + অ্যালাইনমেন্ট রো নরমালাইজ            */
/*   • <br> ও HTML এন্টিটি → পরিষ্কার লাইন                              */
/*   • LaTeX \(x\) / \[x\] → $x$ / $$x$$ (KaTeX রেন্ডার করবে)           */
/*   • **বোল্ড** ও ### শিরোনাম থাকে — মার্কডাউন হিসেবেই সুন্দর দেখায়     */
/* ------------------------------------------------------------------ */

const IS_TABLE_ROW_RE = /^\s*\|/
const ALIGN_ROW_RE = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/

/** টেবিলের প্রথম রো থেকে কলাম-সংখ্যা ধরে অ্যালাইনমেন্ট রো বানাও */
function makeAlignRow(headerRow: string): string {
  const cells = headerRow.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').length
  const n = Math.max(1, cells)
  return `| ${Array(n).fill('---').join(' | ')} |`
}

/** ভাঙা টেবিল-রো জোড়া দাও: "|" দিয়ে শুরু হয়ে "|" দিয়ে শেষ না হওয়া পর্যন্ত লাইন জোড়া */
function mergeBrokenRows(lines: string[]): string[] {
  const out: string[] = []
  let row: string | null = null
  for (const ln of lines) {
    const t = ln.trim()
    if (row === null) {
      if (IS_TABLE_ROW_RE.test(t)) {
        row = t
        // সম্পূর্ণ রো (শেষে "|" আছে) হলে সাথে সাথেই শেষ — নইলে পরের রো-ও জোড়া লেগে যাবে
        if (t.endsWith('|')) {
          out.push(row)
          row = null
        }
      } else {
        out.push(ln)
      }
      continue
    }
    // ভাঙা রো চলছে — ফাঁকা লাইন স্কিপ, বাকিটা জোড়া
    if (t) row += ' ' + t
    if (t.endsWith('|')) {
      out.push(row)
      row = null
    }
  }
  if (row !== null) out.push(row)
  return out
}

/**
 * টেবিল-ব্লক নরমালাইজ: রো জোড়া + অ্যালাইনমেন্ট রো নিশ্চিত + টেবিলের ভেতরের
 * ফাঁকা লাইন বাদ (নইলে markdown টেবিল ভেঙে যায়)
 */
function normalizeTables(lines: string[]): string[] {
  const merged = mergeBrokenRows(lines)
  const out: string[] = []
  for (let i = 0; i < merged.length; i++) {
    const t = merged[i].trim()
    if (IS_TABLE_ROW_RE.test(t)) {
      if (ALIGN_ROW_RE.test(t)) continue // পুরনো অ্যালাইনমেন্ট রো বাদ — নিচে ক্যানোনিকাল বসবে
      const prev = out.length ? out[out.length - 1].trim() : ''
      const prevIsRow = IS_TABLE_ROW_RE.test(prev)
      if (!prevIsRow) {
        // নতুন টেবিলের হেডার — পরের লাইন অ্যালাইনমেন্ট না হলে একটা বসাও
        const next = merged[i + 1]?.trim() ?? ''
        out.push(t)
        if (!IS_TABLE_ROW_RE.test(next) || ALIGN_ROW_RE.test(next) === false) {
          out.push(makeAlignRow(t))
        } else if (ALIGN_ROW_RE.test(next)) {
          // পরের লাইনই অ্যালাইনমেন্ট — ক্যানোনিকাল করে নাও
          out.push(makeAlignRow(t))
          i++ // পুরনো অ্যালাইনমেন্ট রো স্কিপ
        }
        continue
      }
      out.push(t)
      continue
    }
    // টেবিলের রো-র মাঝের ফাঁকা লাইন বাদ — আগের ও পরের দুটোই রো হলে স্কিপ
    if (!t) {
      const before = out.length ? out[out.length - 1].trim() : ''
      const after = merged[i + 1]?.trim() ?? ''
      if (IS_TABLE_ROW_RE.test(before) && IS_TABLE_ROW_RE.test(after)) continue
    }
    out.push(merged[i])
  }
  return out
}

/**
 * Gemini OCR টেক্সট পরিষ্কার — টেবিল/<br>/এন্টিটি/ল্যাটেক্স নরমালাইজ।
 * আউটপুট পরিষ্কার মার্কডাউন: react-markdown + remark-gfm + KaTeX দিয়ে সুন্দর রেন্ডার হয়।
 */
export function cleanOcrText(raw: string): string {
  let t = raw.replace(/\r\n?/g, '\n')

  // HTML: <br> → নিউলাইন (রো-জোড়ার পরে টেবিলের বাইরে ফাঁকা লাইন হয়ে যায়), এন্টিটি → অক্ষর
  t = t
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")

  // LaTeX ডিলিমিটার নরমালাইজ — $...$ যেমন আছে তেমনই থাকে (KaTeX পারে)
  t = t
    .replace(/\\\((.+?)\\\)/g, '$$$1$$')
    .replace(/\\\[([\s\S]+?)\\\]/g, '$$$$1$$')

  // লাইন-ভিত্তিক পরিষ্কার: টেবিল নরমালাইজ, প্রান্তের ফাঁকা কমানো, অবশিষ্ট বিভাজক বাদ
  t = normalizeTables(t.split('\n'))
    .map((ln) => ln.replace(/[ \t]+$/g, ''))
    .filter((ln, i, arr) => !(ln.trim() === '' && (i === 0 || i === arr.length - 1)))
    .filter((ln) => !SEPARATOR_RE.test(ln) && !/^[ \t]*--{1,2}[ \t]*$/.test(ln))
    .join('\n')

  // ৩+ নিউলাইন → ২ (প্যারা কাঠামো থাকবে)
  t = t.replace(/\n{3,}/g, '\n\n')

  return t.trim()
}

export type OcrPage = { page: number; text: string }

export type OcrChapter = {
  title: string
  number: number | null
  pageStart: number | null
  pages: OcrPage[]
}

export type OcrParseResult = {
  /** "পৃষ্ঠা N" মার্কার পাওয়া গেছে কি না — false হলে পুরো লেখা এক অধ্যায় হিসেবে যাবে */
  usedMarkers: boolean
  pageCount: number
  chapterCount: number
  chapters: OcrChapter[]
  totalChars: number
}

/**
 * অধ্যায়-শিরোনাম শনাক্ত — প্রতি পৃষ্ঠার শুরুর ৩টি অ-ফাঁকা লাইনের মধ্যে খোঁজা হয়
 * (বইয়ে অধ্যায় পৃষ্ঠার গায়ে শুরু হয়; পাতার মাঝে "অধ্যায় ১ এ আমরা শিখেছি" জাতীয়
 * বাক্য ভুল করে ধরা এড়াতেও এটা দরকার)
 */
function findChapterHeading(pageText: string): { title: string; number: number | null } | null {
  let checked = 0
  for (const raw of pageText.split('\n')) {
    const t = raw.trim()
    if (!t) continue
    checked += 1
    if (checked > 3) break
    if (t.length > 120) continue
    if (SEPARATOR_RE.test(t)) continue

    const km = t.match(CHAPTER_KEYWORD_RE)
    if (!km) continue

    // কীওয়ার্ডের পরে সরাসরি বাংলা অক্ষর/যুক্তচিহ্ন জোড়া থাকলে এটা আলাদা শব্দ (পাঠ্য, পাঠক) — বাদ
    const after = t.slice(km[0].length)
    if (/^[\u0980-\u09FF]/.test(after) && !/[ \t]/.test(after.charAt(0))) continue
    if (/^[\u09BE-\u09CC\u09CD\u09D7]/.test(after)) continue

    // সূচিপত্রের সারি বাদ: ডট-লিডার বা শেষে আলাদা পৃষ্ঠা-সংখ্যা
    if (/\.{2,}|…/.test(t)) continue
    const digitGroups = t.match(/[০-৯0-9]+/g) ?? []
    if (/[০-৯0-9]$/.test(t) && digitGroups.length >= 2) continue

    // কীওয়ার্ডের পরের অংশ থেকে নম্বর + শিরোনাম
    const mm = after.match(/^[ \t]*[:：\-–—]?[ \t]*([০-৯0-9]+)?[ \t]*[:：\-–—.]?[ \t]*(.*)$/)
    const number = mm?.[1] ? bnToNumber(mm[1]) : null
    const rest = (mm?.[2] ?? '').trim().replace(/\*+/g, '').trim()
    // বাক্যের মতো শেষ হলে বাদ ("অধ্যায় ১ এ আমরা শিখেছি।")
    if (rest && /[।!?]$/.test(rest)) continue
    // শিরোনাম খুব লম্বা হলে বাক্য হতে পারে
    if (rest.split(/\s+/).length > 10) continue

    const title = t.replace(/^[#\s*]+/, '').replace(/[ \t*]+$/, '').trim()
    return { title: title || 'অধ্যায়', number }
  }
  return null
}

/**
 * OCR টেক্সট → পৃষ্ঠার তালিকা + অধ্যায়ের গ্রুপ।
 * মার্কার না থাকলে: একটাই অধ্যায় "সম্পূর্ণ বই" (pages খালি — সার্ভারে পুরো লেখা chunkContent হবে)।
 */
export function parseOcrBook(raw: string): OcrParseResult {
  const text = raw.replace(/\r\n?/g, '\n').trim()
  const lines = text.split('\n')

  // ১) পৃষ্ঠা-মার্কার লাইন খোঁজো
  const markers: { line: number; page: number }[] = []
  lines.forEach((ln, i) => {
    const m = ln.match(PAGE_RE)
    if (!m) return
    const n = bnToNumber(m[1])
    if (n !== null && n > 0) markers.push({ line: i, page: n })
  })

  if (markers.length === 0) {
    return {
      usedMarkers: false,
      pageCount: 0,
      chapterCount: 1,
      chapters: [{ title: 'সম্পূর্ণ বই', number: null, pageStart: null, pages: [] }],
      totalChars: text.length,
    }
  }

  // ২) পৃষ্ঠা ভাগ — দুই মার্কারের মাঝের লেখা এক পৃষ্ঠা ("---" বিভাজক বাদ)
  //    প্রতিটি পৃষ্ঠার টেক্সট সাথে সাথেই পরিষ্কার — টেবিল/<br>/ল্যাটেক্স নরমালাইজ হয়ে যায়
  const pages: OcrPage[] = []
  for (let k = 0; k < markers.length; k++) {
    const from = markers[k].line + 1
    const to = k + 1 < markers.length ? markers[k + 1].line : lines.length
    const body = lines
      .slice(from, to)
      .filter((ln) => !SEPARATOR_RE.test(ln))
      .join('\n')
      .trim()
    if (body) pages.push({ page: markers[k].page, text: cleanOcrText(body) })
  }
  if (pages.length === 0) {
    return {
      usedMarkers: true,
      pageCount: 0,
      chapterCount: 1,
      chapters: [{ title: 'সম্পূর্ণ বই', number: null, pageStart: null, pages: [] }],
      totalChars: text.length,
    }
  }

  // ৩) অধ্যায় শনাক্ত করে পৃষ্ঠা গ্রুপ করা
  const chapters: OcrChapter[] = []
  const preface: OcrPage[] = []
  let cur: OcrChapter | null = null

  const pushCur = () => {
    if (cur && cur.pages.length) chapters.push(cur)
    cur = null
  }

  for (const p of pages) {
    const head = findChapterHeading(p.text)
    if (head) {
      pushCur()
      cur = { title: head.title, number: head.number, pageStart: p.page, pages: [p] }
    } else if (cur) {
      cur.pages.push(p)
    } else {
      preface.push(p)
    }
  }
  pushCur()

  // ৪) প্রথম অধ্যায়ের আগের অংশ — সূচিপত্র/ভূমিকা
  if (preface.length) {
    if (chapters.length === 0) {
      chapters.push({
        title: 'সম্পূর্ণ বই',
        number: null,
        pageStart: preface[0].page,
        pages: preface,
      })
    } else {
      const chars = preface.reduce((a, p) => a + p.text.length, 0)
      if (chars > 400) {
        chapters.unshift({
          title: 'ভূমিকা ও সূচিপত্র',
          number: null,
          pageStart: preface[0].page,
          pages: preface,
        })
      } else {
        chapters[0].pages.unshift(...preface)
        chapters[0].pageStart = chapters[0].pages[0].page
      }
    }
  }

  return {
    usedMarkers: true,
    pageCount: pages.length,
    chapterCount: chapters.length,
    chapters,
    totalChars: text.length,
  }
}

/**
 * অ্যাডমিন প্যানেলে দেখানো হবে এই প্রম্পট — কপি করে Gemini AI-তে স্ক্যান করা PDF-এর সাথে দিলে
 * ঠিক আমাদের পার্সারের বোঝা ফরম্যাটে টেক্সট ফেরত আসে।
 */
export const OCR_PROMPT = `তুমি একজন দক্ষ বাংলা OCR এবং টেক্সট এক্সট্রাক্টর হিসেবে কাজ করবে। আমি একটি স্ক্যান করা বাংলা বইয়ের PDF যুক্ত করেছি।

তোমার কাজ হলো এই PDF থেকে পৃষ্ঠা অনুযায়ী সম্পূর্ণ লেখা হুবহু ডিজিটাল টেক্সটে রূপান্তর করা। টেক্সট দেওয়ার সময় নিচের নিয়মগুলো কঠোরভাবে মেনে চলবে:

১. পৃষ্ঠা মার্কিং: প্রতিটি পৃষ্ঠার শুরুতে ঠিক এই ফরম্যাটে লিখবে — "### পৃষ্ঠা [নম্বর]" (যেমন: ### পৃষ্ঠা ১)। প্রতি পৃষ্ঠা শেষ হলে একটি লাইনে শুধু --- লিখবে।
২. নির্ভুলতা: কোনো শব্দ, লাইন, বাক্য বা প্যারা বাদ দেবে না। বানান ও যুক্তবর্ণ স্ক্যান কপির মতো হুবহু সঠিক রাখবে।
৩. ফরম্যাটিং: অধ্যায়ের শিরোনাম (যেমন: অধ্যায় ১ — ...) হুবহু একটি আলাদা লাইনে রাখবে। সাব-হেডিং, বুলেট পয়েন্ট বা টেবিল হুবহু সংরক্ষণ করবে। ছবির ক্ষেত্রে কেবল "[চিত্র: ক্যাপশন]" লিখবে।
৪. কোনো অতিরিক্ত কথা নয়: উত্তরের শুরুতে বা শেষে কোনো শুভেচ্ছা, সারসংক্ষেপ বা অতিরিক্ত কথা বলবে না; সরাসরি টেক্সট দেওয়া শুরু করবে।

এখন পৃষ্ঠা ১ থেকে ৫ পর্যন্ত সম্পূর্ণ টেক্সট দাও। (পরের ধাপে আমি "এবার পৃষ্ঠা ৬ থেকে ১০ দাও" বললে হুবহু একই নিয়মে পরের পৃষ্ঠাগুলো দেবে।)`
