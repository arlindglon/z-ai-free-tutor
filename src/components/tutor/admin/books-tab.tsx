'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BookOpen,
  CheckCircle2,
  CloudUpload,
  FileText,
  Loader2,
  PenLine,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiError } from '@/lib/api'
import { SUBJECTS, toBn } from '@/lib/bn'
import { cleanBookTitle, splitPdfForUpload } from '@/lib/pdf-split'
import type { BookInfo } from '@/lib/types'

type DraftChapter = {
  title: string
  number?: number
  pageStart?: number
  content: string
}

type EmbedResult = { bookId: string; embeddedCount: number; remainingCount: number }

type UploadResult = {
  book: BookInfo
  pageCount: number
  chunkCount: number
  autoEmbed: boolean
}

/** আপলোড কিউ-এর একটা ফাইল — ড্রপ করলেই পরপর প্রসেস হয় */
type QueueItem = {
  id: string
  file: File
  fileName: string
  fileSize: number
  subject: string
  board: string
  status: 'waiting' | 'working' | 'done' | 'failed'
  phase: string | null
  message: string | null
  error: string | null
}

const MAX_PDF_BYTES = 150 * 1024 * 1024

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `q-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function BooksTab() {
  const [books, setBooks] = useState<BookInfo[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  // মোড টগল: PDF আপলোড (ডিফল্ট) / ম্যানুয়াল লেখা
  const [mode, setMode] = useState<'pdf' | 'manual'>('pdf')

  // PDF আপলোড কিউ — ড্রপ করলেই অটো-স্টার্ট, একাধিক একসাথে
  const [queue, setQueue] = useState<QueueItem[]>([])
  const queueRef = useRef<QueueItem[]>([])
  const runningRef = useRef(false)
  const [dragging, setDragging] = useState(false)
  const [pdfSubject, setPdfSubject] = useState('')
  const [pdfBoard, setPdfBoard] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const setQueueBoth = useCallback((updater: (prev: QueueItem[]) => QueueItem[]) => {
    const next = updater(queueRef.current)
    queueRef.current = next
    setQueue(next)
  }, [])

  const updateItem = useCallback(
    (id: string, patch: Partial<QueueItem>) => {
      setQueueBoth((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)))
    },
    [setQueueBoth]
  )

  // ম্যানুয়াল বইয়ের ফর্ম
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState<string>('')
  const [board, setBoard] = useState('')
  const [chTitle, setChTitle] = useState('')
  const [chNumber, setChNumber] = useState('')
  const [chPageStart, setChPageStart] = useState('')
  const [chContent, setChContent] = useState('')
  const [chapters, setChapters] = useState<DraftChapter[]>([])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // এমবেড
  const [busyBookId, setBusyBookId] = useState<string | null>(null)
  const [embedResult, setEmbedResult] = useState<EmbedResult | null>(null)
  const [embedError, setEmbedError] = useState<string | null>(null)

  // দুই-ক্লিক কনফার্ম ডিলিট
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearConfirmTimer = useCallback(() => {
    if (confirmTimer.current) {
      clearTimeout(confirmTimer.current)
      confirmTimer.current = null
    }
  }, [])

  const loadBooks = useCallback(async () => {
    setListError(null)
    try {
      const data = await api<{ books: BookInfo[] }>('/api/admin/books')
      setBooks(data.books)
    } catch (e) {
      setListError(e instanceof ApiError ? e.message : 'বইয়ের তালিকা আনা গেল না, আবার চেষ্টা করো।')
    }
  }, [])

  useEffect(() => {
    void loadBooks()
    return clearConfirmTimer
  }, [loadBooks, clearConfirmTimer])

  // কোনো বইয়ের অটো-এমবেড চলছে হলে প্রতি ৪ সেকেন্ডে প্রগ্রেস রিফ্রেশ
  const anyAutoEmbedding = books?.some((b) => b.autoEmbedding) ?? false
  useEffect(() => {
    if (!anyAutoEmbedding) return
    const t = setInterval(() => {
      void loadBooks()
    }, 4000)
    return () => clearInterval(t)
  }, [anyAutoEmbedding, loadBooks])

  // ---------- PDF আপলোড কিও রানার ----------
  const processItem = useCallback(
    async (item: QueueItem) => {
      updateItem(item.id, { status: 'working', phase: 'বই পড়া হচ্ছে…', error: null, message: null })
      try {
        // বড় PDF ব্রাউজারেই পাতা-ধরে ভেঙে যায় (Vercel-এর ৪.৫MB লিমিট টপকাতে)
        const { parts, pageCount: splitPageCount } = await splitPdfForUpload(item.file)
        let bookId: string | null = null
        let totalChunks = 0
        let totalPages = splitPageCount

        for (let i = 0; i < parts.length; i++) {
          const part = parts[i]
          updateItem(item.id, {
            phase:
              parts.length > 1
                ? `অংশ ${toBn(i + 1)}/${toBn(parts.length)} আপলোড হচ্ছে…`
                : 'আপলোড হচ্ছে…',
          })

          const fd = new FormData()
          fd.append('file', part.blob, part.name)
          if (i === 0) {
            fd.append('title', cleanBookTitle(item.fileName))
            if (item.subject) fd.append('subject', item.subject)
            if (item.board) fd.append('board', item.board)
          } else {
            fd.append('bookId', bookId!)
            fd.append('pageOffset', String(part.pageOffset))
          }

          const res = await fetch('/api/admin/books/upload', {
            method: 'POST',
            body: fd,
            credentials: 'same-origin',
            cache: 'no-store',
          })
          const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
          if (!res.ok) {
            const msg =
              typeof data.error === 'string' && data.error
                ? data.error
                : 'আপলোড করা গেল না, আবার চেষ্টা করো।'
            throw new ApiError(
              msg,
              res.status,
              typeof data.code === 'string' ? data.code : undefined,
              data
            )
          }
          const r = data as unknown as UploadResult
          if (i === 0) bookId = r.book.id
          totalChunks += r.chunkCount ?? 0
          if (!totalPages) totalPages = r.pageCount ?? 0
        }

        updateItem(item.id, {
          status: 'done',
          phase: null,
          message: `${toBn(totalPages || splitPageCount)} পৃষ্ঠা · ${toBn(totalChunks)} চাঙ্ক${
            parts.length > 1 ? ` (${toBn(parts.length)}টি অংশে ভাগ হয়েছে)` : ''
          } — অটো-এমবেড চলছে!`,
        })
        await loadBooks()
      } catch (e) {
        updateItem(item.id, {
          status: 'failed',
          phase: null,
          error: e instanceof ApiError ? e.message : 'আপলোড করা গেল না, আবার চেষ্টা করো।',
        })
      }
    },
    [updateItem, loadBooks]
  )

  const runQueue = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    try {
      for (;;) {
        const next = queueRef.current.find((q) => q.status === 'waiting')
        if (!next) break
        await processItem(next)
      }
    } finally {
      runningRef.current = false
    }
  }, [processItem])

  function acceptFiles(list: FileList | File[] | null | undefined) {
    if (!list || list.length === 0) return
    const files = Array.from(list)
    const items: QueueItem[] = []
    for (const f of files) {
      const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
      const base = {
        id: newId(),
        file: f,
        fileName: f.name,
        fileSize: f.size,
        subject: pdfSubject,
        board: pdfBoard.trim(),
        phase: null,
        message: null,
        error: null,
      }
      if (!isPdf) {
        items.push({ ...base, status: 'failed', error: 'শুধু PDF ফাইল দেওয়া যাবে।' })
        continue
      }
      if (f.size > MAX_PDF_BYTES) {
        items.push({ ...base, status: 'failed', error: 'ফাইল খুব বড় — সর্বোচ্চ ১৫০ MB আপলোড করা যাবে।' })
        continue
      }
      items.push({ ...base, status: 'waiting' })
    }
    if (!items.length) return
    setQueueBoth((prev) => [...prev, ...items])
    void runQueue()
  }

  function removeQueueItem(id: string) {
    setQueueBoth((prev) => prev.filter((q) => q.id !== id))
  }

  function retryQueueItem(item: QueueItem) {
    setQueueBoth((prev) => [
      ...prev.filter((q) => q.id !== item.id),
      { ...item, id: newId(), status: 'waiting', phase: null, message: null, error: null },
    ])
    void runQueue()
  }

  // ---------- ম্যানুয়াল ফর্ম ----------
  function addChapter() {
    setFormError(null)
    setSuccessMsg(null)
    const t = chTitle.trim()
    const c = chContent.trim()
    if (!t) {
      setFormError('অধ্যায়ের শিরোনাম দাও।')
      return
    }
    if (c.length < 50) {
      setFormError('লেখা খুব ছোট — অন্তত ৫০ অক্ষরের লেখা পেস্ট করো।')
      return
    }
    const num = chNumber.trim() === '' ? undefined : Number(chNumber)
    const page = chPageStart.trim() === '' ? undefined : Number(chPageStart)
    if (num !== undefined && (!Number.isFinite(num) || num <= 0)) {
      setFormError('অধ্যায় নম্বর সঠিক পজিটিভ সংখ্যা দাও।')
      return
    }
    if (page !== undefined && (!Number.isFinite(page) || page <= 0)) {
      setFormError('শুরু পৃষ্ঠা সঠিক পজিটিভ সংখ্যা দাও।')
      return
    }
    setChapters((prev) => [...prev, { title: t, number: num, pageStart: page, content: c }])
    setChTitle('')
    setChNumber('')
    setChPageStart('')
    setChContent('')
  }

  function removeChapter(index: number) {
    setChapters((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSave() {
    if (saving) return
    setFormError(null)
    setSuccessMsg(null)
    const t = title.trim()
    if (t.length < 2) {
      setFormError('বইয়ের নাম দাও।')
      return
    }
    if (!subject) {
      setFormError('বিষয় সিলেক্ট করো।')
      return
    }
    if (!chapters.length) {
      setFormError('কমপক্ষে একটি অধ্যায় যোগ করো।')
      return
    }
    setSaving(true)
    try {
      const data = await api<{ book: BookInfo }>('/api/admin/books', {
        method: 'POST',
        body: {
          title: t,
          subject,
          board: board.trim() || undefined,
          chapters: chapters.map((ch) => ({
            title: ch.title,
            number: ch.number,
            pageStart: ch.pageStart,
            content: ch.content,
          })),
        },
      })
      setTitle('')
      setSubject('')
      setBoard('')
      setChapters([])
      setSuccessMsg(
        `"${data.book.title}" সংরক্ষণ হয়েছে — ${toBn(
          data.book.chapters.length
        )}টি অধ্যায় যোগ হলো। এখন স্বয়ংক্রিয়ভাবে এমবেড হচ্ছে, তুমি আর কিছু করতে হবে না!`
      )
      await loadBooks()
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'বই সংরক্ষণ করা গেল না, আবার চেষ্টা করো।')
    } finally {
      setSaving(false)
    }
  }

  async function handleEmbed(book: BookInfo) {
    if (busyBookId || book.autoEmbedding) return
    setEmbedError(null)
    setEmbedResult(null)
    setBusyBookId(book.id)
    try {
      const data = await api<{ embeddedCount: number; remainingCount: number }>('/api/admin/embed', {
        method: 'POST',
        body: { bookId: book.id },
      })
      setEmbedResult({
        bookId: book.id,
        embeddedCount: data.embeddedCount,
        remainingCount: data.remainingCount,
      })
      await loadBooks()
    } catch (e) {
      setEmbedError(e instanceof ApiError ? e.message : 'এমবেডিং করা গেল না, আবার চেষ্টা করো।')
    } finally {
      setBusyBookId(null)
    }
  }

  function handleDeleteClick(id: string) {
    if (confirmId !== id) {
      setConfirmId(id)
      clearConfirmTimer()
      confirmTimer.current = setTimeout(() => setConfirmId(null), 3000)
      return
    }
    clearConfirmTimer()
    setConfirmId(null)
    void doDelete(id)
  }

  async function doDelete(id: string) {
    setEmbedError(null)
    try {
      await api<{ ok: true }>(`/api/admin/books/${id}`, { method: 'DELETE' })
      setBooks((prev) => (prev ? prev.filter((b) => b.id !== id) : prev))
      setEmbedResult(null)
    } catch (e) {
      setListError(e instanceof ApiError ? e.message : 'বই মুছে ফেলা গেল না।')
    }
  }

  function bookAllEmbedded(book: BookInfo): boolean {
    return (
      book.chapters.length > 0 &&
      book.chapters.every((c) => c.chunkCount > 0 && c.embeddedCount >= c.chunkCount)
    )
  }

  function embedLabel(book: BookInfo): string {
    if (book.autoEmbedding) return 'অটো-এমবেড চলছে...'
    if (busyBookId === book.id) return 'এমবেড হচ্ছে...'
    const res = embedResult && embedResult.bookId === book.id ? embedResult : null
    if (res && res.remainingCount > 0) return 'আরও এমবেড করুন'
    if (book.embedError) return 'আবার এমবেড করুন'
    if (bookAllEmbedded(book)) return 'সব এমবেডেড ✓'
    return 'এমবেড করুন'
  }

  // তালিকার উপরের সামারি — মোট বই / অধ্যায় / চাঙ্ক
  const totals = (books ?? []).reduce(
    (acc, b) => {
      acc.books += 1
      for (const ch of b.chapters) {
        acc.chapters += 1
        acc.chunks += ch.chunkCount
        acc.embedded += ch.embeddedCount
      }
      return acc
    },
    { books: 0, chapters: 0, chunks: 0, embedded: 0 }
  )

  return (
    <div className="flex flex-col gap-4">
      {/* মোড টগল */}
      <div className="flex w-full gap-1 rounded-full border border-emerald-100 bg-emerald-50/60 p-1 sm:w-fit">
        <button
          type="button"
          onClick={() => setMode('pdf')}
          aria-pressed={mode === 'pdf'}
          className={`flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors sm:flex-none ${
            mode === 'pdf'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'text-emerald-700 hover:bg-emerald-100'
          }`}
        >
          <BookOpen className="h-4 w-4" />
          PDF আপলোড
        </button>
        <button
          type="button"
          onClick={() => setMode('manual')}
          aria-pressed={mode === 'manual'}
          className={`flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors sm:flex-none ${
            mode === 'manual'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'text-emerald-700 hover:bg-emerald-100'
          }`}
        >
          <PenLine className="h-4 w-4" />
          ম্যানুয়াল লেখা
        </button>
      </div>

      {/* ---------- PDF আপলোড মোড ---------- */}
      {mode === 'pdf' && (
        <>
          <Card className="rounded-2xl border-emerald-100 bg-white py-0 shadow-sm">
            <CardContent className="flex flex-col gap-4 p-4">
              <div>
                <h3 className="font-semibold text-stone-900">
                  বই যোগ করো — টেনে আনো, বাকি সব অটোমেটিক!
                </h3>
                <p className="mt-1 text-xs text-stone-500">
                  ড্রপ করলেই আপলোড শুরু হয় — একাধিক PDF একসাথে দেওয়া যায়, বড় বই নিজে থেকেই
                  অংশে ভেঙে আপলোড হয় (সর্বোচ্চ ১৫০ MB)।
                </p>
              </div>

              {/* ৩-ধাপের গাইড */}
              <ol className="grid gap-2 rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 text-xs text-stone-600 sm:grid-cols-3">
                <li className="flex items-start gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white">
                    ১
                  </span>
                  <span>
                    বইয়ের PDF জোগাড় করো — NCTB-র সব ক্লাসের ফ্রি PDF:{' '}
                    <span className="font-semibold text-emerald-700">nctb.gov.bd</span>
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white">
                    ২
                  </span>
                  <span>নিচে টেনে আনো বা ক্লিক করে বাছো — বিষয় দিতে চাইলে আগে নিচে সেট করো</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white">
                    ৩
                  </span>
                  <span>
                    ব্যস! টেক্সট → অধ্যায় → এমবেড সব অটোমেটিক — শেষ হলে স্টুডেন্টরা বই থেকেই
                    উত্তর পাবে
                  </span>
                </li>
              </ol>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pdf-subject" className="text-stone-700">
                    বিষয় <span className="font-normal text-stone-400">(ঐচ্ছিক)</span>
                  </Label>
                  <Select value={pdfSubject} onValueChange={setPdfSubject}>
                    <SelectTrigger
                      id="pdf-subject"
                      className="h-11 w-full border-stone-200 focus-visible:ring-emerald-300"
                    >
                      <SelectValue placeholder="সাধারণ (ডিফল্ট)" />
                    </SelectTrigger>
                    <SelectContent>
                      {SUBJECTS.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pdf-board" className="text-stone-700">
                    বোর্ড <span className="font-normal text-stone-400">(ঐচ্ছিক)</span>
                  </Label>
                  <Input
                    id="pdf-board"
                    value={pdfBoard}
                    onChange={(e) => setPdfBoard(e.target.value)}
                    placeholder="NCTB (ডিফল্ট)"
                    className="h-11 border-stone-200 focus-visible:ring-emerald-300"
                  />
                </div>
              </div>

              <div
                role="button"
                tabIndex={0}
                aria-label="PDF ফাইল বাছো বা টেনে আনো — একাধিক ফাইল দেওয়া যাবে"
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    fileInputRef.current?.click()
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragging(false)
                  acceptFiles(e.dataTransfer.files)
                }}
                className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
                  dragging
                    ? 'border-emerald-400 bg-emerald-50'
                    : 'border-emerald-200 bg-emerald-50/40 hover:bg-emerald-50'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    acceptFiles(e.target.files)
                    e.target.value = ''
                  }}
                />
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
                  <CloudUpload className="h-5 w-5 text-emerald-700" />
                </div>
                <p className="text-sm font-semibold text-emerald-800">
                  এখানে PDF টেনে আনো, অথবা ক্লিক করে বাছো
                </p>
                <p className="text-xs text-stone-500">
                  একাধিক PDF একসাথে চলবে · ছোট-বড় সব বই অটো-প্রসেস হবে · টেক্সট-ভিত্তিক PDF দাও
                  (স্ক্যান করা ছবি নয়)
                </p>
              </div>

              {/* আপলোড কিউ — প্রতিটা ফাইলের লাইভ স্টেটাস */}
              {queue.length > 0 && (
                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {queue.map((q) => (
                    <div
                      key={q.id}
                      className={`flex items-start gap-2.5 rounded-xl border p-3 ${
                        q.status === 'failed'
                          ? 'border-rose-200 bg-rose-50/60'
                          : q.status === 'done'
                            ? 'border-emerald-200 bg-emerald-50/60'
                            : 'border-emerald-100 bg-stone-50/70'
                      }`}
                    >
                      <span className="mt-0.5 shrink-0">
                        {q.status === 'working' ? (
                          <Loader2 className="h-4 w-4 animate-spin text-emerald-700" />
                        ) : q.status === 'done' ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        ) : q.status === 'failed' ? (
                          <XCircle className="h-4 w-4 text-rose-600" />
                        ) : (
                          <FileText className="h-4 w-4 text-stone-400" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-stone-800">{q.fileName}</p>
                        <p className="mt-0.5 text-xs text-stone-500">
                          {formatSize(q.fileSize)}
                          {q.subject ? ` · ${q.subject}` : ''}
                        </p>
                        {q.status === 'working' && q.phase && (
                          <p className="mt-1 text-xs font-medium text-emerald-700">{q.phase}</p>
                        )}
                        {q.status === 'done' && q.message && (
                          <p className="mt-1 text-xs font-medium text-emerald-700">{q.message}</p>
                        )}
                        {q.status === 'failed' && q.error && (
                          <p className="mt-1 text-xs font-medium text-rose-700">{q.error}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {q.status === 'failed' && (
                          <button
                            type="button"
                            onClick={() => retryQueueItem(q)}
                            aria-label="আবার চেষ্টা করো"
                            className="flex h-8 w-8 items-center justify-center rounded-full text-rose-600 hover:bg-rose-100"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => removeQueueItem(q.id)}
                          aria-label="তালিকা থেকে বাদ দাও"
                          className="flex h-8 w-8 items-center justify-center rounded-full text-stone-400 hover:bg-stone-200 hover:text-stone-600"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* ---------- ম্যানুয়াল মোড ---------- */}
      {mode === 'manual' && (
        <Card className="rounded-2xl border-emerald-100 bg-white py-0 shadow-sm">
          <CardContent className="flex flex-col gap-4 p-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5 sm:col-span-1">
                <Label htmlFor="book-title" className="text-stone-700">
                  বইয়ের নাম
                </Label>
                <Input
                  id="book-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="যেমন: গণিত নবম-দশম"
                  className="h-11 border-stone-200 focus-visible:ring-emerald-300"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="book-subject" className="text-stone-700">
                  বিষয়
                </Label>
                <Select value={subject} onValueChange={setSubject}>
                  <SelectTrigger
                    id="book-subject"
                    className="h-11 w-full border-stone-200 focus-visible:ring-emerald-300"
                  >
                    <SelectValue placeholder="বিষয় বাছো" />
                  </SelectTrigger>
                  <SelectContent>
                    {SUBJECTS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="book-board" className="text-stone-700">
                  বোর্ড <span className="font-normal text-stone-400">(ঐচ্ছিক)</span>
                </Label>
                <Input
                  id="book-board"
                  value={board}
                  onChange={(e) => setBoard(e.target.value)}
                  placeholder="NCTB"
                  className="h-11 border-stone-200 focus-visible:ring-emerald-300"
                />
              </div>
            </div>

            <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3">
              <p className="mb-3 text-sm font-semibold text-emerald-800">অধ্যায় যোগ করো</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5 sm:col-span-3 sm:grid sm:grid-cols-3 sm:gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ch-title" className="text-stone-700">
                      অধ্যায়ের শিরোনাম
                    </Label>
                    <Input
                      id="ch-title"
                      value={chTitle}
                      onChange={(e) => setChTitle(e.target.value)}
                      placeholder="যেমন: বীজগাণিতিক রাশি"
                      className="h-11 border-stone-200 focus-visible:ring-emerald-300"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ch-number" className="text-stone-700">
                      অধ্যায় নম্বর <span className="font-normal text-stone-400">(ঐচ্ছিক)</span>
                    </Label>
                    <Input
                      id="ch-number"
                      type="number"
                      min={1}
                      value={chNumber}
                      onChange={(e) => setChNumber(e.target.value)}
                      placeholder="যেমন: ৩"
                      className="h-11 border-stone-200 focus-visible:ring-emerald-300"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ch-page" className="text-stone-700">
                      শুরু পৃষ্ঠা <span className="font-normal text-stone-400">(ঐচ্ছিক)</span>
                    </Label>
                    <Input
                      id="ch-page"
                      type="number"
                      min={1}
                      value={chPageStart}
                      onChange={(e) => setChPageStart(e.target.value)}
                      placeholder="যেমন: ২৫"
                      className="h-11 border-stone-200 focus-visible:ring-emerald-300"
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-3">
                  <Label htmlFor="ch-content" className="text-stone-700">
                    বিষয়বস্তু
                  </Label>
                  <Textarea
                    id="ch-content"
                    rows={10}
                    value={chContent}
                    onChange={(e) => setChContent(e.target.value)}
                    placeholder="বইয়ের এই অধ্যায়ের লেখা এখানে পেস্ট করো। স্ক্যান করা বই হলে OCR করে টেক্সট পেস্ট করো — যত বেশি বিস্তারিত, তত ভালো উত্তর!"
                    className="border-stone-200 focus-visible:ring-emerald-300"
                  />
                </div>
              </div>
              <Button
                type="button"
                onClick={addChapter}
                className="mt-3 h-11 w-full border border-emerald-300 bg-white text-emerald-700 shadow-sm hover:bg-emerald-50 sm:w-fit sm:px-4"
              >
                অধ্যায় যোগ করো
              </Button>
            </div>

            {chapters.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {chapters.map((ch, i) => (
                  <Badge
                    key={`${ch.title}-${i}`}
                    variant="outline"
                    className="h-8 gap-1 rounded-full border-emerald-200 bg-emerald-50 pl-3 pr-1 text-emerald-800"
                  >
                    <span className="max-w-48 truncate">
                      {ch.number !== undefined ? `অধ্যায় ${toBn(ch.number)}. ` : ''}
                      {ch.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeChapter(i)}
                      aria-label={`"${ch.title}" অধ্যায় বাদ দাও`}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-emerald-600 hover:bg-emerald-100"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            {formError && (
              <Alert variant="destructive" className="rounded-xl border-rose-200 bg-rose-50">
                <AlertDescription className="text-rose-700">{formError}</AlertDescription>
              </Alert>
            )}
            {successMsg && (
              <Alert className="rounded-xl border-emerald-200 bg-emerald-50">
                <AlertDescription className="text-emerald-800">{successMsg}</AlertDescription>
              </Alert>
            )}

            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="h-11 w-full bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 sm:w-fit sm:px-6"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {saving ? 'সংরক্ষণ হচ্ছে...' : 'বই সংরক্ষণ করো'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* এমবেড এরর */}
      {embedError && (
        <Alert variant="destructive" className="rounded-2xl border-rose-200 bg-rose-50">
          <AlertDescription className="text-rose-700">{embedError}</AlertDescription>
        </Alert>
      )}

      {/* বইয়ের তালিকা */}
      {listError && (
        <Alert variant="destructive" className="rounded-2xl border-rose-200 bg-rose-50">
          <AlertDescription className="text-rose-700">{listError}</AlertDescription>
        </Alert>
      )}

      {/* সামারি চিপস */}
      {books !== null && books.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-stone-600">
          <Badge variant="outline" className="rounded-full border-emerald-200 bg-white">
            মোট বই: {toBn(totals.books)}
          </Badge>
          <Badge variant="outline" className="rounded-full border-emerald-200 bg-white">
            অধ্যায়: {toBn(totals.chapters)}
          </Badge>
          <Badge variant="outline" className="rounded-full border-emerald-200 bg-white">
            এমবেডেড চাঙ্ক: {toBn(totals.embedded)}/{toBn(totals.chunks)}
          </Badge>
          {totals.chunks > 0 && totals.embedded >= totals.chunks && (
            <Badge className="rounded-full border-emerald-200 bg-emerald-100 text-emerald-800">
              নলেজবেস রেডি ✓
            </Badge>
          )}
        </div>
      )}

      {books === null && !listError ? (
        <div className="flex flex-col gap-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-2xl bg-emerald-50" />
          ))}
        </div>
      ) : books !== null && books.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-emerald-200 bg-white p-6 text-center text-sm text-stone-500">
          এখনো কোনো বই নেই — উপরে PDF টেনে আনো, বাকি সব অটোমেটিক হবে!
        </p>
      ) : books !== null ? (
        <div className="flex flex-col gap-4">
          {books.map((book) => {
            const allDone = bookAllEmbedded(book)
            return (
              <Card key={book.id} className="rounded-2xl border-emerald-100 bg-white py-0 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-stone-900">{book.title}</h3>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <Badge className="border-emerald-200 bg-emerald-100 text-emerald-800">
                          {book.subject}
                        </Badge>
                        {book.board && (
                          <span className="text-xs text-stone-500">বোর্ড: {book.board}</span>
                        )}
                        {book.autoEmbedding && (
                          <Badge className="gap-1.5 border-emerald-200 bg-emerald-50 text-emerald-700">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            স্বয়ংক্রিয় এমবেড হচ্ছে…
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      onClick={() => handleDeleteClick(book.id)}
                      disabled={busyBookId === book.id}
                      aria-label="বই মুছে ফেলো"
                      className={
                        confirmId === book.id
                          ? 'h-11 shrink-0 bg-rose-600 px-3 text-xs font-bold text-white hover:bg-rose-700 hover:text-white'
                          : 'h-11 w-11 shrink-0 px-0 text-rose-600 hover:bg-rose-50'
                      }
                    >
                      {confirmId === book.id ? 'নিশ্চিত?' : <Trash2 className="h-4 w-4" />}
                    </Button>
                  </div>

                  {/* অটো-এমবেড থেমে গেলে কারণ দেখাও — আর চুপচাপ নয় */}
                  {book.embedError && !book.autoEmbedding && (
                    <Alert className="mt-3 rounded-xl border-amber-200 bg-amber-50">
                      <AlertDescription className="text-xs text-amber-800">
                        ⚠️ {book.embedError}
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="mt-3 max-h-96 space-y-3 overflow-y-auto pr-1">
                    {book.chapters.map((ch) => {
                      const pct = ch.chunkCount > 0 ? (ch.embeddedCount / ch.chunkCount) * 100 : 0
                      return (
                        <div
                          key={ch.id}
                          className="rounded-xl border border-emerald-50 bg-stone-50/70 p-3"
                        >
                          <p className="text-sm font-medium text-stone-800">
                            {ch.number !== null ? `অধ্যায় ${toBn(ch.number)}. ` : ''}
                            {ch.title}
                          </p>
                          <p className="mt-1 text-xs text-stone-500">
                            চাঙ্ক: {toBn(ch.embeddedCount)}/{toBn(ch.chunkCount)} এমবেডেড
                          </p>
                          <Progress
                            value={pct}
                            aria-label={`${ch.title} এমবেড প্রগ্রেস`}
                            className="mt-2 h-2 bg-emerald-100"
                          />
                        </div>
                      )
                    })}
                    {book.chapters.length === 0 && (
                      <p className="text-xs text-stone-400">এই বইয়ে কোনো অধ্যায় নেই।</p>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      onClick={() => void handleEmbed(book)}
                      disabled={busyBookId !== null || allDone || book.autoEmbedding}
                      title={
                        book.autoEmbedding
                          ? 'অটো-এমবেড চলছে — শেষ হলে বাকি থাকলে আবার চাপতে পারো'
                          : undefined
                      }
                      className="h-11 bg-emerald-600 px-4 text-white shadow-sm hover:bg-emerald-700"
                    >
                      {busyBookId === book.id || book.autoEmbedding ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                      {embedLabel(book)}
                    </Button>
                    {embedResult && embedResult.bookId === book.id && (
                      <p
                        className={`text-xs font-medium ${
                          embedResult.remainingCount > 0 ? 'text-amber-600' : 'text-emerald-700'
                        }`}
                      >
                        {toBn(embedResult.embeddedCount)}টি এমবেড হলো, বাকি {toBn(embedResult.remainingCount)}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
