/** ক্লায়েন্ট-সাইড API হেল্পার — সব fetch এর মাধ্যমে যায়, এররে বাংলা মেসেজসহ */

export class ApiError extends Error {
  status: number
  code?: string
  data: Record<string, unknown>

  constructor(message: string, status: number, code?: string, data?: Record<string, unknown>) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.data = data ?? {}
  }
}

export async function api<T>(
  path: string,
  options?: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown }
): Promise<T> {
  const res = await fetch(path, {
    method: options?.method ?? 'GET',
    headers: options?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
    cache: 'no-store',
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const message = typeof data?.error === 'string' && data.error ? data.error : 'সমস্যা হয়েছে, আবার চেষ্টা করো।'
    throw new ApiError(message, res.status, typeof data?.code === 'string' ? data.code : undefined, data)
  }
  return data as T
}
