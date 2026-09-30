/**
 * 📸 ক্লায়েন্ট-সাইড ছবি-কম্প্রেশন — Canvas API (৫ লাইনের মতো, কোনো ডিপেন্ডেন্সি নেই)
 *
 * কেন: ফ্রি টিয়ারে লিমিট মূলত request-সংখ্যায়, তবে বড় ছবি ≈ ২৫৮–১২০০+ token খায়।
 * আপলোডের আগে ছবি 1024px + JPEG 80% করে নামালে token খরচ ~৭০% কমে,
 * আর Vercel-এর 4.5MB বডি-লিমিটও কখনো ধাক্কা খায় না।
 *
 * একই request pipeline — ছবি পাঠানো = ১টা request, টেক্সট পাঠানোও = ১টা request।
 */
export async function compressImage(
  file: File,
  maxSize = 1024,
  quality = 0.8
): Promise<string> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('IMG_LOAD_FAIL'))
      el.src = objectUrl
    })
    // লম্বা পাশ 1024px-এ নামো (আর ছোট হলে অক্ষত)
    const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('CANVAS_FAIL')
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', quality)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
