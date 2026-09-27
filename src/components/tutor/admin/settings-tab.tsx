'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, Cpu, Loader2, Save, Sparkles } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { api, ApiError } from '@/lib/api'
import type { EngineId, SettingsInfo } from '@/lib/types'

const SUCCESS_HIDE_MS = 4000

export function SettingsTab() {
  const [chatModel, setChatModel] = useState('')
  const [embeddingModel, setEmbeddingModel] = useState('')
  const [dailyCredits, setDailyCredits] = useState('')
  const [primaryEngine, setPrimaryEngine] = useState<EngineId>('gemini')
  const [geminiEnabled, setGeminiEnabled] = useState(true)
  const [zaiEnabled, setZaiEnabled] = useState(true)
  const [fallbackEnabled, setFallbackEnabled] = useState(true)
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
      setPrimaryEngine(data.settings.primaryEngine)
      setGeminiEnabled(data.settings.geminiEnabled)
      setZaiEnabled(data.settings.zaiEnabled)
      setFallbackEnabled(data.settings.fallbackEnabled)
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
    if (!geminiEnabled && !zaiEnabled) {
      setError('অন্তত একটা ইঞ্জিন চালু রাখো — দুটোই বন্ধ থাকলে শিক্ষার্থী উত্তর পাবে না।')
      return
    }
    if (!geminiEnabled && primaryEngine === 'gemini') setPrimaryEngine('zai')
    if (!zaiEnabled && primaryEngine === 'zai') setPrimaryEngine('gemini')
    setSaving(true)
    try {
      const data = await api<{ settings: SettingsInfo }>('/api/admin/settings', {
        method: 'PUT',
        body: {
          chatModel: chatModel.trim(),
          embeddingModel: embeddingModel.trim(),
          dailyCredits: credits,
          primaryEngine: !geminiEnabled ? 'zai' : !zaiEnabled ? 'gemini' : primaryEngine,
          geminiEnabled,
          zaiEnabled,
          fallbackEnabled,
        },
      })
      setChatModel(data.settings.chatModel)
      setEmbeddingModel(data.settings.embeddingModel)
      setDailyCredits(String(data.settings.dailyCredits))
      setPrimaryEngine(data.settings.primaryEngine)
      setGeminiEnabled(data.settings.geminiEnabled)
      setZaiEnabled(data.settings.zaiEnabled)
      setFallbackEnabled(data.settings.fallbackEnabled)
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
    <div className="flex flex-col gap-4">
      {/* ইঞ্জিন নিয়ন্ত্রণ */}
      <Card className="rounded-2xl border-emerald-100 bg-white py-0 shadow-sm">
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-emerald-600" />
            <p className="text-sm font-semibold text-stone-800">ইঞ্জিন নিয়ন্ত্রণ</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-stone-700">মূল চ্যাট ইঞ্জিন (কে আগে উত্তর দেবে)</Label>
            <RadioGroup
              value={primaryEngine}
              onValueChange={(v) => {
                setPrimaryEngine(v === 'zai' ? 'zai' : 'gemini')
                markEdited()
              }}
              className="flex flex-col gap-2 sm:flex-row"
            >
              <label
                htmlFor="eng-gemini"
                className={`flex flex-1 cursor-pointer items-center gap-3 rounded-2xl border p-3 transition-colors ${
                  primaryEngine === 'gemini'
                    ? 'border-emerald-400 bg-emerald-50'
                    : 'border-stone-200 bg-white hover:border-emerald-200'
                } ${!geminiEnabled ? 'opacity-50' : ''}`}
              >
                <RadioGroupItem id="eng-gemini" value="gemini" disabled={!geminiEnabled} />
                <Sparkles className="h-4 w-4 shrink-0 text-emerald-600" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-stone-800">জেমিনাই</p>
                  <p className="text-xs text-stone-500">Google ফ্রি কী-পুল</p>
                </div>
              </label>
              <label
                htmlFor="eng-zai"
                className={`flex flex-1 cursor-pointer items-center gap-3 rounded-2xl border p-3 transition-colors ${
                  primaryEngine === 'zai'
                    ? 'border-amber-400 bg-amber-50'
                    : 'border-stone-200 bg-white hover:border-amber-200'
                } ${!zaiEnabled ? 'opacity-50' : ''}`}
              >
                <RadioGroupItem id="eng-zai" value="zai" disabled={!zaiEnabled} />
                <Bot className="h-4 w-4 shrink-0 text-amber-600" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-stone-800">Z.ai GLM</p>
                  <p className="text-xs text-stone-500">Z.ai ফ্রি কী-পুল</p>
                </div>
              </label>
            </RadioGroup>
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-stone-100 bg-stone-50/60 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-stone-800">জেমিনাই ইঞ্জিন</p>
                <p className="text-xs text-stone-500">বন্ধ করলে সব প্রশ্ন Z.ai-তে যাবে</p>
              </div>
              <Switch
                checked={geminiEnabled}
                onCheckedChange={(v) => {
                  setGeminiEnabled(v)
                  markEdited()
                }}
                aria-label="জেমিনাই ইঞ্জিন চালু/বন্ধ"
                className="data-[state=checked]:bg-emerald-600"
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-stone-800">Z.ai ইঞ্জিন</p>
                <p className="text-xs text-stone-500">বন্ধ করলে সব প্রশ্ন জেমিনাইতে যাবে</p>
              </div>
              <Switch
                checked={zaiEnabled}
                onCheckedChange={(v) => {
                  setZaiEnabled(v)
                  markEdited()
                }}
                aria-label="Z.ai ইঞ্জিন চালু/বন্ধ"
                className="data-[state=checked]:bg-emerald-600"
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-stone-800">অটো-ফলব্যাক</p>
                <p className="text-xs text-stone-500">
                  মূল ইঞ্জিন ফেইল/ব্যস্ত হলে অন্যটা অটো উত্তর দেবে — শিক্ষার্থী কখনো এরর দেখবে না
                </p>
              </div>
              <Switch
                checked={fallbackEnabled}
                onCheckedChange={(v) => {
                  setFallbackEnabled(v)
                  markEdited()
                }}
                aria-label="অটো-ফলব্যাক চালু/বন্ধ"
                className="data-[state=checked]:bg-emerald-600"
              />
            </div>
            <p className="text-xs text-stone-400">
              নোট: বই-খোঁজার এমবেডিং সবসময় Gemini দিয়ে হয় — জেমিনাই ইঞ্জিন বন্ধ থাকলে লেক্সিকাল সার্চ চলবে।
            </p>
          </div>
        </CardContent>
      </Card>

      {/* মডেল ও কোটা */}
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
    </div>
  )
}
