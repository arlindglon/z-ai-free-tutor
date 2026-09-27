'use client'

import { useEffect, useState } from 'react'
import {
  AlertCircle,
  BookOpen,
  GraduationCap,
  Loader2,
  Mic,
  ShieldCheck,
  Sigma,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, ApiError } from '@/lib/api'
import { getDeviceHash } from '@/lib/device'
import { toBn } from '@/lib/bn'
import type { Credits, UserInfo } from '@/lib/types'

export interface AuthViewProps {
  onSuccess: (user: UserInfo, credits: Credits) => void
}

type AuthResponse = { user: UserInfo; credits: Credits }

const FEATURES: { icon: LucideIcon; text: string }[] = [
  { icon: Zap, text: 'দিনে ৩০টি ফ্রি প্রশ্ন' },
  { icon: BookOpen, text: 'পাঠ্যবই থেকে রেফারেন্স' },
  { icon: Mic, text: 'মুখে বলো প্রশ্ন' },
  { icon: Sigma, text: 'ম্যাথ সমীকরণ ঝকঝকে রেন্ডার' },
]

const MIN_NAME = 2
const MIN_PASSWORD = 6

/** API এরর → বান্ধব বাংলা বার্তা */
function friendlyError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'DEVICE_EXISTS':
        return 'এই ডিভাইসে একটি একাউন্ট আছে — লগইন করো। এক ডিভাইসে শুধু একটি ফ্রি একাউন্ট!'
      case 'EMAIL_EXISTS':
        return 'এই ইমেইলে একাউন্ট আছে, লগইন ট্যাবে যাও।'
      case 'DEVICE_MISMATCH':
        return 'এই একাউন্ট অন্য ডিভাইসের সাথে বাঁধা — নিরাপত্তার জন্য সেখান থেকেই ব্যবহার করো।'
      default:
        return err.message
    }
  }
  return 'সমস্যা হয়েছে, আবার চেষ্টা করো।'
}

function ErrorAlert({ message }: { message: string }) {
  return (
    <Alert className="border-rose-200 bg-rose-50 text-rose-900 [&>svg]:text-rose-600">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription className="text-rose-800">{message}</AlertDescription>
    </Alert>
  )
}

export function AuthView({ onSuccess }: AuthViewProps) {
  const [deviceReady, setDeviceReady] = useState(false)
  const [tab, setTab] = useState<'login' | 'signup'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // মাউন্টে ডিভাইস হ্যাশ প্রস্তুত করা (মেমোইজড, পরে সাবমিটে তাৎক্ষণিক)
  useEffect(() => {
    let alive = true
    getDeviceHash()
      .catch(() => '')
      .finally(() => {
        if (alive) setDeviceReady(true)
      })
    return () => {
      alive = false
    }
  }, [])

  const switchTab = (value: string) => {
    setTab(value === 'signup' ? 'signup' : 'login')
    setError(null)
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setError(null)
    if (password.length < MIN_PASSWORD) {
      setError(`পাসওয়ার্ড কমপক্ষে ${toBn(MIN_PASSWORD)} অক্ষরের হতে হবে।`)
      return
    }
    setSubmitting(true)
    try {
      const data = await api<AuthResponse>('/api/auth/login', {
        method: 'POST',
        body: { email: email.trim(), password, deviceHash: await getDeviceHash() },
      })
      onSuccess(data.user, data.credits)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSubmitting(false)
    }
  }

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setError(null)
    if (name.trim().length < MIN_NAME) {
      setError(`নাম কমপক্ষে ${toBn(MIN_NAME)} অক্ষরের হতে হবে।`)
      return
    }
    if (password.length < MIN_PASSWORD) {
      setError(`পাসওয়ার্ড কমপক্ষে ${toBn(MIN_PASSWORD)} অক্ষরের হতে হবে।`)
      return
    }
    setSubmitting(true)
    try {
      const data = await api<AuthResponse>('/api/auth/signup', {
        method: 'POST',
        body: {
          name: name.trim(),
          email: email.trim(),
          password,
          deviceHash: await getDeviceHash(),
        },
      })
      onSuccess(data.user, data.credits)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-dvh w-full items-start justify-center px-4 py-8 sm:items-center">
      <div className="flex w-full max-w-md flex-col items-center">
        {/* হিরো */}
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-600 shadow-lg shadow-emerald-600/25">
            <GraduationCap className="h-9 w-9 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
            Z-AI ফ্রি প্রাইভেট টিউটর
          </h1>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-stone-600">
            বই ভিত্তিক উত্তর • ধাপে ধাপে সমাধান • বাংলা ভয়েস — সম্পূর্ণ ফ্রি
          </p>
          <div className="mt-3">
            {deviceReady ? (
              <Badge
                variant="outline"
                className="border-emerald-200 bg-emerald-50 text-emerald-800"
              >
                <ShieldCheck className="h-3 w-3" />
                ডিভাইস যাচাই সম্পন্ন
              </Badge>
            ) : (
              <Badge variant="outline" className="border-stone-200 text-stone-500">
                <Loader2 className="h-3 w-3 animate-spin" />
                ডিভাইস যাচাই হচ্ছে…
              </Badge>
            )}
          </div>
        </div>

        {/* ফিচার তালিকা */}
        <div className="mt-5 grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div
              key={f.text}
              className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-white px-3 py-2 text-sm text-stone-700 shadow-sm"
            >
              <f.icon className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>{f.text}</span>
            </div>
          ))}
        </div>

        {/* লগইন / সাইন-আপ কার্ড */}
        <Card className="mt-6 w-full rounded-2xl border-emerald-100 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg text-stone-900">শুরু করো</CardTitle>
            <CardDescription>লগইন করো, অথবা নতুন ফ্রি একাউন্ট খোলো</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={tab} onValueChange={switchTab}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">লগইন</TabsTrigger>
                <TabsTrigger value="signup">সাইন-আপ</TabsTrigger>
              </TabsList>

              {/* লগইন */}
              <TabsContent value="login">
                <form className="mt-2 space-y-4" onSubmit={handleLogin} noValidate>
                  <div className="space-y-1.5">
                    <Label htmlFor="login-email">ইমেইল</Label>
                    <Input
                      id="login-email"
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="tumi@example.com"
                      className="h-11 border-stone-200 focus-visible:ring-emerald-500/30"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="login-password">পাসওয়ার্ড</Label>
                    <Input
                      id="login-password"
                      type="password"
                      required
                      autoComplete="current-password"
                      placeholder="••••••"
                      className="h-11 border-stone-200 focus-visible:ring-emerald-500/30"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <p className="text-xs text-stone-500">
                      কমপক্ষে {toBn(MIN_PASSWORD)} অক্ষরের পাসওয়ার্ড দাও
                    </p>
                  </div>
                  {error && <ErrorAlert message={error} />}
                  <Button
                    type="submit"
                    disabled={submitting}
                    className="h-11 w-full rounded-xl bg-emerald-600 text-base text-white hover:bg-emerald-700"
                  >
                    {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    {submitting ? 'চলছে…' : 'লগইন করো'}
                  </Button>
                </form>
              </TabsContent>

              {/* সাইন-আপ */}
              <TabsContent value="signup">
                <form className="mt-2 space-y-4" onSubmit={handleSignup} noValidate>
                  <div className="space-y-1.5">
                    <Label htmlFor="signup-name">তোমার নাম</Label>
                    <Input
                      id="signup-name"
                      type="text"
                      required
                      autoComplete="name"
                      placeholder="যেমন: রাফিদ হাসান"
                      className="h-11 border-stone-200 focus-visible:ring-emerald-500/30"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                    <p className="text-xs text-stone-500">
                      কমপক্ষে {toBn(MIN_NAME)} অক্ষর — যেভাবে ডাকতে চাও
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="signup-email">ইমেইল</Label>
                    <Input
                      id="signup-email"
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="tumi@example.com"
                      className="h-11 border-stone-200 focus-visible:ring-emerald-500/30"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="signup-password">পাসওয়ার্ড</Label>
                    <Input
                      id="signup-password"
                      type="password"
                      required
                      autoComplete="new-password"
                      placeholder="••••••"
                      className="h-11 border-stone-200 focus-visible:ring-emerald-500/30"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <p className="text-xs text-stone-500">
                      কমপক্ষে {toBn(MIN_PASSWORD)} অক্ষরের পাসওয়ার্ড দাও
                    </p>
                  </div>
                  {error && <ErrorAlert message={error} />}
                  <Button
                    type="submit"
                    disabled={submitting}
                    className="h-11 w-full rounded-xl bg-emerald-600 text-base text-white hover:bg-emerald-700"
                  >
                    {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    {submitting ? 'চলছে…' : 'ফ্রি একাউন্ট খোলো'}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <p className="mt-4 max-w-sm text-center text-xs leading-relaxed text-stone-500">
          প্রতিটি ডিভাইসে শুধুমাত্র একটি ফ্রি একাউন্ট — নিষ্ক্রিয়তা রোধে ধন্যবাদ 🙏
        </p>
      </div>
    </div>
  )
}
