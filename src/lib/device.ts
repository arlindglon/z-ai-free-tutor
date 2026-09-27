/**
 * ডিভাইস ফিঙ্গারপ্রিন্ট — এক ডিভাইসে এক একাউন্ট নিশ্চিত করতে ব্যবহৃত স্থিতিশীল হ্যাশ।
 * সিগন্যালস: UA, ভাষা, CPU কোর, স্ক্রিন, DPR, টাইমজোন, ক্যানভাস রেন্ডার, WebGL রেন্ডারার।
 * মেমোইজড: মডিউল ভ্যারিয়েবল + localStorage ('zai_device_hash')।
 */

const STORAGE_KEY = 'zai_device_hash'

let memoizedHash: string | null = null

/** প্রধান এন্ট্রি — ক্যাশ থাকলে সেটাই, নাহলে নতুন করে হিসাব করে ক্যাশ করে। */
export async function getDeviceHash(): Promise<string> {
  if (memoizedHash) return memoizedHash
  if (typeof window === 'undefined') return ''

  try {
    const cached = window.localStorage.getItem(STORAGE_KEY)
    if (cached && /^[0-9a-f]{64}$/.test(cached)) {
      memoizedHash = cached
      return cached
    }
  } catch {
    // localStorage বন্ধ থাকলেও হ্যাশ হিসাব চলবে
  }

  const raw = collectSignals()
  const hash = await sha256Hex(raw).catch(() => fnv1aHex(raw))
  memoizedHash = hash

  try {
    window.localStorage.setItem(STORAGE_KEY, hash)
  } catch {
    // সেভ ব্যর্থ হলেও রিটার্ন করব — পরের বার আবার হিসাব হবে
  }
  return hash
}

/** সব সিগন্যাল একটি ডিটারমিনিস্টিক স্ট্রিং-এ জোড়া লাগায় (ক্রম কখনো বদলায় না)। */
function collectSignals(): string {
  const nav = window.navigator
  const parts: string[] = [
    nav.userAgent,
    nav.language,
    String(nav.hardwareConcurrency ?? 0),
    `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`,
    String(window.devicePixelRatio),
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'unknown-tz',
    canvasFingerprint(),
    webglFingerprint(),
  ]
  return parts.join('||')
}

/** ক্যানভাস 2D রেন্ডারিং পার্থক্য থেকে ফিঙ্গারপ্রিন্ট (বাংলা টেক্সট + রঙিন ব্লক)। */
function canvasFingerprint(): string {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 280
    canvas.height = 70
    const ctx = canvas.getContext('2d')
    if (!ctx) return 'canvas-unavailable'

    // রঙিন ব্লক — অ্যান্টি-অ্যালিয়াসিং/গামা পার্থক্য ধরার জন্য
    ctx.fillStyle = '#10b981' // emerald-500
    ctx.fillRect(0, 0, 280, 22)
    ctx.fillStyle = '#f59e0b' // amber-500
    ctx.fillRect(0, 22, 280, 22)
    ctx.fillStyle = '#57534e' // stone-600
    ctx.fillRect(0, 44, 280, 26)

    // বাংলা টেক্সট — ফন্ট রাস্টারাইজেশন ইঞ্জিনের সূক্ষ্ম পার্থক্য ধরে
    ctx.textBaseline = 'alphabetic'
    ctx.font = '17px "Noto Sans Bengali", "Hind Siliguri", Arial'
    ctx.fillStyle = '#064e3b'
    ctx.fillText('Z-AI-টিউটর-ফিঙ্গারপ্রিন্ট', 4, 34)
    ctx.fillStyle = 'rgba(120, 53, 15, 0.82)'
    ctx.fillText('Z-AI-টিউটর-ফিঙ্গারপ্রিন্ট', 7, 38)

    return canvas.toDataURL()
  } catch {
    return 'canvas-error'
  }
}

/** WebGL ভেন্ডর/রেন্ডারার (GPU) — WEBGL_debug_renderer_info থাকলে সেটি ব্যবহার করে। */
function webglFingerprint(): string {
  try {
    const canvas = document.createElement('canvas')
    const gl =
      (canvas.getContext('webgl') as WebGLRenderingContext | null) ??
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null)
    if (!gl) return 'webgl-unavailable'

    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const vendor = String(
      ext
        ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)
        : gl.getParameter(gl.VENDOR),
    )
    const renderer = String(
      ext
        ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
    )
    return `${vendor}~${renderer}`
  } catch {
    return 'webgl-error'
  }
}

/** SHA-256 → হেক্স। অনিরাপদ কনটেক্সটে (http) crypto.subtle না থাকলে throw করে। */
async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('crypto.subtle unavailable')
  }
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** ফলব্যাক: FNV-1a ৩২-বিট, ৮টি ভিন্ন স্যাল্টে চালিয়ে ৬৪-অক্ষরের হেক্স বানায়। */
function fnv1aHex(input: string): string {
  let out = ''
  for (let salt = 0; salt < 8; salt++) {
    let hash = (0x811c9dc5 ^ salt) >>> 0
    for (let i = 0; i < input.length; i++) {
      hash ^= (input.charCodeAt(i) + salt) & 0xffffffff
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    out += hash.toString(16).padStart(8, '0')
  }
  return out
}
