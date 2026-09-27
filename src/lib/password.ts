import crypto from 'crypto'

/** scrypt দিয়ে পাসওয়ার্ড হ্যাশ — salt:hash ফরম্যাট */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `s1:${salt}:${hash}`
}

/** টাইমিং-সেফ পাসওয়ার্ড যাচাই */
export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [, salt, hash] = stored.split(':')
    if (!salt || !hash) return false
    const test = crypto.scryptSync(password, salt, 64)
    const original = Buffer.from(hash, 'hex')
    return original.length === test.length && crypto.timingSafeEqual(original, test)
  } catch {
    return false
  }
}
