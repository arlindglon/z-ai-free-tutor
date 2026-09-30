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

/** বাংলা নুক্তা-রূপভেদ নরমালাইজ (ড়/ঢ়/য় এক-কোডপয়েন্ট বনাম জোড়া-রূপ — দুই রূপকেই এক করে) */
function bnNfd(s: string): string {
  return s.replace(/[\u09DC\u09DD\u09DF]/g, (c) => NUFTA_MAP_BN[c])
}

/** ocr-book নিজের কপি — bn.ts আমদানি এড়াতে (ক্লায়েন্ট-বান্ডল হালকা রাখতে) */
const NUFTA_MAP_BN: Record<string, string> = {
  '\u09DC': '\u09A1\u09BC', // ড়
  '\u09DD': '\u09A2\u09BC', // ঢ়
  '\u09DF': '\u09AF\u09BC', // য়
}

/** বাংলা/ইংরেজি সংখ্যা-স্ট্রিং → সংখ্যা (যেমন "২৩" → 23) */
export function bnToNumber(s: string): number | null {
  const norm = s
    .trim()
    .replace(/\uFEFF/g, '')
    .replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)))
  if (!/^\d+$/.test(norm)) return null
  return parseInt(norm, 10)
}

/**
 * বাংলা ক্রমবাচক শব্দ → সংখ্যা ("প্রথম অধ্যায়..." জাতীয় শিরোনাম থেকে)
 */
const BN_ORDINALS: Record<string, number> = {
  'প্রথম': 1,
  'দ্বিতীয়': 2,
  'তৃতীয়': 3,
  'চতুর্থ': 4,
  'পঞ্চম': 5,
  'ষষ্ঠ': 6,
  'সপ্তম': 7,
  'অষ্টম': 8,
  'নবম': 9,
  'দশম': 10,
  'একাদশ': 11,
  'দ্বাদশ': 12,
  'ত্রয়োদশ': 13,
  'চতুর্দশ': 14,
  'পঞ্চদশ': 15,
  'ষোড়শ': 16,
  'সপ্তদশ': 17,
  'অষ্টাদশ': 18,
  'উনবিংশ': 19,
  'বিংশ': 20,
}

function ordinalToNumber(word: string): number | null {
  return BN_ORDINALS[word.trim()] ?? null
}

/**
 * PDF-থেকে-কপি / Google-Docs-এ পেস্ট করা লেখার আবর্জনা বাদ:
 *   • BOM (\uFEFF) — export ফাইলের শুরুতে লেগে আসে, নইলে প্রথম "পৃষ্ঠা ১" মার্কার ধরা পড়ে না
 *   • একান্ত "PDF" / "PDF+ 1" / "PDF+ 12" লাইন — Google Drive/Docs-এর PDF-প্রিভিউ থেকে
 *     কপি করলে ভাঙা-পৃষ্ঠা/ছবির জায়গায় এই মার্কারগুলোই চলে আসে (কোনো পাঠ্য নয়)
 *   • "ফর্মা-১, কৃষিশিক্ষা-৯ম-১০ম শ্রেণি" জাতীয় ছাপা-ফুটার
 * লাইনের ভেতরে জমানো "PDF+ 4" সাফ করা হয় না — শুধু আলাদা লাইনেরগুলো আবর্জনা বলে নিশ্চিত।
 */
const PDF_ARTIFACT_LINE_RE = /^[ \t]*pdf(?:[ \t]*\+[ \t]*[০-৯0-9]+)?[ \t]*$/i
const PRINT_FORM_FOOTER_RE = /^[ \t]*ফর্মা[ \t]*[-–—:]?[ \t]*[০-৯0-9]*[ \t]*[,،:][ \t]*.*শ্রেণি[ \t]*$/

export function stripCopyArtifacts(text: string): string {
  return text
    .replace(/\uFEFF/g, '')
    .split('\n')
    // লাইনের শেষে লেগে থাকা "PDF+ 4" জাতীয় মার্কারও সাফ — নিজে নতুন লাইন না নিলেও
    .map((ln) => ln.replace(/[ \t]*pdf[ \t]*\+[ \t]*[০-৯0-9]+[ \t]*$/i, '').trimEnd())
    .filter((ln) => !PDF_ARTIFACT_LINE_RE.test(ln) && !PRINT_FORM_FOOTER_RE.test(ln))
    .join('\n')
}

/** "### পৃষ্ঠা ১" / "পৃষ্ঠা ২" / "**পৃষ্ঠা ৩**" / "### পৃষ্ঠা: 4" — পুরো লাইন শুধু মার্কার হতে হবে */
const PAGE_RE =
  /^[ \t]*(?:#{1,6})?[ \t]*\*{0,2}[ \t]*(?:পৃষ্ঠা|পেজ|page)[ \t]*(?:#|:|：|-|–|—)?[ \t]*([০-৯0-9]+)[ \t]*\*{0,2}[ \t]*$/i

/**
 * লাইনের ভেতরে জড়িয়ে থাকা "পৃষ্ঠা N" মার্কার খুলে আলাদা লাইনে সাজানোর নিয়ম (PDF-কপি ফরম্যাট):
 *   "পৃষ্ঠা ১১কৃষি প্রযুক্তিজমি চাষের বিবেচ্য বিষয়" — মার্কারের সাথেই লেখা জমা
 *   "।   পৃষ্ঠা ১২   কৃষিশিক্ষা   তৃতীয় পরিচ্ছেদ..." — মাঝখানে মার্কার
 * মার্কার বলতে শর্ত — সংখ্যার পরে হয় জমাট বাংলা অক্ষর (স্পেস ছাড়া), নয় ২+ স্পেস।
 * ফলে ভাঙবে না: চলমান বাক্য ("পৃষ্ঠা ৫ দেখো", "পৃষ্ঠা ৭-এ ছবি", "পৃষ্ঠা ৫।"),
 * সূচিপত্রের লাইন-শেষ সংখ্যা ("... পৃষ্ঠা ১২")। লুকঅ্যাহেডে বাংলা সংখ্যা ০-৯ বাদ —
 * নইলে backtracking করে "পৃষ্ঠা ১২" ভেঙে "পৃষ্ঠা ১"+"২" বানিয়ে ফেলত।
 */
const INLINE_MARKER_RE =
  /(^|[\t ]|[।!?,;:()"'‘’“”\-–—])((?:পৃষ্ঠা|পেজ|page)[ \t]*(?:#|:|：)?[ \t]*[০-৯0-9]+)(?=[ \t]{2,}|[\u0980-\u09E5\u09F0-\u09FF])/g

/** PDF-কপি টেক্সটে লাইনের ভেতরে জমানো "পৃষ্ঠা N" মার্কার আলাদা লাইনে খুলে দাও */
function unwrapInlinePageMarkers(text: string): string {
  return text
    .split('\n')
    .map((ln) => {
      // আগে থেকেই স্ট্যান্ডঅ্যালোন মার্কার-লাইন ("### পৃষ্ঠা ১") হলে না ধরাই ভালো
      if (PAGE_RE.test(ln)) return ln
      return ln.replace(INLINE_MARKER_RE, (_m, pre: string, marker: string) => `${pre}\n${marker}\n`)
    })
    .join('\n')
}

/**
 * পেজ-শুরুর রানিং-হেডার (বইয়ের নাম/বিষয় — PDF-এর প্রতি পৃষ্ঠার মাথায় যেটা লেগে থাকে) বাদ।
 * শর্ট প্রার্থী (৬ অক্ষরের কম) জমাট লেখার সাথে মিললে বাদ দেওয়া হয় না —
 * নইলে "কৃষি" প্রার্থী "কৃষিশিক্ষাiv)" ভেঙে "শিক্ষাiv)" বানিয়ে ফেলত।
 */
function stripRunningHeaders(body: string, titleHint: string): string {
  const t = titleHint.trim()
  if (!t) return body
  const words = t.split(/[ \t]+/).filter(Boolean)
  const cands: { text: string; gluedOk: boolean }[] = []
  if (t.length >= 3) cands.push({ text: t, gluedOk: t.length >= 6 })
  const compact = t.replace(/[ \t]+/g, '')
  if (compact !== t && compact.length >= 6) cands.push({ text: compact, gluedOk: true })
  if (words.length >= 2) {
    const two = words.slice(0, 2).join(' ')
    if (two !== t && two.length >= 6) cands.push({ text: two, gluedOk: true })
  }
  if (words[0] && words[0].length >= 3 && words[0] !== t) {
    cands.push({ text: words[0], gluedOk: words[0].length >= 6 })
  }
  // লম্বা প্রার্থী আগে — ছোটটা ভুলভাবে অর্ধেক শব্দ কেটে ফেলা এড়াতে
  cands.sort((a, b) => b.text.length - a.text.length)

  let out = body
  // পেজ-হেডার + অধ্যায়-হেডার — সর্বোচ্চ ২ স্তর লাগতে পারে
  for (let round = 0; round < 2; round++) {
    let changed = false
    for (const c of cands) {
      if (!out.startsWith(c.text)) continue
      const rest = out.slice(c.text.length)
      if (!c.gluedOk && rest && !/^[\s।!?,;:()"'\-–—]/.test(rest)) continue
      out = rest.replace(/^[ \t।]+/, '')
      changed = true
    }
    if (!changed) break
  }
  return out
}

/** অধ্যায়-কীওয়ার্ড দিয়ে শুরু হওয়া লাইন (শিরোনাম প্রার্থী)
 *  দুই রূপ ধরে: "অধ্যায় ৩ ..." ও "প্রথম অধ্যায় কৃষি প্রযুক্তি" (ক্রমবাচক-আগে-কীওয়ার্ড, NCTB বইয়ের মতো)
 *  পরিচ্ছেদও অধ্যায়-স্তরেই যায় — আরও সূক্ষ্ম রেফারেন্স পাওয়া যায় */
const ORDINAL_ALT = `(?:${Object.keys(BN_ORDINALS).join('|')})[ \\t]+`
const CHAPTER_KEYWORD_RE = new RegExp(
  `^(?:#{1,6}[ \\t]*)?\\*{0,2}[ \\t]*(${ORDINAL_ALT}?)?(অধ্যায়|অধায়|অধযায়|পরিচ্ছেদ|অনুচ্ছেদ|পাঠ|ইউনিট|chapter|unit|lesson)`,
  'i'
)

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

  // PDF-কপি আবর্জনা ("PDF+ 4", ফর্মা-ফুটার, BOM) — মার্কার-আগেই যায়, এখানে না-থাকলেও নিরাপদ
  t = stripCopyArtifacts(t)

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

    // কীওয়ার্ডের পরের অংশ থেকে নম্বর + শিরোনাম; সংখ্যা না থাকলে ক্রমবাচক শব্দ ("প্রথম অধ্যায়...")
    const mm = after.match(/^[ \t]*[:：\-–—]?[ \t]*([০-৯0-9]+)?[ \t]*[:：\-–—.]?[ \t]*(.*)$/)
    const number = mm?.[1]
      ? bnToNumber(mm[1])
      : km[1]
        ? ordinalToNumber(km[1])
        : null
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

/** "[চিত্র: ...]" জাতীয় ছবি-প্লেসহোল্ডার লাইন — হেডার নয়, বইয়ের অংশ হিসেবে থাকে */
const CHITR_RE = /^[ \t]*\[চিত্র[:：]/

/**
 * প্রতি পৃষ্ঠার মাথায় বারবার ফেরত আসা রানিং-হেডার অটো শনাক্ত করে বাদ।
 * titleHint-ভিত্তিক stripRunningHeaders শুধু বইয়ের নাম-মিল হেডার ধরে — কিন্তু NCTB বইয়ে
 * দুই প্রকার হেডার থাকে (বইয়ের নাম + বিষয়ের নাম, যেমন "কৃষিশিক্ষা" ও "কৃষি প্রযুক্তি")।
 * নিয়ম: কমপক্ষে ৩টি পৃষ্ঠার একেবারে প্রথম লাইনে হুবহু একই ছোট (≤৪০ অক্ষর),
 * বাক্য-চিহ্ন ছাড়া লেখা ফিরে এলে সেটা হেডার — সব পৃষ্ঠার মাথা থেকে বাদ।
 */
function autoStripRepeatedPageHeads(pages: OcrPage[]): OcrPage[] {
  const headOf = (p: OcrPage): string | null => {
    for (const raw of p.text.split('\n')) {
      const t = raw.trim()
      if (!t) continue
      return t
    }
    return null
  }
  const isHeaderish = (h: string): boolean =>
    h.length <= 40 &&
    !/[।!?]$/.test(h) &&
    !PAGE_RE.test(h) &&
    !SEPARATOR_RE.test(h) &&
    !CHITR_RE.test(h)

  const counts = new Map<string, number>()
  for (const p of pages) {
    const h = headOf(p)
    if (!h || !isHeaderish(h)) continue
    counts.set(h, (counts.get(h) ?? 0) + 1)
  }
  const heads = new Set([...counts.entries()].filter(([, n]) => n >= 3).map(([h]) => h))
  if (heads.size === 0) return pages

  return pages.map((p) => {
    const h = headOf(p)
    if (!h || !heads.has(h)) return p
    const lines = p.text.split('\n')
    const firstIdx = lines.findIndex((ln) => ln.trim() !== '')
    lines.splice(firstIdx, 1)
    return { ...p, text: lines.join('\n').trim() }
  })
}

/**
 * OCR টেক্সট → পৃষ্ঠার তালিকা + অধ্যায়ের গ্রুপ।
 * মার্কার না থাকলে: একটাই অধ্যায় "সম্পূর্ণ বই" (pages খালি — সার্ভারে পুরো লেখা chunkContent হবে)।
 * opts.titleHint = বইয়ের নাম — PDF-কপিতে পেজ-মাথার রানিং-হেডার ("কৃষি প্রযুক্তিজমি চাষের...")
 * বইয়ের নাম মিললে বাদ দেওয়া হয়, আর লাইনের ভেতরে জমানো "পৃষ্ঠা N" মার্কারও খুলে পৃষ্ঠা-ভাগ হয়।
 */
export function parseOcrBook(raw: string, opts?: { titleHint?: string | null }): OcrParseResult {
  const titleHint = bnNfd((opts?.titleHint ?? '').trim())
  const text = unwrapInlinePageMarkers(
    stripCopyArtifacts(bnNfd(raw).replace(/\r\n?/g, '\n')).trim()
  )
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
  //    প্রতিটি পৃষ্ঠার টেক্সট সাথে সাথেই পরিষ্কার — টেবিল/<br>/ল্যাটেক্স নরমালাইজ হয়ে যায়;
  //    শুরুর রানিং-হেডার (বইয়ের নাম) থাকলে সেটাও বাদ — হেডার-শুধু পৃষ্ঠা হলে বাদই যায়
  const pages: OcrPage[] = []
  for (let k = 0; k < markers.length; k++) {
    const from = markers[k].line + 1
    const to = k + 1 < markers.length ? markers[k + 1].line : lines.length
    const body = lines
      .slice(from, to)
      .filter((ln) => !SEPARATOR_RE.test(ln))
      .join('\n')
      .trim()
    if (!body) continue
    const cleaned = cleanOcrText(body)
    const stripped = titleHint ? stripRunningHeaders(cleaned, titleHint).trim() : cleaned
    if (stripped) pages.push({ page: markers[k].page, text: stripped })
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

  // ২.৫) রিপিট-হেডার ("কৃষি প্রযুক্তি"/"কৃষিশিক্ষা" জাতীয়) অটো-বাদ — অধ্যায়-শনাক্তের আগেই
  const cleanPages = autoStripRepeatedPageHeads(pages)

  // ৩) অধ্যায় শনাক্ত করে পৃষ্ঠা গ্রুপ করা
  const chapters: OcrChapter[] = []
  const preface: OcrPage[] = []
  let cur: OcrChapter | null = null

  const pushCur = () => {
    if (cur && cur.pages.length) chapters.push(cur)
    cur = null
  }

  for (const p of cleanPages) {
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
