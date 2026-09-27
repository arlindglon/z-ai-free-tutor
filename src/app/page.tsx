'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { GraduationCap } from 'lucide-react'
import { api } from '@/lib/api'
import type { UserInfo } from '@/lib/types'
import { AuthView } from '@/components/tutor/auth-view'
import { ChatView } from '@/components/tutor/chat-view'
import { AdminView } from '@/components/tutor/admin/admin-view'

type Stage = 'loading' | 'guest' | 'ready'

export default function Home() {
  const [stage, setStage] = useState<Stage>('loading')
  const [user, setUser] = useState<UserInfo | null>(null)

  useEffect(() => {
    let alive = true
    api<{ user: UserInfo }>('/api/auth/me')
      .then((d) => {
        if (!alive) return
        setUser(d.user)
        setStage('ready')
      })
      .catch(() => {
        if (alive) setStage('guest')
      })
    return () => {
      alive = false
    }
  }, [])

  // ChatView নিজেই logout POST করে; AdminView করে না — তাই এখানে fire-and-forget নিরাপদ (ডুপ্লিকেট ক্ষতিকর নয়)
  const handleLogout = () => {
    api('/api/auth/logout', { method: 'POST' }).catch(() => {})
    setUser(null)
    setStage('guest')
  }

  return (
    <div className="min-h-dvh flex flex-col bg-gradient-to-b from-emerald-50 via-white to-amber-50/70">
      <main className="flex-1 flex flex-col">
        {stage === 'loading' && (
          <div className="flex min-h-dvh flex-col items-center justify-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600 shadow-lg shadow-emerald-600/20">
              <GraduationCap className="h-9 w-9 text-white" />
            </div>
            <p className="text-sm font-medium text-stone-500">Z-AI টিউটর চালু হচ্ছে…</p>
            <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
          </div>
        )}

        {stage === 'guest' && (
          <div className="flex flex-1 flex-col">
            <AuthView onSuccess={(u) => { setUser(u); setStage('ready') }} />
            <footer className="mt-auto border-t border-emerald-100 bg-white/80 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-center text-xs text-stone-500">
              <p className="font-medium text-stone-600">Z-AI ফ্রি প্রাইভেট টিউটর</p>
              <p className="mt-0.5">প্রতিটি শিক্ষার্থীর জন্য — জিরো খরচে, বই ভিত্তিক বুদ্ধিমান উত্তর 💚</p>
            </footer>
          </div>
        )}

        {stage === 'ready' && user && (
          user.role === 'admin'
            ? <AdminView user={user} onLogout={handleLogout} />
            : <ChatView user={user} onLogout={handleLogout} />
        )}
      </main>
    </div>
  )
}
