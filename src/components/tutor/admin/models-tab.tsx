'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bot,
  Check,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiError } from '@/lib/api'
import { toBn } from '@/lib/bn'
import type { EngineId, ModelInfo } from '@/lib/types'

/**
 * মডেল রেজিস্ট্রি — দুই ইঞ্জিনের সব চ্যাট মডেল এক জায়গায়:
 * - নতুন মডেল এলে শুধু নাম লিখে যোগ করো (কোড ছোঁয়ার দরকার নেই)
 * - প্রতিটা মডেলের নিজস্ব on/off সুইচ
 * - প্রতিটা মডেলের নিজস্ব স্বাক্ষর পুল — লাইন বাই লাইন যত খুশি নাম/কোড,
 *   উত্তরে র‍্যান্ডম একটা দেখাবে; স্টুডেন্ট কোড লিখলে সেই মডেলেই রাউট হবে
 */

const ENGINE_META: Record<
  EngineId,
  { name: string; sub: string; accent: string; ring: string }
> = {
  gemini: {
    name: 'জেমিনাই মডেল',
    sub: 'Google AI Studio-র ফ্রি মডেল — নতুন মডেল এলে নিচে নাম লিখে যোগ করো',
    accent: 'text-emerald-600',
    ring: 'border-emerald-100',
  },
  zai: {
    name: 'Z.ai GLM মডেল',
    sub: 'Z.ai-র ফ্রি ফ্ল্যাশ মডেল — নতুন মডেল এলে নিচে নাম লিখে যোগ করো',
    accent: 'text-amber-600',
    ring: 'border-amber-100',
  },
}

const ENGINES: EngineId[] = ['gemini', 'zai']
const SUCCESS_HIDE_MS = 4000

export function ModelsTab() {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [adding, setAdding] = useState<EngineId | null>(null)
  const [form, setForm] = useState<Record<EngineId, { modelId: string; label: string }>>({
    gemini: { modelId: '', label: '' },
    zai: { modelId: '', label: '' },
  })
  const [aliasDraft, setAliasDraft] = useState<Record<string, string>>({})
  const [addingAliasFor, setAddingAliasFor] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; modelId: string; label: string } | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimers = useCallback(() => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
  }, [])

  const loadModels = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api<{ models: ModelInfo[] }>('/api/admin/models')
      setModels(data.models)
      setError(null)
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : 'মডেল তালিকা আনা গেল না — ইন্টারনেট চেক করে আবার চেষ্টা করো।'
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadModels()
    return clearTimers
  }, [loadModels, clearTimers])

  function flashNotice(msg: string) {
    setNotice(msg)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), SUCCESS_HIDE_MS)
  }

  function fail(e: unknown, fallback: string) {
    setError(e instanceof ApiError ? e.message : fallback)
  }

  async function handleAddModel(engine: EngineId) {
    if (adding) return
    const f = form[engine]
    if (!f.modelId.trim()) {
      setError('মডেল আইডি লেখো — যেমন gemini-3.5-flash-lite বা glm-4.5-flash।')
      return
    }
    setError(null)
    setAdding(engine)
    try {
      await api('/api/admin/models', {
        method: 'POST',
        body: { engine, modelId: f.modelId.trim(), label: f.label.trim() },
      })
      setForm((prev) => ({ ...prev, [engine]: { modelId: '', label: '' } }))
      flashNotice('মডেল যোগ হয়েছে ✓')
      await loadModels()
    } catch (e) {
      fail(e, 'মডেল যোগ করা গেল না — আবার চেষ্টা করো।')
    } finally {
      setAdding(null)
    }
  }

  async function handleToggle(model: ModelInfo) {
    if (busyId) return
    setError(null)
    setBusyId(model.id)
    // অপটিমিস্টিক — সাথে সাথে সুইচ ঘোরে
    setModels((prev) =>
      prev.map((m) => (m.id === model.id ? { ...m, active: !m.active } : m))
    )
    try {
      await api('/api/admin/models', {
        method: 'PATCH',
        body: { id: model.id, active: !model.active },
      })
    } catch (e) {
      setModels((prev) =>
        prev.map((m) => (m.id === model.id ? { ...m, active: model.active } : m))
      )
      fail(e, 'মডেল চালু/বন্ধ করা গেল না।')
    } finally {
      setBusyId(null)
    }
  }

  async function handleSaveEdit() {
    if (!editing || busyId) return
    if (!editing.modelId.trim()) {
      setError('মডেল আইডি খালি রাখা যাবে না।')
      return
    }
    setError(null)
    setBusyId(editing.id)
    try {
      await api('/api/admin/models', {
        method: 'PATCH',
        body: { id: editing.id, modelId: editing.modelId.trim(), label: editing.label.trim() },
      })
      setEditing(null)
      flashNotice('মডেল আপডেট হয়েছে ✓')
      await loadModels()
    } catch (e) {
      fail(e, 'মডেল আপডেট করা গেল না।')
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(model: ModelInfo) {
    if (busyId) return
    // দুই-ক্লিক নিশ্চিতকরণ — ভুলে ট্যাপ করলেও মুছবে না
    if (confirmDeleteId !== model.id) {
      setConfirmDeleteId(model.id)
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
      confirmTimer.current = setTimeout(() => setConfirmDeleteId(null), 3000)
      return
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
    setConfirmDeleteId(null)
    setError(null)
    setBusyId(model.id)
    try {
      await api(`/api/admin/models?id=${encodeURIComponent(model.id)}`, { method: 'DELETE' })
      setModels((prev) => prev.filter((m) => m.id !== model.id))
      flashNotice('মডেল মুছে ফেলা হয়েছে (স্বাক্ষরগুলোও মুছে গেছে)।')
    } catch (e) {
      fail(e, 'মডেল মুছে ফেলা গেল না।')
    } finally {
      setBusyId(null)
    }
  }

  async function handleAddAliases(model: ModelInfo) {
    if (addingAliasFor) return
    const draft = (aliasDraft[model.id] ?? '').trim()
    if (!draft) {
      setError('অন্তত একটা নাম/কোড লেখো — প্রতি লাইনে একটা করে।')
      return
    }
    setError(null)
    setAddingAliasFor(model.id)
    try {
      const data = await api<{ added: number; message: string }>('/api/admin/models/aliases', {
        method: 'POST',
        body: { aiModelId: model.id, aliases: draft },
      })
      setAliasDraft((prev) => ({ ...prev, [model.id]: '' }))
      flashNotice(data.message)
      await loadModels()
    } catch (e) {
      fail(e, 'স্বাক্ষর যোগ করা গেল না।')
    } finally {
      setAddingAliasFor(null)
    }
  }

  async function handleDeleteAlias(model: ModelInfo, aliasId: string) {
    if (busyId) return
    setError(null)
    setBusyId(aliasId)
    // অপটিমিস্টিক — চিপ সাথে সাথে সরে যায়
    setModels((prev) =>
      prev.map((m) =>
        m.id === model.id ? { ...m, aliases: m.aliases.filter((a) => a.id !== aliasId) } : m
      )
    )
    try {
      await api(`/api/admin/models/aliases?id=${encodeURIComponent(aliasId)}`, {
        method: 'DELETE',
      })
    } catch (e) {
      await loadModels()
      fail(e, 'স্বাক্ষর মুছে ফেলা গেল না।')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-2xl bg-emerald-50" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ব্যাখ্যা */}
      <Card className="rounded-2xl border-emerald-100 bg-white py-0 shadow-sm">
        <CardContent className="flex flex-col gap-1.5 p-4">
          <p className="text-sm font-semibold text-stone-800">চ্যাট মডেল রেজিস্ট্রি</p>
          <p className="text-xs leading-relaxed text-stone-500">
            কোন ইঞ্জিনে কোন কোন মডেল চলবে সব এখানে — নতুন মডেল বাজারে এলে শুধু নাম লিখে যোগ করো,
            কোড ছোঁয়ার দরকার নেই। প্রতিটা মডেলের পাশে on/off সুইচ আছে, আর প্রতিটার নিজস্ব
            স্বাক্ষর-পুল: উত্তরে ওই পুল থেকে র‍্যান্ডম একটা নাম/কোড দেখাবে — স্টুডেন্ট শুধু নাম
            দেখবে, তুমি নাম দেখে বুঝবে কোন মডেল উত্তর দিয়েছে। স্টুডেন্ট প্রশ্নে কোডটা লিখলে সেই
            মডেলেই উত্তর যাবে। 😎
          </p>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive" className="rounded-xl border-rose-200 bg-rose-50">
          <AlertDescription className="text-rose-700">{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert className="rounded-xl border-emerald-200 bg-emerald-50">
          <AlertDescription className="font-medium text-emerald-800">{notice}</AlertDescription>
        </Alert>
      )}

      {ENGINES.map((engine) => {
        const meta = ENGINE_META[engine]
        const list = models.filter((m) => m.engine === engine)
        return (
          <Card key={engine} className={`rounded-2xl border bg-white py-0 shadow-sm ${meta.ring}`}>
            <CardContent className="flex flex-col gap-4 p-4">
              <div className="flex items-center gap-2">
                {engine === 'gemini' ? (
                  <Sparkles className={`h-4 w-4 ${meta.accent}`} />
                ) : (
                  <Bot className={`h-4 w-4 ${meta.accent}`} />
                )}
                <div className="min-w-0">
                  <p className={`text-sm font-semibold ${meta.accent}`}>{meta.name}</p>
                  <p className="truncate text-xs text-stone-500">{meta.sub}</p>
                </div>
                <Badge variant="secondary" className="ml-auto shrink-0 rounded-full bg-stone-100 text-stone-600">
                  {toBn(list.length)}টি মডেল
                </Badge>
              </div>

              {/* নতুন মডেল যোগ */}
              <div className="flex flex-col gap-2 rounded-2xl border border-stone-100 bg-stone-50/60 p-3 sm:flex-row sm:items-end">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Label htmlFor={`model-id-${engine}`} className="text-stone-700">
                    মডেল আইডি (API নাম)
                  </Label>
                  <Input
                    id={`model-id-${engine}`}
                    value={form[engine].modelId}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, [engine]: { ...prev[engine], modelId: e.target.value } }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleAddModel(engine)
                    }}
                    placeholder={engine === 'zai' ? 'glm-4.5-flash' : 'gemini-3.5-flash-lite'}
                    className="h-10 border-stone-200 font-mono text-sm focus-visible:ring-emerald-300"
                  />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Label htmlFor={`model-label-${engine}`} className="text-stone-700">
                    দেখার নাম (ঐচ্ছিক)
                  </Label>
                  <Input
                    id={`model-label-${engine}`}
                    value={form[engine].label}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, [engine]: { ...prev[engine], label: e.target.value } }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleAddModel(engine)
                    }}
                    placeholder={engine === 'zai' ? 'GLM-4.5-Flash' : 'Gemini 3.5 Flash Lite'}
                    className="h-10 border-stone-200 text-sm focus-visible:ring-emerald-300"
                  />
                </div>
                <Button
                  type="button"
                  onClick={() => void handleAddModel(engine)}
                  disabled={adding !== null}
                  className="h-10 shrink-0 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700"
                >
                  {adding === engine ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  যোগ করো
                </Button>
              </div>

              {/* মডেল তালিকা */}
              {list.length === 0 ? (
                <p className="py-2 text-center text-xs text-stone-400">
                  এই ইঞ্জিনে কোনো মডেল নেই — উপরে নাম লিখে যোগ করো। (তালিকা খালি থাকলে সেটিংসের
                  ডিফল্ট মডেল চলে।)
                </p>
              ) : (
                <div className="max-h-[28rem] flex-col gap-3 overflow-y-auto pr-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-200 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
                  {list.map((model) => {
                    const isEditing = editing?.id === model.id
                    return (
                      <div
                        key={model.id}
                        className={`flex flex-col gap-3 rounded-2xl border p-3 transition-colors ${
                          model.active ? 'border-stone-200 bg-white' : 'border-stone-100 bg-stone-50/70'
                        }`}
                      >
                        {/* সারি ১: সুইচ + নাম + অ্যাকশন */}
                        {isEditing ? (
                          <div className="flex flex-col gap-2">
                            <div className="grid gap-2 sm:grid-cols-2">
                              <Input
                                value={editing.modelId}
                                onChange={(e) => setEditing({ ...editing, modelId: e.target.value })}
                                placeholder="মডেল আইডি"
                                className="h-10 border-stone-200 font-mono text-sm focus-visible:ring-emerald-300"
                                aria-label="মডেল আইডি এডিট"
                              />
                              <Input
                                value={editing.label}
                                onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                                placeholder="দেখার নাম"
                                className="h-10 border-stone-200 text-sm focus-visible:ring-emerald-300"
                                aria-label="দেখার নাম এডিট"
                              />
                            </div>
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => void handleSaveEdit()}
                                disabled={busyId === model.id}
                                className="h-9 flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
                              >
                                {busyId === model.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Check className="h-4 w-4" />
                                )}
                                সেভ
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => setEditing(null)}
                                className="h-9 flex-1 border-stone-200 text-stone-600 hover:bg-stone-50"
                              >
                                <X className="h-4 w-4" />
                                বাতিল
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            <Switch
                              checked={model.active}
                              onCheckedChange={() => void handleToggle(model)}
                              disabled={busyId === model.id}
                              aria-label={`${model.label ?? model.modelId} মডেল চালু/বন্ধ`}
                              className="data-[state=checked]:bg-emerald-600"
                            />
                            <div className="min-w-0 flex-1">
                              <p
                                className={`truncate text-sm font-semibold ${
                                  model.active ? 'text-stone-800' : 'text-stone-400'
                                }`}
                              >
                                {model.label ?? model.modelId}
                              </p>
                              <p className="truncate font-mono text-xs text-stone-400">
                                {model.modelId}
                                {model.label ? '' : ''}
                              </p>
                            </div>
                            {model.usageCount > 0 && (
                              <Badge
                                variant="secondary"
                                className="hidden shrink-0 rounded-full bg-emerald-50 text-xs text-emerald-700 sm:inline-flex"
                              >
                                {toBn(model.usageCount)} উত্তর
                              </Badge>
                            )}
                            <div className="flex shrink-0 gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  setEditing({
                                    id: model.id,
                                    modelId: model.modelId,
                                    label: model.label ?? '',
                                  })
                                }
                                aria-label="মডেল এডিট করো"
                                title="মডেল এডিট করো"
                                className="h-9 w-9 text-stone-400 hover:bg-emerald-50 hover:text-emerald-700"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => void handleDelete(model)}
                                disabled={busyId === model.id}
                                aria-label="মডেল মুছে ফেলো"
                                title="মডেল মুছে ফেলো"
                                className={`h-9 w-9 ${
                                  confirmDeleteId === model.id
                                    ? 'bg-rose-600 text-white hover:bg-rose-700'
                                    : 'text-stone-400 hover:bg-rose-50 hover:text-rose-600'
                                }`}
                              >
                                {busyId === model.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : confirmDeleteId === model.id ? (
                                  <span className="text-xs font-bold">নিশ্চিত?</span>
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* সারি ২: স্বাক্ষর পুল */}
                        <div className="flex flex-col gap-2 rounded-xl bg-stone-50/80 p-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-stone-600">
                              স্বাক্ষর পুল{' '}
                              <span className="font-normal text-stone-400">
                                ({toBn(model.aliases.length)}টি — উত্তরে র‍্যান্ডম একটা)
                              </span>
                            </p>
                          </div>
                          {model.aliases.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {model.aliases.map((a) => (
                                <span
                                  key={a.id}
                                  className="group inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-white py-0.5 pl-2.5 pr-1 text-xs font-medium text-emerald-800"
                                >
                                  {a.alias}
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteAlias(model, a.id)}
                                    disabled={busyId === a.id}
                                    aria-label={`${a.alias} স্বাক্ষর মুছে ফেলো`}
                                    className="flex h-5 w-5 items-center justify-center rounded-full text-emerald-500 transition-colors hover:bg-rose-100 hover:text-rose-600"
                                  >
                                    {busyId === a.id ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <X className="h-3 w-3" />
                                    )}
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="flex gap-2">
                            <Textarea
                              value={aliasDraft[model.id] ?? ''}
                              onChange={(e) =>
                                setAliasDraft((prev) => ({ ...prev, [model.id]: e.target.value }))
                              }
                              placeholder={'প্রতি লাইনে একটা নাম/কোড…\nযেমন: রবিন\nZ-9\nসূর্য স্যার'}
                              rows={2}
                              className="min-h-16 border-stone-200 bg-white text-sm focus-visible:ring-emerald-300"
                              aria-label={`${model.label ?? model.modelId} মডেলের স্বাক্ষর যোগ করো`}
                            />
                            <Button
                              type="button"
                              onClick={() => void handleAddAliases(model)}
                              disabled={addingAliasFor !== null}
                              className="h-fit shrink-0 self-stretch bg-emerald-600 px-3 text-white hover:bg-emerald-700"
                            >
                              {addingAliasFor === model.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Plus className="h-4 w-4" />
                              )}
                              <span className="sr-only sm:not-sr-only sm:text-xs">যোগ</span>
                            </Button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}

      <p className="px-1 text-xs text-stone-400">
        টিপস: কোনো মডেল API-তে না পাওয়া গেলে সিস্টেম নিঃশব্দে পরের চালু মডেল দিয়ে উত্তর দেয় —
        ভুল মডেল থাকলেও স্টুডেন্ট আটকায় না। ভুলটা এডিট (✎) বা বন্ধ সুইচ দিয়ে সামলে নিও।
      </p>
    </div>
  )
}
