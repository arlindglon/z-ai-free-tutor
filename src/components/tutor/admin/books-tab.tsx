'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Sparkles, Trash2, X } from 'lucide-react'
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
import type { BookInfo } from '@/lib/types'

type DraftChapter = {
  title: string
  number?: number
  pageStart?: number
  content: string
}

type EmbedResult = { bookId: string; embeddedCount: number; remainingCount: number }

export function BooksTab() {
  const [books, setBooks] = useState<BookInfo[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  // বইয়ের ফর্ম
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
        `"${data.book.title}" সংরক্ষণ হয়েছে — ${toBn(data.book.chapters.length)}টি অধ্যায় যোগ হলো। এখন এমবেড করো!`
      )
      await loadBooks()
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'বই সংরক্ষণ করা গেল না, আবার চেষ্টা করো।')
    } finally {
      setSaving(false)
    }
  }

  async function handleEmbed(book: BookInfo) {
    if (busyBookId) return
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
    if (busyBookId === book.id) return 'এমবেড হচ্ছে...'
    const res = embedResult && embedResult.bookId === book.id ? embedResult : null
    if (res && res.remainingCount > 0) return 'আরও এমবেড করুন'
    if (bookAllEmbedded(book)) return 'সব এমবেডেড ✓'
    return 'এমবেড করুন'
  }

  return (
    <div className="flex flex-col gap-4">
      {/* নতুন বই যোগ */}
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

      {books === null && !listError ? (
        <div className="flex flex-col gap-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-2xl bg-emerald-50" />
          ))}
        </div>
      ) : books !== null && books.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-emerald-200 bg-white p-6 text-center text-sm text-stone-500">
          এখনো কোনো বই নেই — উপরের ফর্ম থেকে প্রথম বই যোগ করো।
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
                      disabled={busyBookId !== null || allDone}
                      className="h-11 bg-emerald-600 px-4 text-white shadow-sm hover:bg-emerald-700"
                    >
                      {busyBookId === book.id ? (
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
