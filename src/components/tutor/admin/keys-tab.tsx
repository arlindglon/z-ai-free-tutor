'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Eye, EyeOff, Info, Loader2, Plus, Trash2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { api, ApiError } from '@/lib/api'
import { detectKeyEngine } from '@/lib/key-format'
import { isEngineId } from '@/lib/key-format'
import type { ApiKeyInfo, EngineId } from '@/lib/types'

const ENGINE_LABEL: Record<EngineId, string> = { gemini: 'জেমিনাই', zai: 'Z.ai GLM', 'gemini-web': 'Gemini Web' }

export function KeysTab() {
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // নতুন কী যোগের ফর্ম
  const [label, setLabel] = useState('')
  const [keyValue, setKeyValue] = useState('')
  const [engine, setEngine] = useState<EngineId>('gemini')
  const [showKey, setShowKey] = useState(false)
  const [adding, setAdding] = useState(false)

  // চালু/বন্ধ টগল চলাকালীন কোন কী
  const [togglingId, setTogglingId] = useState<string | null>(null)

  // দুই-ক্লিক কনফার্ম ডিলিট
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearConfirmTimer = useCallback(() => {
    if (confirmTimer.current) {
      clearTimeout(confirmTimer.current)
      confirmTimer.current = null
    }
  }, [])

  const loadKeys = useCallback(async () => {
    setListError(null)
    try {
      const data = await api<{ keys: ApiKeyInfo[] }>('/api/admin/keys')
      setKeys(data.keys)
    } catch (e) {
      setListError(e instanceof ApiError ? e.message : 'কী-এর তালিকা আনা গেল না, আবার চেষ্টা করো।')
    }
  }, [])

  useEffect(() => {
    void loadKeys()
    return clearConfirmTimer
  }, [loadKeys, clearConfirmTimer])

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (adding) return
    setActionError(null)
    setAdding(true)
    try {
      await api<{ key: ApiKeyInfo }>('/api/admin/keys', {
        method: 'POST',
        body: { key: keyValue.trim(), label: label.trim() || undefined, engine },
      })
      setLabel('')
      setKeyValue('')
      setShowKey(false)
      await loadKeys()
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : 'নেটওয়ার্ক সমস্যা — ইন্টারনেট চেক করে আবার চেষ্টা করো।'
      )
    } finally {
      setAdding(false)
    }
  }

  async function handleToggle(k: ApiKeyInfo, active: boolean) {
    setActionError(null)
    setTogglingId(k.id)
    try {
      const data = await api<{ key: ApiKeyInfo }>('/api/admin/keys', {
        method: 'PATCH',
        body: { id: k.id, active },
      })
      setKeys((prev) => (prev ? prev.map((x) => (x.id === data.key.id ? data.key : x)) : prev))
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'কী টগল করা গেল না।')
    } finally {
      setTogglingId(null)
    }
  }

  function handleDeleteClick(id: string) {
    if (confirmId !== id) {
      setConfirmId(id)
      clearConfirmTimer()
      confirmTimer.current = setTimeout(() => setConfirmId(null), 3000)
      return
    }
    clearConfirmTimer()
    setConfirmId(null)
    void doDelete(id)
  }

  async function doDelete(id: string) {
    setActionError(null)
    try {
      await api<{ ok: true }>(`/api/admin/keys/${id}`, { method: 'DELETE' })
      setKeys((prev) => (prev ? prev.filter((k) => k.id !== id) : prev))
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'কী মুছে ফেলা গেল না।')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* তথ্য বক্স */}
      <Alert className="rounded-2xl border-emerald-200 bg-emerald-50 text-emerald-900">
        <Info className="h-4 w-4 text-emerald-600" />
        <AlertDescription className="text-emerald-800">
          দুই ইঞ্জিনেই যত খুশি ফ্রি API কী যোগ করো — সিস্টেম অটো রাউন্ড-রবিন লোড ব্যালেন্সিং করবে:
          Gemini key নাও Google AI Studio থেকে (aistudio.google.com/apikey), আর Z.ai key নাও z.ai Model
          API থেকে। কোনো কী রেট-লিমিট (429) খেলে মুহূর্তেই পরের কী-তে চলে যাবে — এক ইঞ্জিন ব্যস্ত হলে
          অন্য ইঞ্জিন অটো উত্তর দেবে (সেটিংস ট্যাবে মূল ইঞ্জিন বাছাই)।
        </AlertDescription>
      </Alert>

      {/* যোগ করার ফর্ম */}
      <Card className="rounded-2xl border-emerald-100 bg-white py-0 shadow-sm">
        <CardContent className="p-4">
          <form onSubmit={handleAdd} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="key-engine" className="text-stone-700">
                ইঞ্জিন
              </Label>
              <Select value={engine} onValueChange={(v) => setEngine(isEngineId(v) ? v : 'gemini')}>
                <SelectTrigger
                  id="key-engine"
                  className="h-11 border-stone-200 focus-visible:ring-emerald-300"
                >
                  <SelectValue placeholder="ইঞ্জিন বাছো" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gemini">জেমিনাই (Google AI Studio)</SelectItem>
                  <SelectItem value="zai">Z.ai GLM (z.ai Model API)</SelectItem>
                  <SelectItem value="gemini-web">Gemini Web (নিজস্ব সার্ভার)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="key-label" className="text-stone-700">
                  কী-এর লেবেল
                </Label>
                <Input
                  id="key-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="লেবেল, যেমন: জেমিনাই একাউন্ট ১"
                  maxLength={60}
                  className="h-11 border-stone-200 focus-visible:ring-emerald-300"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="key-value" className="text-stone-700">
                  API কী
                </Label>
                <div className="relative">
                  <Input
                    id="key-value"
                    value={keyValue}
                    onChange={(e) => {
                      setKeyValue(e.target.value)
                      // কী-এর আকৃতি দেখে ইঞ্জিন অটো-বাছাই — ভুল ড্রপডাউনে আর আটকাবে না
                      const detected = detectKeyEngine(e.target.value)
                      if (detected) setEngine(detected)
                    }}
                    placeholder={
                      engine === 'zai'
                        ? 'Z.ai key পেস্ট করো'
                        : engine === 'gemini-web'
                          ? 'https://নিজস্ব-সার্ভার:8083|sk-gemini-...'
                          : 'AIzaSy... পেস্ট করো'
                    }
                    type={showKey ? 'text' : 'password'}
                    autoComplete="off"
                    required
                    className="h-11 border-stone-200 pr-11 font-mono focus-visible:ring-emerald-300"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    aria-label={showKey ? 'কী লুকাও' : 'কী দেখাও'}
                    className="absolute inset-y-0 right-0 flex h-11 w-11 items-center justify-center text-stone-400 hover:text-emerald-600"
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
            {actionError && (
              <Alert variant="destructive" className="rounded-xl border-rose-200 bg-rose-50">
                <AlertDescription className="text-rose-700">{actionError}</AlertDescription>
              </Alert>
            )}
            <Button
              type="submit"
              disabled={adding || keyValue.trim().length === 0}
              className="h-11 w-full bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 sm:w-fit sm:px-6"
            >
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {adding ? 'যোগ হচ্ছে...' : 'যোগ করুন'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* কী-এর তালিকা */}
      {listError && (
        <Alert variant="destructive" className="rounded-2xl border-rose-200 bg-rose-50">
          <AlertDescription className="text-rose-700">{listError}</AlertDescription>
        </Alert>
      )}

      {keys === null && !listError ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl bg-emerald-50" />
          ))}
        </div>
      ) : keys !== null && keys.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-emerald-200 bg-white p-6 text-center text-sm text-stone-500">
          এখনো কোনো কী নেই — উপরের ফর্ম থেকে প্রথম কী যোগ করো।
        </p>
      ) : keys !== null ? (
        <Card className="rounded-2xl border-emerald-100 bg-white py-0 shadow-sm">
          <CardContent className="p-0">
            <div className="max-h-96 divide-y divide-emerald-50 overflow-y-auto rounded-2xl">
              {keys.map((k) => (
                <div key={k.id} className="flex items-center gap-3 p-4">
                  <span
                    aria-hidden
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      k.active ? 'bg-emerald-500' : 'bg-rose-400'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-stone-800">
                        {k.label || 'লেবেল নেই'}
                      </p>
                      <Badge
                        className={
                          k.engine === 'zai'
                            ? 'bg-amber-100 text-amber-800 hover:bg-amber-100'
                            : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100'
                        }
                      >
                        {ENGINE_LABEL[k.engine]}
                      </Badge>
                    </div>
                    <p className="truncate font-mono text-xs text-stone-500">{k.masked}</p>
                    <p className="text-xs text-stone-400">
                      {new Date(k.createdAt).toLocaleDateString('bn-BD')}
                    </p>
                    {k.lastError && (
                      <p className="mt-0.5 text-xs text-rose-600">শেষ এরর: {k.lastError}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Switch
                      checked={k.active}
                      disabled={togglingId === k.id}
                      onCheckedChange={(active) => void handleToggle(k, active)}
                      aria-label={k.active ? 'কী বন্ধ করো' : 'কী চালু করো'}
                      className="data-[state=checked]:bg-emerald-600"
                    />
                    <Button
                      variant="ghost"
                      onClick={() => handleDeleteClick(k.id)}
                      disabled={togglingId === k.id}
                      aria-label="কী মুছে ফেলো"
                      className={
                        confirmId === k.id
                          ? 'h-11 bg-rose-600 px-3 text-xs font-bold text-white hover:bg-rose-700 hover:text-white'
                          : 'h-11 w-11 px-0 text-rose-600 hover:bg-rose-50'
                      }
                    >
                      {confirmId === k.id ? 'নিশ্চিত?' : <Trash2 className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
