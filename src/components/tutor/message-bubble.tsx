'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { BookOpen, Square, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toBn } from '@/lib/bn'
import { isTtsSupported, speakBengali, stopSpeaking } from '@/lib/speech'
import type { BookReference } from '@/lib/types'
import 'katex/dist/katex.min.css'

export interface MessageBubbleData {
  role: 'user' | 'tutor' | 'system'
  text: string
  references?: BookReference[]
}

export interface MessageBubbleProps {
  message: MessageBubbleData
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
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-stone-900 p-3 text-sm text-stone-100">
      {children}
    </pre>
  ),
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

function ReferenceChips({ references }: { references: BookReference[] }) {
  if (references.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {references.map((ref, i) => (
        <span
          key={`${ref.book}-${ref.chapter}-${i}`}
          className="flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-800"
        >
          <BookOpen className="h-3 w-3 shrink-0" />
          {ref.book} • {ref.chapter}
          {ref.page !== null && ref.page !== undefined
            ? ` • পৃষ্ঠা ${toBn(ref.page)}`
            : ''}
        </span>
      ))}
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
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-emerald-600 px-4 py-2.5 text-[15px] leading-relaxed text-white shadow-sm">
          {message.text}
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
          {/* ReactMarkdown-এর ভেতরের কনটেন্ট আমরাই স্টাইল করি; disableWarnings দরকার নেই */}
          <ReactMarkdown
            remarkPlugins={[remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={markdownComponents}
          >
            {message.text}
          </ReactMarkdown>
        </div>
        <ReferenceChips references={message.references ?? []} />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={handleSpeak}
          aria-label={speaking ? 'পড়া বন্ধ করো' : 'উত্তর পড়ে শোনাও'}
          className="mt-2 h-9 w-9 rounded-full border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
        >
          {speaking ? <Square className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </Button>
      </div>
    </motion.div>
  )
}
