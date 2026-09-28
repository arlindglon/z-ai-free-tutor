'use client'

import { motion } from 'framer-motion'
import { BarChart3, Boxes, KeyRound, Library, LogOut, Settings, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { UserInfo } from '@/lib/types'
import { BooksTab } from './books-tab'
import { KeysTab } from './keys-tab'
import { ModelsTab } from './models-tab'
import { SettingsTab } from './settings-tab'
import { StatsTab } from './stats-tab'

export function AdminView({ user, onLogout }: { user: UserInfo; onLogout: () => void }) {
  return (
    <div className="min-h-dvh bg-stone-50">
      {/* হেডার বার */}
      <header className="sticky top-0 z-10 border-b border-emerald-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-4xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold leading-tight text-stone-900 sm:text-lg">
                অ্যাডমিন ড্যাশবোর্ড
              </h1>
              <p className="hidden truncate text-xs text-stone-500 sm:block">{user.email}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onLogout}
            aria-label="লগআউট"
            title="লগআউট"
            className="h-11 w-11 shrink-0 text-stone-500 hover:bg-rose-50 hover:text-rose-600"
          >
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </header>

      {/* কনটেন্ট */}
      <motion.main
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="mx-auto w-full max-w-4xl px-4 py-6"
      >
        <Tabs defaultValue="keys" className="gap-4">
          <TabsList className="grid h-11 w-full grid-cols-5 rounded-2xl border border-emerald-100 bg-white p-1 shadow-sm">
            <TabsTrigger
              value="keys"
              className="gap-1 rounded-xl px-1 text-xs font-semibold text-stone-600 data-[state=active]:bg-emerald-50 data-[state=active]:text-emerald-700 data-[state=active]:shadow-none sm:gap-1.5 sm:px-2 sm:text-sm"
            >
              <KeyRound className="h-4 w-4 shrink-0" />
              API কী
            </TabsTrigger>
            <TabsTrigger
              value="models"
              className="gap-1 rounded-xl px-1 text-xs font-semibold text-stone-600 data-[state=active]:bg-emerald-50 data-[state=active]:text-emerald-700 data-[state=active]:shadow-none sm:gap-1.5 sm:px-2 sm:text-sm"
            >
              <Boxes className="h-4 w-4 shrink-0" />
              মডেল
            </TabsTrigger>
            <TabsTrigger
              value="books"
              className="gap-1 rounded-xl px-1 text-xs font-semibold text-stone-600 data-[state=active]:bg-emerald-50 data-[state=active]:text-emerald-700 data-[state=active]:shadow-none sm:gap-1.5 sm:px-2 sm:text-sm"
            >
              <Library className="h-4 w-4 shrink-0" />
              নলেজবেস
            </TabsTrigger>
            <TabsTrigger
              value="stats"
              className="gap-1 rounded-xl px-1 text-xs font-semibold text-stone-600 data-[state=active]:bg-emerald-50 data-[state=active]:text-emerald-700 data-[state=active]:shadow-none sm:gap-1.5 sm:px-2 sm:text-sm"
            >
              <BarChart3 className="h-4 w-4 shrink-0" />
              পরিসংখ্যান
            </TabsTrigger>
            <TabsTrigger
              value="settings"
              className="gap-1 rounded-xl px-1 text-xs font-semibold text-stone-600 data-[state=active]:bg-emerald-50 data-[state=active]:text-emerald-700 data-[state=active]:shadow-none sm:gap-1.5 sm:px-2 sm:text-sm"
            >
              <Settings className="h-4 w-4 shrink-0" />
              সেটিংস
            </TabsTrigger>
          </TabsList>

          <TabsContent value="keys">
            <KeysTab />
          </TabsContent>
          <TabsContent value="models">
            <ModelsTab />
          </TabsContent>
          <TabsContent value="books">
            <BooksTab />
          </TabsContent>
          <TabsContent value="stats">
            <StatsTab />
          </TabsContent>
          <TabsContent value="settings">
            <SettingsTab />
          </TabsContent>
        </Tabs>
      </motion.main>
    </div>
  )
}
