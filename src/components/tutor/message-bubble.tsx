'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import { BookOpen, ChevronDown, Square, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toBn } from '@/lib/bn'
import { isTtsSupported, speakBengali, stopSpeaking } from '@/lib/speech'
import type { BookReference } from '@/lib/types'
import 'katex/dist/katex.min.css'

export interface MessageBubbleData {
  role: 'user' | 'tutor' | 'system'
  text: string
  references?: BookReference[]
  /** উত্তরের স্বাক্ষর — ইঞ্জিনের পুল থেকে র‍্যান্ডম নাম/কোড */
  answerTag?: string
  /** ⚡ ক্যাশ-হিট — রিপিট প্রশ্ন, ইঞ্জিন-কল হয়নি */
  cached?: boolean
  /** 📸 ইউজারের পাঠানো ছবি (data URL — শুধু লাইভ বার্তায়, হিস্ট্রিতে সেভ হয় না) */
  image?: string
}

export interface MessageBubbleProps {
  message: MessageBubbleData
}

/** React-children থেকে শুধু টেক্সট টেনে আনা (কোড-ব্লকের ভেতরের raw কোড) */
function extractText(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (React.isValidElement(node)) {
    return extractText((node.props as { children?: unknown }).children)
  }
  return ''
}

/** মডেল-তৈরি SVG-এর সেনিটাইজেশন — স্ক্রিপ্ট/ইভেন্ট-হ্যান্ডলার/এক্সটার্নাল-ছবি সরাও */
function sanitizeSvg(code: string): string {
  return code
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/<image[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '')
}

/** 🎨 SVG ছবি — একই chat request-এ LLM নিজেই আঁকল; শূন্য অতিরিক্ত খরচ */
function SvgBlock({ code }: { code: string }) {
  const html = useMemo(() => sanitizeSvg(code), [code])
  return (
    <div className="my-2 overflow-x-auto rounded-xl border border-stone-200 bg-white p-2">
      <div
        className="min-w-[220px] [&>svg]:h-auto [&>svg]:max-w-full"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}

/** মডেল-তৈরি mermaid-এর সবচেয়ে সাধারণ ভাঙা-সিনট্যাক্স রিপেয়ার:
 *  ব্র্যাকেট-লেবেলের ভেতরে প্যারেন্থেসিস/ব্রেস থাকলে mermaid পার্স-ফেল করে
 *  (যেমন A[বাষ্পীভবন (Evaporation)]) — লেবেলটা ডাবল-কোটে মুড়িয়ে দিলে চলে:
 *  A[বাষ্পীভবন (Evaporation)] → A["বাষ্পীভবন (Evaporation)"]
 *  (mermaid v12-তে সিঙ্গেল-কোট লেবেল চলে না — ডাবল-কোটই সঠিক সিনট্যাক্স) */
function repairMermaid(code: string): string {
  return code
    .split('\n')
    .map((line) =>
      line.replace(
        /\[([^\]"]*[(){}][^\]"]*)\]/g,
        (_m, inner: string) => `["${inner.replace(/"/g, '\u2019')}"]`
      )
    )
    .join('\n')
}

/** 🎨 Mermaid ডায়াগ্রাম — ক্লায়েন্ট-লাইব্রেরি রেন্ডার করে (dymanic import — বান্ডল ভারী হয় না) */
function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { default: mermaid } = await import('mermaid')
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'neutral',
          fontFamily: 'inherit',
        })
        const id = `mmd-${Math.random().toString(36).slice(2)}`
        // আগে রিপেয়ার-করা কোড, ফেল করলে মূল কোড — দুইবার সুযোগ
        let rendered: string
        try {
          ;({ svg: rendered } = await mermaid.render(id, repairMermaid(code)))
        } catch {
          ;({ svg: rendered } = await mermaid.render(`${id}-raw`, code))
        }
        if (alive) setSvg(rendered)
      } catch {
        if (alive) setFailed(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [code])

  if (failed) {
    return (
      <pre className="my-2 overflow-x-auto rounded-lg bg-stone-900 p-3 text-sm text-stone-100">
        <code>{code}</code>
      </pre>
    )
  }
  if (!svg) {
    return (
      <div className="my-2 rounded-xl border border-emerald-100 bg-emerald-50/50 px-3 py-2 text-xs text-emerald-700">
        ছবি এঁকে হচ্ছে…
      </div>
    )
  }
  return (
    <div
      className="my-2 overflow-x-auto rounded-xl border border-stone-200 bg-white p-3 [&>svg]:h-auto [&>svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

/** মার্কডাউন → স্টাইলড এলিমেন্ট (KaTeX-সহ)। মডিউল লেভেলে একবারই তৈরি। */
const markdownComponents: Components = {
  p: ({ children }) => <p className="mb-2 leading-relaxed last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal pl-5">{children}</ol>,
  li: ({ children }) => <li className="mb-1">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-emerald-900">{children}</strong>
  ),
  code: ({ className, children }) => {
    const raw = String(children ?? '')
    const isBlock =
      (typeof className === 'string' && className.includes('language-')) ||
      raw.includes('\n')
    if (isBlock) {
      return <code className="font-mono text-[0.875em]">{children}</code>
    }
    return (
      <code className="rounded bg-stone-100 px-1 py-0.5 font-mono text-[0.875em]">
        {children}
      </code>
    )
  },
  pre: ({ children }) => {
    // 🎨 ডায়াগ্রাম-কোড ব্লক (```svg / ```mermaid) → আসল ছবি রেন্ডার — কোড-বাক্স নয়
    const child = Array.isArray(children) ? children[0] : children
    if (React.isValidElement(child)) {
      const cls = (child.props as { className?: unknown }).className
      const lang = typeof cls === 'string' ? cls : ''
      const raw = extractText((child.props as { children?: unknown }).children)
      if (lang.includes('language-svg') && raw.trim()) return <SvgBlock code={raw} />
      if (lang.includes('language-mermaid') && raw.trim()) return <MermaidBlock code={raw} />
    }
    return (
      <pre className="my-2 overflow-x-auto rounded-lg bg-stone-900 p-3 text-sm text-stone-100">
        {children}
      </pre>
    )
  },
  h1: ({ children }) => <h1 className="mb-1 mt-3 text-lg font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1 mt-3 text-lg font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-3 text-base font-semibold">{children}</h3>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-emerald-700 underline"
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-stone-200 bg-stone-50 px-2 py-1 text-start font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-stone-200 px-2 py-1 align-top">{children}</td>
  ),
}

/** শেয়ার্ড মার্কডাউন রেন্ডারার — উত্তর ও বইয়ের রেফারেন্স দুটোতেই ব্যবহৃত।
 *  remark-gfm: টেবিল/স্ট্রাইক রেন্ডার; remark-math + KaTeX: $P^{H}$ জাতীয় ম্যাথ সুন্দর দেখায়। */
function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={markdownComponents}
    >
      {children}
    </ReactMarkdown>
  )
}

function ReferenceChips({ references }: { references: BookReference[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  // ডিডুপ: একই বই+অধ্যায়+পৃষ্ঠার একাধিক রেফারেন্স = একটাই চিপ।
  // পুরনো হিস্ট্রির সারিতে ডুপ্লিকেট থাকলেও রেন্ডার পরিষ্কার থাকবে।
  const uniqueRefs = references.filter((r, i) => {
    return (
      references.findIndex(
        (o) => o.book === r.book && o.chapter === r.chapter && (o.page ?? null) === (r.page ?? null)
      ) === i
    )
  })
  if (uniqueRefs.length === 0) return null
  const open = openIdx !== null ? uniqueRefs[openIdx] : null
  return (
    <div className="mt-2 flex w-full flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {uniqueRefs.map((ref, i) => {
          const isOpen = openIdx === i
          return (
            <button
              key={`${ref.book}-${ref.chapter}-${i}`}
              type="button"
              onClick={() => setOpenIdx(isOpen ? null : i)}
              aria-expanded={isOpen}
              title="বইয়ের অংশটা দেখো"
              className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                isOpen
                  ? 'border-amber-300 bg-amber-100 text-amber-900'
                  : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
              }`}
            >
              <BookOpen className="h-3 w-3 shrink-0" />
              {ref.book} • {ref.chapter}
              {ref.page !== null && ref.page !== undefined ? ` • পৃষ্ঠা ${toBn(ref.page)}` : ''}
              {ref.content ? (
                <ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              ) : null}
            </button>
          )
        })}
      </div>
      {open?.content ? (
        <div className="w-full overflow-x-auto rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-stone-800">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
            📖 বইয়ের অংশ — {open.chapter}
            {open.page !== null && open.page !== undefined ? ` (পৃষ্ঠা ${toBn(open.page)})` : ''}
          </p>
          <Markdown>{open.content}</Markdown>
        </div>
      ) : null}
    </div>
  )
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const [speaking, setSpeaking] = useState(false)

  // কম্পোনেন্ট ভেঙে গেলে চলমান পড়া বন্ধ
  useEffect(() => {
    return () => stopSpeaking()
  }, [])

  const fade = {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.22, ease: 'easeOut' as const },
  }

  if (message.role === 'user') {
    return (
      <motion.div {...fade} className="flex w-full justify-end">
        <div className="max-w-[85%]">
          {message.image && (
            <img
              src={message.image}
              alt="শিক্ষার্থীর পাঠানো ছবি"
              className="mb-1.5 ml-auto max-h-56 rounded-2xl rounded-br-sm border border-emerald-200 object-cover shadow-sm"
            />
          )}
          {message.text.trim() !== '' && (
            <div className="whitespace-pre-wrap rounded-2xl rounded-br-sm bg-emerald-600 px-4 py-2.5 text-[15px] leading-relaxed text-white shadow-sm">
              {message.text}
            </div>
          )}
        </div>
      </motion.div>
    )
  }

  if (message.role === 'system') {
    return (
      <motion.div {...fade} className="flex w-full justify-center">
        <div className="max-w-md rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
          {message.text}
        </div>
      </motion.div>
    )
  }

  const handleSpeak = () => {
    if (speaking) {
      stopSpeaking()
      setSpeaking(false)
      return
    }
    if (!isTtsSupported()) return
    speakBengali(message.text, () => setSpeaking(false))
    setSpeaking(true)
  }

  // লোডিং প্লেসহোল্ডার (টেক্সট ফাঁকা) — শুধু টাইপিং ডটস, ফাঁকা বাবল নয়
  if (!message.text.trim()) {
    return (
      <motion.div {...fade} className="flex w-full justify-start">
        <div
          className="rounded-2xl rounded-bl-sm border border-emerald-100 bg-white px-4 py-3 shadow-sm"
          aria-label="উত্তর লিখছে…"
        >
          <div className="flex items-center gap-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-2 w-2 animate-bounce rounded-full bg-emerald-400"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </div>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div {...fade} className="flex w-full justify-start">
      <div className="flex max-w-[92%] flex-col items-start sm:max-w-[85%]">
        <div className="overflow-x-auto rounded-2xl rounded-bl-sm border border-emerald-100 bg-white px-4 py-3 text-[15px] text-stone-800 shadow-sm">
          <Markdown>{message.text}</Markdown>
        </div>
        <ReferenceChips references={message.references ?? []} />
        <div className="mt-2 flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleSpeak}
            aria-label={speaking ? 'পড়া বন্ধ করো' : 'উত্তর পড়ে শোনাও'}
            className="h-9 w-9 rounded-full border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
          >
            {speaking ? <Square className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </Button>
          {/* ⚡ ক্যাশ-হিট — রিপিট প্রশ্ন: তাৎক্ষণিক + ইঞ্জিন-খরচ শূন্য */}
          {message.cached && (
            <span
              title="ক্যাশ থেকে তাৎক্ষণিক উত্তর — আজকের কোটা বাঁচলো!"
              className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700"
            >
              ⚡ ক্যাশ — তাৎক্ষণিক
            </span>
          )}
          {/* স্বাক্ষর — অ্যাডমিন পুল থেকে র‍্যান্ডম নাম/কোড; স্টুডেন্টের কাছে রহস্যময় সাইন, অ্যাডমিন বুঝবে কোন ইঞ্জিন */}
          {message.answerTag && (
            <span
              title="উত্তর স্বাক্ষর"
              className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-0.5 font-mono text-[11px] text-stone-400"
            >
              ✍ {message.answerTag}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  )
}
