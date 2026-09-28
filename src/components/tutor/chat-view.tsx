'use client'

import { useEffect, useRef, useState } from 'react'
import {
  GraduationCap,
  Loader2,
  LogOut,
  Mic,
  SendHorizonal,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiError } from '@/lib/api'
import { SUBJECTS, toBn } from '@/lib/bn'
import { isSttSupported, startListening, stopSpeaking } from '@/lib/speech'
import type {
  ChatApiResponse,
  Credits,
  HistoryMessage,
  UserInfo,
} from '@/lib/types'
import { MessageBubble, type MessageBubbleData } from '@/components/tutor/message-bubble'

export interface ChatViewProps {
  user: UserInfo
  onLogout: () => void
}

const ALL_SUBJECTS = 'সব বিষয়'

const WELCOME_TEXT =
  'আসসালামু আলাইকুম! 👋 আমি **Z-AI টিউটর** — তোমার নিজের ফ্রি প্রাইভেট শিক্ষক।\n\nযেকোনো বিজ্ঞান বা গণিতের প্রশ্ন লিখে লেখো, অথবা মাইক চেপে মুখে বলো! আমি পাঠ্যবই থেকে রেফারেন্স দিয়ে ধাপে ধাপে বুঝিয়ে দেব।'

const SUGGESTIONS = [
  'আর্কিমিডিসের সূত্রটা সহজ করে বুঝাও',
  'x² − 5x + 6 = 0 সমাধান করো',
  'সালোকসংশ্লেষণ কীভাবে ঘটে?',
] as const

const WELCOME_ID = 'welcome'

/** চ্যাট UI-এর ভেতরের বার্তা — MessageBubbleData + স্থায়ী লোকাল id */
type ChatMessage = MessageBubbleData & { id: string }

let localSeq = 0
function localId(prefix: string): string {
  localSeq += 1
  return `${prefix}-${Date.now()}-${localSeq}`
}

/** ApiError.data.credits → সরুভাবে যাচাই করে Credits বের করে */
function parseCredits(value: unknown): Credits | null {
  if (typeof value !== 'object' || value === null) return null
  const obj = value as Record<string, unknown>
  if (typeof obj.used === 'number' && typeof obj.limit === 'number') {
    return { used: obj.used, limit: obj.limit }
  }
  return null
}

function TypingDots({ note }: { note?: string | null }) {
  return (
    <div className="flex w-full justify-start">
      <div className="rounded-2xl rounded-bl-sm border border-emerald-100 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-1" aria-label="উত্তর লিখছে…">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-2 w-2 animate-bounce rounded-full bg-emerald-400"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
        {note && (
          <p className="mt-1.5 text-xs font-medium text-amber-600">{note}</p>
        )}
      </div>
    </div>
  )
}

function HistorySkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Skeleton className="h-10 w-48 rounded-2xl bg-stone-200/70" />
      </div>
      <div className="flex justify-start">
        <Skeleton className="h-24 w-full max-w-md rounded-2xl bg-stone-200/70" />
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-10 w-64 rounded-2xl bg-stone-200/70" />
      </div>
    </div>
  )
}

export function ChatView({ user, onLogout }: ChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [credits, setCredits] = useState<Credits>({ used: 0, limit: 30 })
  const [input, setInput] = useState('')
  const [subject, setSubject] = useState<string>(ALL_SUBJECTS)
  const [loading, setLoading] = useState(false)
  const [listening, setListening] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)
  const [sttOk, setSttOk] = useState(false)

  const bottomRef = useRef<HTMLDivElement | null>(null)
  const listenRef = useRef<{ stop: () => void } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // ইতিহাস + প্রাথমিক ক্রেডিট + STT সাপোর্ট যাচাই
  useEffect(() => {
    let alive = true

    setSttOk(isSttSupported())

    ;(async () => {
      try {
        const me = await api<{ credits?: Credits }>('/api/auth/me')
        if (alive && me.credits) setCredits(me.credits)
      } catch {
        // ক্রেডিট আনতে না পারলে ডিফল্ট থাকবে; চ্যাটের রেসপনসে ঠিক হয়ে যাবে
      }
      try {
        const data = await api<{ messages: HistoryMessage[] }>('/api/chat/history')
        if (!alive) return
        const list: ChatMessage[] = []
        for (const m of data.messages) {
          list.push({ id: `q-${m.id}`, role: 'user', text: m.question })
          if (m.answer) {
            list.push({
              id: `a-${m.id}`,
              role: 'tutor',
              text: m.answer,
              references: m.references ?? undefined,
            })
          }
        }
        if (list.length === 0) list.push({ id: WELCOME_ID, role: 'tutor', text: WELCOME_TEXT })
        setMessages(list)
      } catch {
        if (alive) setMessages([{ id: WELCOME_ID, role: 'tutor', text: WELCOME_TEXT }])
      } finally {
        if (alive) setHistoryLoading(false)
      }
    })()

    return () => {
      alive = false
      listenRef.current?.stop()
      stopSpeaking()
    }
  }, [])

  // নতুন বার্তা যোগ হলে মসৃণভাবে একদম নিচে
  useEffect(() => {
    if (!historyLoading) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, historyLoading])

  const remaining = Math.max(0, credits.limit - credits.used)

  // ইঞ্জিন ব্যস্ত হলে সাইলেন্ট অটো-রিট্রাই (স্টুডেন্ট কখনো টেকনিক্যাল এরর দেখবে না)
  const [engineBusy, setEngineBusy] = useState(false)
  // ৪ পর্যন্ত নিঃশব্দ রিট্রাই (~২৮ সেকেন্ড অপেক্ষা) + প্রতিটা চেষ্টায় ব্যাকএন্ড নিজেই ৫ পাস কিউ করে —
  // দুই স্তরের queue মিলে ব্যস্ত-এরর দেখানো প্রায় অসম্ভব করে দেয়
  const BUSY_WAITS = [3000, 5000, 8000, 12000]
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  const send = async (raw: string) => {
    const text = raw.trim()
    if (!text || loading || historyLoading) return

    setInput('')
    setMicError(null)
    const userMsg: ChatMessage = { id: localId('u'), role: 'user', text }
    const placeholderId = localId('p')
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: placeholderId, role: 'tutor', text: '' },
    ])
    setLoading(true)

    try {
      const body: { question: string; subject?: string } = { question: text }
      if (subject !== ALL_SUBJECTS) body.subject = subject

      // ব্যস্ত (503/429) হলে নিঃশব্দে আবার চেষ্টা — queue-র মতো, এরর দেখায় না
      let data: ChatApiResponse | null = null
      for (let attempt = 0; ; attempt++) {
        try {
          data = await api<ChatApiResponse>('/api/chat', { method: 'POST', body })
          break
        } catch (retryErr) {
          const busy =
            retryErr instanceof ApiError &&
            retryErr.code !== 'NO_KEYS' && // সেটআপ-এরর হলে লাইনে দাঁড়ানোর মানে নেই
            (retryErr.status === 503 || retryErr.status === 429 || retryErr.status === 502)
          if (busy && attempt < BUSY_WAITS.length) {
            setEngineBusy(true)
            await sleep(BUSY_WAITS[attempt])
            continue
          }
          throw retryErr
        }
      }
      setEngineBusy(false)

      if (data) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === placeholderId
              ? {
                  id: localId('a'),
                  role: 'tutor',
                  text: data.answer,
                  references:
                    data.references && data.references.length > 0
                      ? data.references
                      : undefined,
                }
              : m,
          ),
        )
        setCredits(data.credits)
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NO_CREDITS') {
        const fromError = parseCredits(err.data?.credits)
        if (fromError) setCredits(fromError)
        const nextLimit = fromError?.limit ?? 30
        setMessages((prev) =>
          prev.map((m) =>
            m.id === placeholderId
              ? {
                  id: localId('s'),
                  role: 'system',
                  text: `${err.message}\n\n🌙 কাল রাত ১২টায় আবার ${toBn(nextLimit)}টি প্রশ্ন যোগ হয়ে যাবে!`,
                }
              : m,
          ),
        )
      } else if (err instanceof ApiError && err.code === 'NO_KEYS') {
        // ইঞ্জিন সেটআপ হয়নি — অ্যাডমিনের জন্য পরিষ্কার নির্দেশনা (এটা এরর না, সেটআপ-নোটিশ)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === placeholderId
              ? { id: localId('s'), role: 'system', text: err.message }
              : m,
          ),
        )
      } else {
        // টেকনিক্যাল এরর কখনো দেখাবে না — সবসময় বন্ধুত্বপূর্ণ বার্তা
        setMessages((prev) =>
          prev.map((m) =>
            m.id === placeholderId
              ? {
                  id: localId('s'),
                  role: 'system',
                  text: 'এখন টিউটর ইঞ্জিনগুলো একটু ব্যস্ত আছে 😅 কয়েক সেকেন্ড পর আবার একই প্রশ্ন পাঠাও — তখনই উত্তর পাবে! 🙏',
                }
              : m,
          ),
        )
      }
    } finally {
      setEngineBusy(false)
      setLoading(false)
    }
  }

  const toggleMic = () => {
    if (listening) {
      listenRef.current?.stop()
      listenRef.current = null
      setListening(false)
      return
    }
    setMicError(null)
    const handle = startListening({
      onResult: (text) => {
        setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text))
        textareaRef.current?.focus()
      },
      onError: (msg) => {
        setMicError(msg)
        setListening(false)
      },
      onEnd: () => setListening(false),
    })
    if (handle) {
      listenRef.current = handle
      setListening(true)
    } else {
      setMicError('এই ব্রাউজারে ভয়েস ইনপুট সাপোর্ট করে না।')
    }
  }

  const handleLogout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await api<{ ok: boolean }>('/api/auth/logout', { method: 'POST' })
    } catch {
      // সেশন ইতিমধ্যে শেষ থাকলেও লগআউট UI চলবে
    }
    onLogout()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send(input)
    }
  }

  const showSuggestions =
    !historyLoading && messages.length === 1 && messages[0]?.id === WELCOME_ID

  return (
    <div className="flex h-dvh flex-col bg-stone-50">
      {/* হেডার */}
      <header className="sticky top-0 z-20 border-b border-emerald-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-2 px-3 py-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600">
            <GraduationCap className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight text-stone-900">
              Z-AI টিউটর
            </p>
            <p className="hidden truncate text-xs text-stone-500 sm:block">
              {user.name}
            </p>
          </div>

          <div className="ms-auto flex items-center gap-2">
            <Badge
              variant="outline"
              className="border-emerald-200 bg-emerald-50 text-emerald-800"
            >
              {credits.limit === 0
                ? 'অ্যাডমিন ∞'
                : `আজ: ${toBn(remaining)}/${toBn(credits.limit)} প্রশ্ন বাকি`}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              disabled={loggingOut}
              aria-label="লগআউট"
              className="h-11 w-11 text-stone-500 hover:bg-rose-50 hover:text-rose-600"
            >
              {loggingOut ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <LogOut className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>

        {/* বিষয় নির্বাচন */}
        <div className="mx-auto flex w-full max-w-4xl items-center gap-2 px-3 pb-2">
          <Label htmlFor="subject-select" className="shrink-0 text-xs text-stone-500">
            বিষয়
          </Label>
          <Select value={subject} onValueChange={setSubject}>
            <SelectTrigger
              id="subject-select"
              size="sm"
              className="h-9 w-[150px] rounded-full border-stone-200 bg-white text-xs sm:w-[200px] sm:text-sm"
            >
              <SelectValue placeholder="বিষয় বাছো" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SUBJECTS}>{ALL_SUBJECTS}</SelectItem>
              {SUBJECTS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      {/* মেসেজ এরিয়া */}
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl space-y-4 px-3 py-4">
          {historyLoading ? (
            <HistorySkeleton />
          ) : (
            messages
              .filter((m) => m.text.trim() !== '') // ফাঁকা প্লেসহোল্ডার বাদ — নিচে TypingDots-ই দেখায়
              .map((m) => <MessageBubble key={m.id} message={m} />)
          )}

          {loading && (
            <div className="max-w-2xl">
              <TypingDots
                note={engineBusy ? 'ইঞ্জিন একটু ব্যস্ত — লাইনে অপেক্ষা করছি…' : null}
              />
            </div>
          )}

          {showSuggestions && (
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              {SUGGESTIONS.map((s) => (
                <Button
                  key={s}
                  variant="outline"
                  onClick={() => void send(s)}
                  className="h-10 rounded-full border-emerald-200 bg-white text-sm text-emerald-800 hover:bg-emerald-50 hover:text-emerald-900"
                >
                  {s}
                </Button>
              ))}
            </div>
          )}

          <div ref={bottomRef} aria-hidden="true" />
        </div>
      </main>

      {/* ইনপুট বার */}
      <footer className="sticky bottom-0 z-20 border-t border-emerald-100 bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-4xl px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {micError && (
            <p className="px-1 pb-1 text-xs text-rose-600">{micError}</p>
          )}
          {listening && (
            <p className="flex items-center gap-1.5 px-1 pb-1 text-xs text-rose-600">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
              </span>
              শুনছি… এখন প্রশ্নটা বলো
            </p>
          )}
          <div className="flex items-end gap-2">
            {sttOk && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={toggleMic}
                aria-label={listening ? 'শোনা বন্ধ করো' : 'মুখে প্রশ্ন বলো'}
                className={
                  listening
                    ? 'h-11 w-11 shrink-0 animate-pulse rounded-full border-rose-500 bg-rose-600 text-white hover:bg-rose-600 hover:text-white'
                    : 'h-11 w-11 shrink-0 rounded-full border-stone-200 text-stone-600 hover:bg-stone-50'
                }
              >
                <Mic className="h-5 w-5" />
              </Button>
            )}
            <Textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="প্রশ্ন লেখো… (যেমন: সালোকসংশ্লেষণ কী?)"
              aria-label="তোমার প্রশ্ন"
              className="max-h-28 min-h-11 flex-1 resize-none rounded-2xl border-stone-200 bg-white px-3 py-2.5 text-[15px] focus-visible:ring-emerald-500/30"
            />
            <Button
              type="button"
              size="icon"
              onClick={() => void send(input)}
              disabled={loading || !input.trim()}
              aria-label="প্রশ্ন পাঠাও"
              className="h-11 w-11 shrink-0 rounded-full bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <SendHorizonal className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </footer>
    </div>
  )
}
