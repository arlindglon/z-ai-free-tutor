'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  Pencil,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiError } from '@/lib/api'
import { OCR_PROMPT, parseOcrBook } from '@/lib/ocr-book'
import { toBn } from '@/lib/bn'
import type { BookInfo, CategoryInfo } from '@/lib/types'

type EmbedResult = { bookId: string; embeddedCount: number; remainingCount: number }

type TextImportResult = {
  book: BookInfo
  /** true = আগের বইয়ে পৃষ্ঠা যোগ হয়েছে; false = নতুন বই তৈরি হয়েছে */
  appended: boolean
  pageCount: number | null
  chapterCount: number
  chunkCount: number
  usedMarkers: boolean
}

type CategoriesData = { levels: CategoryInfo[]; subjects: CategoryInfo[] }
type CategoryType = 'level' | 'subject'

export function BooksTab() {
  // বইয়ের তালিকা
  const [books, setBooks] = useState<BookInfo[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)

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

  // ---------- ধাপ ২: টেক্সট পেস্ট ফর্ম ----------
  // mode: 'new' = নতুন বই তৈরি | 'append' = আগের বইয়ে পরের ব্যাচের পৃষ্ঠা যোগ (OCR ব্যাচে ব্যাচে হয়)
  const [mode, setMode] = useState<'new' | 'append'>('new')
  const [appendBookId, setAppendBookId] = useState('')
  const [title, setTitle] = useState('')
  const [level, setLevel] = useState('')
  const [subject, setSubject] = useState('')
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // ---------- ধাপ ১: OCR প্রম্পট কপি ----------
  const [promptCopied, setPromptCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ---------- স্তর/বিষয় রেজিস্ট্রি ----------
  const [categories, setCategories] = useState<CategoriesData | null>(null)
  const [catError, setCatError] = useState<string | null>(null)
  const [catBusy, setCatBusy] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [newLevel, setNewLevel] = useState('')
  const [newSubject, setNewSubject] = useState('')
  const [editingCat, setEditingCat] = useState<{ type: CategoryType; id: string; name: string } | null>(
    null
  )
  const [confirmCatId, setConfirmCatId] = useState<string | null>(null)
  const catConfirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadBooks = useCallback(async () => {
    setListError(null)
    try {
      const data = await api<{ books: BookInfo[] }>('/api/admin/books')
      setBooks(data.books)
    } catch (e) {
      setListError(e instanceof ApiError ? e.message : 'বইয়ের তালিকা আনা গেল না, আবার চেষ্টা করো।')
    }
  }, [])

  const loadCategories = useCallback(async () => {
    setCatError(null)
    try {
      const data = await api<CategoriesData>('/api/admin/categories')
      setCategories(data)
    } catch (e) {
      setCatError(e instanceof ApiError ? e.message : 'স্তর/বিষয় তালিকা আনা গেল না।')
    }
  }, [])

  useEffect(() => {
    void loadBooks()
    void loadCategories()
    return () => {
      clearConfirmTimer()
      if (copyTimer.current) clearTimeout(copyTimer.current)
      if (catConfirmTimer.current) clearTimeout(catConfirmTimer.current)
    }
  }, [loadBooks, loadCategories, clearConfirmTimer])

  // কোনো বইয়ের অটো-এমবেড চলছে হলে প্রতি ৪ সেকেন্ডে প্রগ্রেস রিফ্রেশ
  const anyAutoEmbedding = books?.some((b) => b.autoEmbedding) ?? false
  useEffect(() => {
    if (!anyAutoEmbedding) return
    const t = setInterval(() => {
      void loadBooks()
    }, 4000)
    return () => clearInterval(t)
  }, [anyAutoEmbedding, loadBooks])

  // ---------- লাইভ পার্স প্রিভিউ (টাইপ থামলেই পৃষ্ঠা/অধ্যায় গোনে) ----------
  const [debouncedText, setDebouncedText] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedText(text), 300)
    return () => clearTimeout(t)
  }, [text])
  const parsedPreview = useMemo(
    () => (debouncedText.trim().length > 0 ? parseOcrBook(debouncedText) : null),
    [debouncedText]
  )

  // ---------- প্রম্পট কপি ----------
  async function handleCopyPrompt() {
    try {
      await navigator.clipboard.writeText(OCR_PROMPT)
      setPromptCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setPromptCopied(false), 2500)
    } catch {
      setFormError('কপি করা গেল না — প্রম্পটটা আঁকড়ে ধরে নিজে কপি করো।')
    }
  }

  // ---------- স্তর/বিষয় CRUD ----------
  async function addCategory(type: CategoryType) {
    const name = (type === 'level' ? newLevel : newSubject).trim()
    if (!name) return
    setCatBusy(true)
    setCatError(null)
    try {
      await api('/api/admin/categories', { method: 'POST', body: { type, name } })
      if (type === 'level') {
        setNewLevel('')
        setLevel((prev) => prev || name)
      } else {
        setNewSubject('')
        setSubject((prev) => prev || name)
      }
      await loadCategories()
    } catch (e) {
      setCatError(e instanceof ApiError ? e.message : 'যোগ করা গেল না।')
    } finally {
      setCatBusy(false)
    }
  }

  async function renameCategory() {
    if (!editingCat) return
    const name = editingCat.name.trim()
    if (!name) return
    setCatBusy(true)
    setCatError(null)
    try {
      await api('/api/admin/categories', {
        method: 'PATCH',
        body: { id: editingCat.id, name },
      })
      setEditingCat(null)
      await loadCategories()
    } catch (e) {
      setCatError(e instanceof ApiError ? e.message : 'নাম বদলানো গেল না।')
    } finally {
      setCatBusy(false)
    }
  }

  function handleCatDeleteClick(cat: CategoryInfo) {
    if (confirmCatId !== cat.id) {
      setConfirmCatId(cat.id)
      if (catConfirmTimer.current) clearTimeout(catConfirmTimer.current)
      catConfirmTimer.current = setTimeout(() => setConfirmCatId(null), 3000)
      return
    }
    if (catConfirmTimer.current) clearTimeout(catConfirmTimer.current)
    setConfirmCatId(null)
    void deleteCategory(cat.id)
  }

  async function deleteCategory(id: string) {
    setCatError(null)
    try {
      await api(`/api/admin/categories?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      await loadCategories()
    } catch (e) {
      setCatError(e instanceof ApiError ? e.message : 'মুছে ফেলা গেল না।')
    }
  }

  function categoryRows(type: CategoryType): CategoryInfo[] {
    if (!categories) return []
    return type === 'level' ? categories.levels : categories.subjects
  }

  function renderCategoryList(type: CategoryType) {
    const rows = categoryRows(type)
    const isNewBusy = catBusy
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-emerald-800">
          {type === 'level' ? 'স্তর' : 'বিষয়'}
        </p>
        <div className="flex gap-2">
          <Input
            value={type === 'level' ? newLevel : newSubject}
            onChange={(e) => (type === 'level' ? setNewLevel : setNewSubject)(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void addCategory(type)
              }
            }}
            placeholder={type === 'level' ? 'নতুন স্তরের নাম' : 'নতুন বিষয়ের নাম'}
            className="h-10 border-stone-200 focus-visible:ring-emerald-300"
            aria-label={type === 'level' ? 'নতুন স্তরের নাম' : 'নতুন বিষয়ের নাম'}
          />
          <Button
            type="button"
            onClick={() => void addCategory(type)}
            disabled={isNewBusy}
            className="h-10 shrink-0 bg-emerald-600 px-3 text-white shadow-sm hover:bg-emerald-700"
            aria-label={type === 'level' ? 'স্তর যোগ করো' : 'বিষয় যোগ করো'}
          >
            {isNewBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </Button>
        </div>
        <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
          {rows.length === 0 && <p className="py-2 text-xs text-stone-400">এখনো কিছু নেই।</p>}
          {rows.map((c) => {
            const isEditing = editingCat?.id === c.id
            return (
              <div
                key={c.id}
                className="flex items-center gap-1 rounded-lg border border-emerald-50 bg-stone-50/70 px-2 py-1"
              >
                {isEditing ? (
                  <>
                    <Input
                      value={editingCat.name}
                      onChange={(e) => setEditingCat({ ...editingCat, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void renameCategory()
                        }
                      }}
                      className="h-8 border-emerald-200 focus-visible:ring-emerald-300"
                      autoFocus
                      aria-label="নতুন নাম"
                    />
                    <button
                      type="button"
                      onClick={() => void renameCategory()}
                      disabled={catBusy}
                      aria-label="নাম সংরক্ষণ করো"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-emerald-600 hover:bg-emerald-100"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-sm text-stone-700">{c.name}</span>
                    <button
                      type="button"
                      onClick={() => setEditingCat({ type, id: c.id, name: c.name })}
                      aria-label={`"${c.name}" এর নাম বদলাও`}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-stone-400 hover:bg-stone-200 hover:text-stone-600"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCatDeleteClick(c)}
                      aria-label={`"${c.name}" মুছে ফেলো`}
                      className={`flex h-8 shrink-0 items-center justify-center rounded-full text-rose-600 hover:bg-rose-100 ${
                        confirmCatId === c.id ? 'w-auto px-2 text-xs font-bold' : 'w-8'
                      }`}
                    >
                      {confirmCatId === c.id ? 'নিশ্চিত?' : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ---------- টেক্সট থেকে বই সেভ ----------
  async function handleSave() {
    if (saving) return
    setFormError(null)
    setSuccessMsg(null)
    const isAppend = mode === 'append'
    if (isAppend && !appendBookId) {
      setFormError('কোন বইয়ে পৃষ্ঠা যোগ হবে সেটা বাছো।')
      return
    }
    if (!isAppend) {
      const t = title.trim()
      if (t.length < 2) {
        setFormError('বইয়ের নাম দাও।')
        return
      }
      if (!level) {
        setFormError('স্তর সিলেক্ট করো — তালিকায় না থাকলে "ম্যানেজ" থেকে যোগ করো।')
        return
      }
      if (!subject) {
        setFormError('বিষয় সিলেক্ট করো — তালিকায় না থাকলে "ম্যানেজ" থেকে যোগ করো।')
        return
      }
    }
    if (text.trim().length < 120) {
      setFormError('লেখা খুব ছোট — অন্তত ১২০ অক্ষরের OCR টেক্সট পেস্ট করো।')
      return
    }
    setSaving(true)
    try {
      const data = await api<TextImportResult>('/api/admin/books/text', {
        method: 'POST',
        body: isAppend
          ? { bookId: appendBookId, text }
          : { title: title.trim(), level, subject, text },
      })
      if (!isAppend) setTitle('')
      setText('')
      setSuccessMsg(
        data.appended
          ? `"${data.book.title}"-এ যোগ হলো — ${
              data.pageCount ? `${toBn(data.pageCount)} পৃষ্ঠা · ` : ''
            }${toBn(data.chapterCount)} অধ্যায় · ${toBn(data.chunkCount)} চাঙ্ক — অটো-এমবেড চলছে। পরের ব্যাচ এখানেই পেস্ট করতে পারো!`
          : `"${data.book.title}" যোগ হলো — ${
              data.pageCount ? `${toBn(data.pageCount)} পৃষ্ঠা · ` : ''
            }${toBn(data.chapterCount)} অধ্যায় · ${toBn(data.chunkCount)} চাঙ্ক — এখন স্বয়ংক্রিয়ভাবে এমবেড হচ্ছে, তুমি আর কিছু করতে হবে না!`
      )
      await loadBooks()
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'বই সংরক্ষণ করা গেল না, আবার চেষ্টা করো।')
    } finally {
      setSaving(false)
    }
  }

  // ---------- এমবেড/ডিলিট (তালিকা) ----------
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

  const levelOptions = categories?.levels ?? []
  const subjectOptions = categories?.subjects ?? []

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- ধাপ ১: Gemini দিয়ে OCR ---------- */}
      <Card className="rounded-2xl border-emerald-100 bg-white py-0 shadow-sm">
        <CardContent className="flex flex-col gap-4 p-4">
          <div>
            <h3 className="font-semibold text-stone-900">ধাপ ১ — Gemini দিয়ে বই ডিজিটাল করো</h3>
            <p className="mt-1 text-xs text-stone-500">
              স্ক্যান করা বইয়ের PDF থেকে নিখুঁত বাংলা টেক্সট বের করতে Gemini AI ব্যবহার করো —
              নিচের প্রম্পটটা ঠিক আমাদের সিস্টেমের ফরম্যাট অনুযায়ী সাজানো।
            </p>
          </div>

          <ol className="grid gap-2 rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 text-xs text-stone-600 sm:grid-cols-3">
            <li className="flex items-start gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white">
                ১
              </span>
              <span>
                <span className="font-semibold text-emerald-700">gemini.google.com</span>-এ যাও —
                স্ক্যান করা বইয়ের PDF আপলোড করো
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white">
                ২
              </span>
              <span>
                নিচের প্রম্পট কপি করে পাঠাও — বড় বই হলে &quot;এবার পৃষ্ঠা ৬ থেকে ১০ দাও&quot; বলে
                ব্যাচে ব্যাচে নাও
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white">
                ৩
              </span>
              <span>
                সব টেক্সট কপি করে নিচের বক্সে পেস্ট করো — পৃষ্ঠা → অধ্যায় → চাঙ্ক → এমবেড সব
                অটোমেটিক!
              </span>
            </li>
          </ol>

          <div className="relative">
            <Button
              type="button"
              onClick={() => void handleCopyPrompt()}
              className="absolute right-2 top-2 z-10 h-9 bg-emerald-600 px-3 text-xs text-white shadow-sm hover:bg-emerald-700"
            >
              {promptCopied ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {promptCopied ? 'কপি হয়েছে!' : 'প্রম্পট কপি করুন'}
            </Button>
            <pre
              aria-label="Gemini OCR প্রম্পট"
              className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl border border-emerald-100 bg-stone-50 p-3 pt-12 font-sans text-xs leading-relaxed text-stone-700"
            >
              {OCR_PROMPT}
            </pre>
          </div>
        </CardContent>
      </Card>

      {/* ---------- ধাপ ২: টেক্সট পেস্ট করে বই যোগ ---------- */}
      <Card className="rounded-2xl border-emerald-100 bg-white py-0 shadow-sm">
        <CardContent className="flex flex-col gap-4 p-4">
          <div>
            <h3 className="font-semibold text-stone-900">ধাপ ২ — টেক্সট পেস্ট করে বই যোগ করো</h3>
            <p className="mt-1 text-xs text-stone-500">
              &quot;### পৃষ্ঠা N&quot; মার্কার থাকলে পৃষ্ঠা ও অধ্যায় নিজে থেকেই ভাগ হবে — রেফারেন্সে
              প্রকৃত পৃষ্ঠা নম্বর দেখা যাবে। বই বড় হলে প্রথমে <b>নতুন বই</b> বানাও, তারপর প্রতি
              ব্যাচ <b>আগের বইয়ে যোগ</b> দিয়ে পেস্ট করো।
            </p>
          </div>

          {/* মোড টগল: নতুন বই বনাম আগের বইয়ে পৃষ্ঠা যোগ */}
          <div
            className="flex w-fit rounded-xl bg-stone-100 p-1"
            role="tablist"
            aria-label="বই যোগের মোড"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'new'}
              onClick={() => setMode('new')}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                mode === 'new'
                  ? 'bg-white text-emerald-700 shadow-sm'
                  : 'text-stone-500 hover:text-stone-700'
              }`}
            >
              🆕 নতুন বই
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'append'}
              onClick={() => setMode('append')}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                mode === 'append'
                  ? 'bg-white text-emerald-700 shadow-sm'
                  : 'text-stone-500 hover:text-stone-700'
              }`}
            >
              ➕ আগের বইয়ে পৃষ্ঠা যোগ
            </button>
          </div>

          {mode === 'append' ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="append-book" className="text-stone-700">
                কোন বইয়ে পৃষ্ঠা যোগ হবে?
              </Label>
              <Select value={appendBookId} onValueChange={setAppendBookId}>
                <SelectTrigger
                  id="append-book"
                  className="h-11 w-full border-stone-200 focus-visible:ring-emerald-300"
                >
                  <SelectValue placeholder="বই বাছো" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {(books ?? []).map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.title}
                      {b.level ? ` — ${b.level}` : ''}
                      {b.subject ? ` (${b.subject})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {books !== null && books.length === 0 ? (
                <p className="text-xs text-amber-700">
                  এখনো কোনো বই নেই — আগে &quot;নতুন বই&quot; মোডে প্রথম ব্যাচটা যোগ করো।
                </p>
              ) : (
                <p className="text-xs text-stone-500">
                  Gemini থেকে পরের ব্যাচের পৃষ্ঠা (যেমন ৬–১০) পেস্ট করলেই এই বইয়ে যোগ হবে — পৃষ্ঠা
                  নম্বর নিজে থেকেই মিলে যাবে, অটো-এমবেডও চলবে।
                </p>
              )}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5 sm:col-span-1">
              <Label htmlFor="book-title" className="text-stone-700">
                বইয়ের নাম
              </Label>
              <Input
                id="book-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="যেমন: বিজ্ঞান নবম-দশম"
                className="h-11 border-stone-200 focus-visible:ring-emerald-300"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="book-level" className="text-stone-700">
                  স্তর
                </Label>
                <button
                  type="button"
                  onClick={() => setManageOpen(true)}
                  className="flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  ম্যানেজ
                </button>
              </div>
              <Select value={level} onValueChange={setLevel}>
                <SelectTrigger
                  id="book-level"
                  className="h-11 w-full border-stone-200 focus-visible:ring-emerald-300"
                >
                  <SelectValue placeholder="স্তর বাছো" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {levelOptions.map((l) => (
                    <SelectItem key={l.id} value={l.name}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="book-subject" className="text-stone-700">
                  বিষয়
                </Label>
                <button
                  type="button"
                  onClick={() => setManageOpen(true)}
                  className="flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  ম্যানেজ
                </button>
              </div>
              <Select value={subject} onValueChange={setSubject}>
                <SelectTrigger
                  id="book-subject"
                  className="h-11 w-full border-stone-200 focus-visible:ring-emerald-300"
                >
                  <SelectValue placeholder="বিষয় বাছো" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {subjectOptions.map((s) => (
                    <SelectItem key={s.id} value={s.name}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ocr-text" className="text-stone-700">
              বইয়ের OCR টেক্সট
            </Label>
            <Textarea
              id="ocr-text"
              rows={12}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'Gemini থেকে পাওয়া টেক্সট এখানে পেস্ট করো। যেমন:\n\n### পৃষ্ঠা ১\nবইয়ের প্রথম পৃষ্ঠার লেখা...\n---\n### পৃষ্ঠা ২\nদ্বিতীয় পৃষ্ঠার লেখা...'}
              className="min-h-[280px] border-stone-200 font-mono text-sm focus-visible:ring-emerald-300"
            />
          </div>

          {/* লাইভ প্রিভিউ — পেস্ট করলেই পৃষ্ঠা/অধ্যায় গুনে দেখায় */}
          {parsedPreview && (
            <div className="flex flex-col gap-2 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3">
              {parsedPreview.usedMarkers ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-stone-600">
                    <Badge variant="outline" className="rounded-full border-emerald-200 bg-white">
                      পৃষ্ঠা: {toBn(parsedPreview.pageCount)}
                    </Badge>
                    <Badge variant="outline" className="rounded-full border-emerald-200 bg-white">
                      অধ্যায়: {toBn(parsedPreview.chapterCount)}
                    </Badge>
                    <span className="text-emerald-700">✓ পৃষ্ঠা মার্কিং পাওয়া গেছে</span>
                  </div>
                  {parsedPreview.chapters.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {parsedPreview.chapters.slice(0, 8).map((ch, i) => (
                        <Badge
                          key={`${ch.title}-${i}`}
                          variant="outline"
                          className="max-w-56 truncate rounded-full border-stone-200 bg-white text-stone-600"
                        >
                          {ch.number !== null ? `${toBn(ch.number)}. ` : ''}
                          {ch.title}
                          {ch.pageStart !== null ? ` (পৃষ্ঠা ${toBn(ch.pageStart)})` : ''}
                        </Badge>
                      ))}
                      {parsedPreview.chapters.length > 8 && (
                        <Badge
                          variant="outline"
                          className="rounded-full border-stone-200 bg-white text-stone-500"
                        >
                          + আরও {toBn(parsedPreview.chapters.length - 8)}টি
                        </Badge>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-amber-700">
                  ⚠️ পৃষ্ঠা মার্কার পাওয়া যায়নি — পুরো লেখা এক অধ্যায় হিসেবে যাবে। উপরের প্রম্পট
                  ব্যবহার করলে Gemini &quot;### পৃষ্ঠা N&quot; ফরম্যাটে টেক্সট দেবে।
                </p>
              )}
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
            {saving ? 'বই যোগ হচ্ছে...' : 'বই যোগ করুন'}
          </Button>
        </CardContent>
      </Card>

      {/* ---------- স্তর/বিষয় ম্যানেজ ডায়ালগ ---------- */}
      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-w-lg rounded-2xl border-emerald-100">
          <DialogHeader>
            <DialogTitle>স্তর ও বিষয় ম্যানেজ করুন</DialogTitle>
            <DialogDescription>
              নতুন যোগ করো, নাম বদলাও বা মুছে ফেলো — এখানের বদল সাথে সাথে বইয়ের ফর্মে দেখা যাবে।
            </DialogDescription>
          </DialogHeader>
          {catError && (
            <Alert variant="destructive" className="rounded-xl border-rose-200 bg-rose-50">
              <AlertDescription className="text-rose-700">{catError}</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-5 sm:grid-cols-2">
            {renderCategoryList('level')}
            {renderCategoryList('subject')}
          </div>
        </DialogContent>
      </Dialog>

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
          এখনো কোনো বই নেই — উপরের ধাপ ১ ও ২ অনুসরণ করে প্রথম বইটা যোগ করো!
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
                        {book.level && (
                          <Badge
                            variant="outline"
                            className="border-emerald-200 bg-white text-emerald-700"
                          >
                            {book.level}
                          </Badge>
                        )}
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
