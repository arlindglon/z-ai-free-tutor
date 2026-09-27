'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { api, ApiError } from '@/lib/api'
import type { SettingsInfo } from '@/lib/types'

const SUCCESS_HIDE_MS = 4000

export function SettingsTab() {
  const [chatModel, setChatModel] = useState('')
  const [embeddingModel, setEmbeddingModel] = useState('')
  const [dailyCredits, setDailyCredits] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadSettings = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api<{ settings: SettingsInfo }>('/api/admin/settings')
      setChatModel(data.settings.chatModel)
      setEmbeddingModel(data.settings.embeddingModel)
      setDailyCredits(String(data.settings.dailyCredits))
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'সেটিংস আনা গেল না, আবার চেষ্টা করো।')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSettings()
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [loadSettings])

  function markEdited() {
    setSaved(false)
    setError(null)
    if (hideTimer.current) {
      clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
  }

  async function handleSave() {
    if (saving) return
    setError(null)
    const credits = Number(dailyCredits)
    if (!Number.isFinite(credits) || credits <= 0) {
      setError('দৈনিক প্রশ্ন কোটা সঠিক পজিটিভ সংখ্যা দাও (১–১০০০)।')
      return
    }
    setSaving(true)
    try {
      const data = await api<{ settings: SettingsInfo }>('/api/admin/settings', {
        method: 'PUT',
        body: {
          chatModel: chatModel.trim(),
          embeddingModel: embeddingModel.trim(),
          dailyCredits: credits,
        },
      })
      setChatModel(data.settings.chatModel)
      setEmbeddingModel(data.settings.embeddingModel)
      setDailyCredits(String(data.settings.dailyCredits))
      setSaved(true)
      if (hideTimer.current) clearTimeout(hideTimer.current)
      hideTimer.current = setTimeout(() => setSaved(false), SUCCESS_HIDE_MS)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'সেভ করা গেল না, আবার চেষ্টা করো।')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-2xl bg-emerald-50" />
        ))}
      </div>
    )
  }

  return (
    <Card className="rounded-2xl border-emerald-100 bg-white py-0 shadow-sm">
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="chat-model" className="text-stone-700">
            চ্যাট মডেল
          </Label>
          <Input
            id="chat-model"
            value={chatModel}
            onChange={(e) => {
              setChatModel(e.target.value)
              markEdited()
            }}
            placeholder="gemini-2.5-flash-lite"
            className="h-11 border-stone-200 font-mono text-sm focus-visible:ring-emerald-300"
          />
          <p className="text-xs text-stone-500">
            গুগল নতুন মডেল বের করলে এখানে শুধু নাম বদলে দিলেই হবে — কোড ছোঁয়ার দরকার নেই।
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="embed-model" className="text-stone-700">
            এমবেডিং মডেল
          </Label>
          <Input
            id="embed-model"
            value={embeddingModel}
            onChange={(e) => {
              setEmbeddingModel(e.target.value)
              markEdited()
            }}
            placeholder="gemini-embedding-001"
            className="h-11 border-stone-200 font-mono text-sm focus-visible:ring-emerald-300"
          />
          <p className="text-xs text-stone-500">
            gemini-embedding-001 (৩০৭২ ডাইমেনশন, ছবি-ডায়াগ্রাম বোঝে)
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="daily-credits" className="text-stone-700">
            দৈনিক প্রশ্ন কোটা
          </Label>
          <Input
            id="daily-credits"
            type="number"
            min={1}
            max={1000}
            value={dailyCredits}
            onChange={(e) => {
              setDailyCredits(e.target.value)
              markEdited()
            }}
            className="h-11 border-stone-200 focus-visible:ring-emerald-300"
          />
          <p className="text-xs text-stone-500">প্রতিদিন রাত ১২টায় (ঢাকা সময়) অটো রিসেট।</p>
        </div>

        {error && (
          <Alert variant="destructive" className="rounded-xl border-rose-200 bg-rose-50">
            <AlertDescription className="text-rose-700">{error}</AlertDescription>
          </Alert>
        )}
        {saved && (
          <Alert className="rounded-xl border-emerald-200 bg-emerald-50">
            <AlertDescription className="font-medium text-emerald-800">
              সেভ হয়েছে ✓
            </AlertDescription>
          </Alert>
        )}

        <Button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="h-11 w-full bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 sm:w-fit sm:px-6"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'সেভ হচ্ছে...' : 'সেভ করুন'}
        </Button>
      </CardContent>
    </Card>
  )
}
