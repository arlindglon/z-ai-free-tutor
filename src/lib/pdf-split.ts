/**
 * ব্রাউজারে PDF অটো-স্প্লিটার (pdf-lib দিয়ে, সার্ভারে কোনো কাজ নেই):
 *
 * সমস্যা: Vercel serverless-এ এক রিকোয়েস্টে সর্বোচ্চ ~৪.৫MB বডি যায় —
 * কিন্তু NCTB বইগুলো ৫–১০০MB। তাই বড় PDF ব্রাউজারেই পাতা-ধরে ছোট অংশে
 * ভেঙে (প্রতি অংশ ≤ ৩MB) পরপর আপলোড হয়; সার্ভার সব অংশ একই বইয়ে জোড়া
 * লাগায় (pageOffset দিয়ে পৃষ্ঠা নম্বর সঠিক রাখে)। এতে ১৫০MB পর্যন্ত
 * যেকোনো বই Vercel-এও আপলোড হয় — অ্যাডমিন কিছুই করতে হয় না।
 */
import { PDFDocument } from 'pdf-lib'

/** Vercel 4.5MB লিমিটের নিচে থাকতে টার্গেট (multipart overhead সহ নিরাপদ মার্জিন) */
const TARGET_PART_BYTES = 3 * 1024 * 1024

export type PdfPart = {
  blob: Blob
  name: string
  /** এই অংশের প্রথম পাতা মূল বইয়ের কত নম্বর পাতা (0-based offset) */
  pageOffset: number
  pageCount: number
}

export type SplitResult = {
  parts: PdfPart[]
  pageCount: number
}

function partName(originalName: string, index: number): string {
  const base = originalName.replace(/\.pdf$/i, '') || 'boi'
  return `${base}__part${index}.pdf`
}

/**
 * ফাইল → আপলোড-উপযোগী অংশগুলো।
 * ছোট ফাইল (≤ ৩MB) একটাই অংশ — pdf-lib ছাড়াই ফাস্ট পাথ।
 * pdf-lib কোনো কারণে ব্যর্থ হলে পুরো ফাইল এক অংশ হিসেবে ফেরত দেয় —
 * সার্ভার তখন নিজেই নির্ভুল এরর (PDF_BROKEN / NEEDS_OCR / 413) দেবে।
 */
export async function splitPdfForUpload(file: File): Promise<SplitResult> {
  const bytes = new Uint8Array(await file.arrayBuffer())

  // ফাস্ট পাথ — ছোট ফাইল, ভাঙার দরকার নেই
  if (bytes.length <= TARGET_PART_BYTES) {
    return {
      parts: [{ blob: new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' }), name: file.name, pageOffset: 0, pageCount: 0 }],
      pageCount: 0,
    }
  }

  try {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
    const pageCount = src.getPageCount()
    if (pageCount < 1) throw new Error('EMPTY_PDF')

    // গড় পাতা-সাইজ দিয়ে প্রাথমিক অনুমান, পরে প্রতিটি অংশের আসল সাইজ দেখে সংশোধন
    const avg = bytes.length / pageCount
    let perPart = Math.max(2, Math.floor(TARGET_PART_BYTES / avg))

    const parts: PdfPart[] = []
    let cursor = 0

    while (cursor < pageCount) {
      let n = Math.min(perPart, pageCount - cursor)
      let blob: Blob

      // অংশটা আসলেই ≤ টার্গেট কি না যাচাই — না হলে পাতা কমিয়ে আবার বানাও
      for (;;) {
        const out = await PDFDocument.create()
        const indices = Array.from({ length: n }, (_, k) => cursor + k)
        const copied = await out.copyPages(src, indices)
        copied.forEach((p) => out.addPage(p))
        const saved = await out.save({ useObjectStreams: true })

        if (saved.length <= TARGET_PART_BYTES || n <= 1) {
          blob = new Blob([saved.slice().buffer as ArrayBuffer], { type: 'application/pdf' })
          break
        }
        // বড় হয়ে গেল — অনুপাত ধরে পাতা সংখ্যা কমাও
        n = Math.max(1, Math.floor((n * TARGET_PART_BYTES) / saved.length))
      }

      parts.push({ blob, name: partName(file.name, parts.length + 1), pageOffset: cursor, pageCount: n })
      cursor += n
    }

    return { parts, pageCount }
  } catch (e) {
    console.warn('[pdf-split] ভাঙা গেল না, পুরো ফাইলই পাঠানো হবে:', e instanceof Error ? e.message : e)
    // গ্রেসফুল ফলব্যাক — সার্ভারের নির্ভুল এরর মেসেজের উপর ভরসা
    return {
      parts: [{ blob: new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' }), name: file.name, pageOffset: 0, pageCount: 0 }],
      pageCount: 0,
    }
  }
}

/** ফাইলনেম → পরিষ্কার বইয়ের নাম: "Class_9_Math_2023.pdf" → "Class 9 Math 2023" */
export function cleanBookTitle(fileName: string): string {
  return fileName
    .replace(/\.pdf$/i, '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}
