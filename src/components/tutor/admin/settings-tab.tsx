'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, Cpu, Loader2, Lock, Save, Sparkles, Trash2, Zap } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
  // RAG লক — স্বাক্ষর পুল এখন "মডেল" ট্যাবে প্রতিটা মডেলের নিজস্ব হিসেবে থাকে
  const [ragOnlyMode, setRagOnlyMode] = useState(false)
  // ⚡ উত্তর-ক্যাশ চালু/বন্ধ
  const [cacheEnabled, setCacheEnabled] = useState(true)
  // 🗑️ ক্যাশ মোছার নিশ্চিতকরণ + প্রোগ্রেস
  const [clearing, setClearing] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearDone, setClearDone] = useState<string | null>(null)
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
      setRagOnlyMode(data.settings.ragOnlyMode ?? false)
      setCacheEnabled(data.settings.cacheEnabled ?? true)
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
          ragOnlyMode,
          cacheEnabled,
        },
      })
      setChatModel(data.settings.chatModel)
      setEmbeddingModel(data.settings.embeddingModel)
      setDailyCredits(String(data.settings.dailyCredits))
      setPrimaryEngine(data.settings.primaryEngine)
      setGeminiEnabled(data.settings.geminiEnabled)
      setZaiEnabled(data.settings.zaiEnabled)
      setFallbackEnabled(data.settings.fallbackEnabled)
      setRagOnlyMode(data.settings.ragOnlyMode ?? false)
      setCacheEnabled(data.settings.cacheEnabled ?? true)
      setSaved(true)
      if (hideTimer.current) clearTimeout(hideTimer.current)
      hideTimer.current = setTimeout(() => setSaved(false), SUCCESS_HIDE_MS)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'সেভ করা গেল না, আবার চেষ্টা করো।')
    } finally {
      setSaving(false)
    }
  }

  // 🗑️ জমানো সব ক্যাশ-উত্তর মুছে দাও — নতুন চিত্র-স্টাইল/প্রম্পটে প্রশ্নগুলো আবার তৈরি হবে
  async function handleClearCache() {
    if (clearing) return
    setClearing(true)
    setError(null)
    try {
      const data = await api<{ deleted: number }>('/api/admin/cache', { method: 'DELETE' })
      setClearOpen(false)
      setClearDone(`ক্যাশ মুছে গেছে ✓ (${data.deleted}টি জমানো উত্তর) — এখন থেকে সব প্রশ্ন নতুন করে উত্তর হবে।`)
      setTimeout(() => setClearDone(null), 8000)
    } catch (e) {
      setClearOpen(false)
      setError(e instanceof ApiError ? e.message : 'ক্যাশ মোছা গেল না, আবার চেষ্টা করো।')
    } finally {
      setClearing(false)
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

      {/* উত্তরের স্বাক্ষর পুল এখন "মডেল" ট্যাবে — প্রতিটা মডেলের নিজস্ব পুল */}

      {/* RAG লক — শুধু বই থেকে উত্তর */}
      <Card className="rounded-2xl border-emerald-100 bg-white py-0 shadow-sm">
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-emerald-600" />
            <p className="text-sm font-semibold text-stone-800">শুধু বই থেকে উত্তর (RAG লক)</p>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-stone-100 bg-stone-50/60 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-stone-800">
                মডেল কেবল তোমার দেওয়া তথ্য (আপলোড করা বই) থেকেই উত্তর করবে
              </p>
              <p className="text-xs leading-relaxed text-stone-500">
                চালু থাকলে মডেল নিজের মাথা থেকে বাইরের কোনো তথ্য দিতে পারবে না — বইয়ে উত্তর না
                থাকলে বলবে &quot;এই প্রশ্নের উত্তর পাঠ্যবইয়ে পাইনি 📖&quot;। ভুল তথ্য বা
                হ্যালুসিনেশনের ঝুঁকি প্রায় শূন্য হয়ে যায়।
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-emerald-700">
                🔒 সার্ভার-লেভেলে কড়াভাবে এনফোর্স হয়: বইয়ের অংশ না পেলে প্রশ্ন মডেলের কাছেই যায়
                না, আর উত্তরে বইয়ের রেফারেন্স না থাকলে সেই উত্তরও আটকে দেওয়া হয় — কোটা ফেরত।
              </p>
            </div>
            <Switch
              checked={ragOnlyMode}
              onCheckedChange={(v) => {
                setRagOnlyMode(v)
                markEdited()
              }}
              aria-label="শুধু বই থেকে উত্তর (RAG লক) চালু/বন্ধ"
              className="data-[state=checked]:bg-emerald-600"
            />
          </div>
          <p className="text-xs text-stone-400">
            বন্ধ থাকলে বইয়ে উত্তর না পেলে মডেল নিজের জ্ঞান থেকেও উত্তর দেয় (বইয়ের বাইরের তথ্য
            বলে জানিয়ে দেয়)।
          </p>
        </CardContent>
      </Card>

      {/* ⚡ উত্তর-ক্যাশ — রিপিট প্রশ্নে তাৎক্ষণিক উত্তর */}
      <Card className="rounded-2xl border-emerald-100 bg-white py-0 shadow-sm">
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-emerald-600" />
            <p className="text-sm font-semibold text-stone-800">উত্তর-ক্যাশ</p>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-stone-100 bg-stone-50/60 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-stone-800">
                রিপিট প্রশ্নে ক্যাশ থেকে তাৎক্ষণিক উত্তর (হুবহু/প্রায়-হুবহু মিল)
              </p>
              <p className="text-xs leading-relaxed text-stone-500">
                চালু থাকলে একই প্রশ্ন আবার এলে আগের উত্তর সঙ্গে সঙ্গে যায় — ইঞ্জিন-কল হয় না,
                ফ্রি-কোটা বাঁচে আর ছাত্র উত্তর-অপেক্ষায় থাকে না (ছাত্রের কোটাও ফেরত যায়)।
                প্রায়-হুবহু মিল মানে ছোটখাটো ভুল-বানান বা স্পেস-পার্থক্যেও ক্যাশ-হিট হয়।
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-emerald-700">
                ⚡ নিরাপত্তা: "পাইনি 📖" জাতীয় প্রত্যাখ্যান-উত্তর, ছবি-প্রশ্ন আর মিশ্র-লিপি-দূষিত উত্তর
                কখনো ক্যাশ হয় না — বই যোগ হলে একই প্রশ্নে নতুন উত্তর আসবেই।
              </p>
            </div>
            <Switch
              checked={cacheEnabled}
              onCheckedChange={(v) => {
                setCacheEnabled(v)
                markEdited()
              }}
              aria-label="উত্তর-ক্যাশ চালু/বন্ধ"
              className="data-[state=checked]:bg-emerald-600"
            />
          </div>
          <p className="text-xs text-stone-400">
            বন্ধ করলে প্রতিটি প্রশ্ন সরাসরি AI-ইঞ্জিনে যাবে (নতুন উত্তর ক্যাশে জমাও হবে না) —
            তখন পরিসংখ্যানের "ক্যাশ-হিট" বাড়বে না।
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-100 bg-amber-50/60 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-stone-800">জমানো ক্যাশ মুছে দাও</p>
              <p className="text-xs leading-relaxed text-stone-500">
                পুরনো উত্তর/চিত্র-স্টাইল বদলালে এখান থেকে জমানো সব ক্যাশ মুছে দাও —
                তখন থেকে সব প্রশ্ন নতুন করে উত্তর হবে (প্রথমবার একটু সময় লাগবে)।
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setClearOpen(true)}
              className="h-9 shrink-0 gap-1.5 rounded-full border-amber-300 px-3 text-amber-800 hover:bg-amber-100 hover:text-amber-900"
            >
              <Trash2 className="h-4 w-4" />
              ক্যাশ মুছুন
            </Button>
          </div>
          {clearDone && (
            <Alert className="rounded-xl border-emerald-200 bg-emerald-50">
              <AlertDescription className="text-sm text-emerald-800">{clearDone}</AlertDescription>
            </Alert>
          )}
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
            মডেল তালিকা খালি হলে এই ডিফল্ট মডেল চলে — আসল মডেল তালিকা, চালু/বন্ধ আর স্বাক্ষর
            পুল সব "মডেল" ট্যাবে।
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

      {/* 🗑️ ক্যাশ-মোছার নিশ্চিতকরণ */}
      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent className="rounded-2xl border-amber-200">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-stone-800">সব ক্যাশ-উত্তর মুছে ফেলবে?</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              জমানো সব উত্তর মুছে যাবে — ছাত্ররা একই প্রশ্ন আবার করলে তা নতুন করে
              AI-ইঞ্জিনে উত্তর হবে (আবার নতুন ক্যাশে জমা পড়বে)। চিত্র-স্টাইল বা
              প্রম্পট বদলানোর পরে এটাই করা হয়। মোছা উত্তর আর ফেরত আসবে না।
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearing} className="rounded-full">
              থাক, রাখো
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={clearing}
              onClick={(e) => {
                e.preventDefault()
                void handleClearCache()
              }}
              className="rounded-full bg-rose-600 text-white hover:bg-rose-700"
            >
              {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {clearing ? 'মুছছে…' : 'হ্যাঁ, মুছে দাও'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
