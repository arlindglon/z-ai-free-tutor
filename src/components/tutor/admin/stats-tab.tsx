'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  BarChart3,
  CheckCircle2,
  Database,
  HelpCircle,
  KeyRound,
  Loader2,
  MessageSquare,
  RefreshCw,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { api, ApiError } from '@/lib/api'
import { toBn } from '@/lib/bn'
import type { StatsInfo } from '@/lib/types'

const REFRESH_MS = 30_000

export function StatsTab() {
  const [stats, setStats] = useState<StatsInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const loadStats = useCallback(async () => {
    setRefreshing(true)
    try {
      const data = await api<StatsInfo>('/api/admin/stats')
      setStats(data)
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'পরিসংখ্যান আনা গেল না, আবার চেষ্টা করো।')
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void loadStats()
    const interval = setInterval(() => void loadStats(), REFRESH_MS)
    return () => clearInterval(interval)
  }, [loadStats])

  const cards: { label: string; icon: LucideIcon; value: string }[] = stats
    ? [
        { label: 'মোট শিক্ষার্থী', icon: Users, value: toBn(stats.users) },
        { label: 'আজকের প্রশ্ন', icon: MessageSquare, value: toBn(stats.questionsToday) },
        { label: 'মোট প্রশ্ন', icon: HelpCircle, value: toBn(stats.totalQuestions) },
        { label: 'মোট চাঙ্ক', icon: Database, value: toBn(stats.totalChunks) },
        { label: 'এমবেডেড চাঙ্ক', icon: CheckCircle2, value: toBn(stats.embeddedChunks) },
        {
          label: 'সক্রিয় কী',
          icon: KeyRound,
          value: `${toBn(stats.activeKeys)}/${toBn(stats.totalKeys)}`,
        },
      ]
    : []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100">
            <BarChart3 className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <h2 className="font-semibold text-stone-900">পরিসংখ্যান</h2>
            <p className="text-xs text-stone-500">প্রতি ৩০ সেকেন্ডে অটো-আপডেট হয়</p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => void loadStats()}
          disabled={refreshing}
          className="h-11 border-emerald-200 bg-white px-4 text-emerald-700 shadow-sm hover:bg-emerald-50"
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          রিফ্রেশ
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="rounded-2xl border-rose-200 bg-rose-50">
          <AlertDescription className="text-rose-700">{error}</AlertDescription>
        </Alert>
      )}

      {stats === null && !error ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-2xl bg-emerald-50" />
          ))}
        </div>
      ) : stats !== null ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {cards.map((c) => (
            <Card
              key={c.label}
              className="rounded-2xl border-emerald-100 bg-white py-0 shadow-sm transition-shadow hover:shadow-md"
            >
              <CardContent className="flex flex-col gap-2 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100">
                  <c.icon className="h-5 w-5 text-emerald-600" />
                </div>
                <p className="text-2xl font-bold tabular-nums text-stone-900">{c.value}</p>
                <p className="text-xs text-stone-500">{c.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  )
}
