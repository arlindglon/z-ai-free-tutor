/**
 * বাংলা স্পিচ (STT + TTS) — Web Speech API-র সরু টাইপ শিমসহ, `any` ছাড়া।
 * STT: SpeechRecognition (webkit প্রিফিক্স ফলব্যাক), lang bn-BD।
 * TTS: speechSynthesis, বাংলা ভয়েস পেলে সেটি, নাহলে ডিফল্ট।
 */

/* ---------- সরু টাইপ শিম (lib.dom-এর গ্লোবাল নামের সাথে সংঘর্ষ এড়াতে `Like` প্রত্যয়) ---------- */

export interface SpeechRecognitionAlternativeLike {
  transcript: string
  confidence: number
}

export interface SpeechRecognitionResultLike {
  readonly length: number
  readonly isFinal: boolean
  [index: number]: SpeechRecognitionAlternativeLike
}

export interface SpeechRecognitionResultListLike {
  readonly length: number
  [index: number]: SpeechRecognitionResultLike
}

export interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultListLike
}

export interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string
  readonly message: string
}

export interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onaudiostart: (() => void) | null
  onstart: (() => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

interface SpeechWindow {
  SpeechRecognition?: SpeechRecognitionCtor
  webkitSpeechRecognition?: SpeechRecognitionCtor
}

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as SpeechWindow
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/* ---------- STT ---------- */

export function isSttSupported(): boolean {
  return getRecognitionCtor() !== null
}

export interface StartListeningOptions {
  onResult: (text: string) => void
  onError: (msg: string) => void
  onEnd: () => void
}

const STT_ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'মাইক্রোফোনের অনুমতি দেওয়া হয়নি — ব্রাউজার সেটিংস থেকে অনুমতি দাও।',
  'service-not-allowed': 'মাইক্রোফোন সার্ভিস ব্লক করা আছে — ব্রাউজার সেটিংস দেখো।',
  'no-speech': 'কোনো শব্দ ধরা পড়েনি — আবার চেষ্টা করো।',
  'audio-capture': 'মাইক্রোফোন পাওয়া যায়নি — ডিভাইসে মাইক আছে কিনা দেখো।',
  network: 'নেটওয়ার্ক সমস্যা — ভয়েস সার্ভিসে পৌঁছানো গেল না।',
  aborted: 'শোনা বন্ধ করা হয়েছে।',
}

/**
 * বাংলা (bn-BD) ভয়েস ইনপুট শুরু করে। ফাইনাল রেজাল্ট এলে onResult, ভুলে onError,
 * শেষ হলে onEnd ডাকে। রিটার্ন: stop() হ্যান্ডেল, সাপোর্ট না থাকলে null।
 */
export function startListening(opts: StartListeningOptions): { stop: () => void } | null {
  const Ctor = getRecognitionCtor()
  if (!Ctor) return null

  let rec: SpeechRecognitionLike
  try {
    rec = new Ctor()
  } catch {
    return null
  }

  let ended = false

  rec.lang = 'bn-BD'
  rec.continuous = false
  rec.interimResults = false
  rec.maxAlternatives = 1

  rec.onresult = (event: SpeechRecognitionEventLike) => {
    let text = ''
    for (let i = 0; i < event.results.length; i++) {
      const alt = event.results[i]?.[0]
      if (alt && typeof alt.transcript === 'string') text += alt.transcript
    }
    const clean = text.trim()
    if (clean) opts.onResult(clean)
  }

  rec.onerror = (event: SpeechRecognitionErrorEventLike) => {
    opts.onError(STT_ERROR_MESSAGES[event.error] ?? 'ভয়েস ইনপুটে সমস্যা হয়েছে, আবার চেষ্টা করো।')
  }

  rec.onend = () => {
    if (!ended) {
      ended = true
      opts.onEnd()
    }
  }

  try {
    rec.start()
  } catch {
    // start() ইতিমধ্যে চলমান সেশনে InvalidStateError দিতে পারে
    return null
  }

  return {
    stop: () => {
      try {
        rec.stop()
      } catch {
        // ইগনোর — সেশন হয়তো আগেই শেষ
      }
    },
  }
}

/* ---------- TTS ---------- */

export function isTtsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** উচ্চারণের আগে LaTeX ও মার্কডাউন চিহ্ন ছেঁটে ফেলে — স্পিকারে শুধু পরিষ্কার কথা যায়। */
function stripForSpeech(text: string): string {
  return text
    .replace(/\$\$[\s\S]*?\$\$/g, ' ') // ডিসপ্লে ম্যাথ $$..$$
    .replace(/\$[^$\n]+\$/g, ' ') // ইনলাইন ম্যাথ $..$
    .replace(/```[\s\S]*?```/g, ' ') // কোড ব্লক
    .replace(/`([^`]+)`/g, '$1') // ইনলাইন কোড → শুধু ভেতরের লেখা
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // ইমেজ → অল্ট টেক্সট
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // লিংক → শুধু লেবেল
    .replace(/^#{1,6}\s+/gm, '') // হেডিং #
    .replace(/^\s*>\s?/gm, '') // ব্লককোট >
    .replace(/\|/g, ' ') // টেবিল |
    .replace(/(\*\*|\*|__|_|~~)/g, '') // ইমফ্যাসিস চিহ্ন
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function pickBengaliVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  const bn = voices.find((v) => v.lang.toLowerCase().startsWith('bn'))
  return bn ?? null
}

/**
 * বাংলায় পড়ে শোনায় (rate 0.95, lang bn-BD, বাংলা ভয়েস পেলে সেটি)।
 * ঐচ্ছিক onEnd: পড়া শেষ/বাতিল হলে ডাকে — UI-তে স্পিকিং স্টেট ট্র্যাক করতে কাজে লাগে।
 */
export function speakBengali(text: string, onEnd?: () => void): void {
  if (!isTtsSupported()) {
    onEnd?.()
    return
  }
  const synth = window.speechSynthesis
  synth.cancel() // চলমান পড়া থাকলে বন্ধ করে নতুনটা শুরু

  const clean = stripForSpeech(text)
  if (!clean) {
    onEnd?.()
    return
  }

  const utter = new SpeechSynthesisUtterance(clean)
  utter.lang = 'bn-BD'
  utter.rate = 0.95
  const voice = pickBengaliVoice()
  if (voice) utter.voice = voice
  utter.onend = () => onEnd?.()
  utter.onerror = () => onEnd?.()
  synth.speak(utter)
}

export function stopSpeaking(): void {
  if (isTtsSupported()) window.speechSynthesis.cancel()
}
