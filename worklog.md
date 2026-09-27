# Worklog — Z-AI ফ্রি প্রাইভেট টিউটর

---
Task ID: 1, 2
Agent: main (Z.ai Code)
Task: TiDB setup + Prisma schema + packages

Work Log:
- Tested TiDB Cloud connectivity (gateway01.ap-northeast-1, port 4000) — OK
- Created `studentdb` database via `prisma db execute` (sys db protected, used `test` db)
- Rewrote prisma/schema.prisma: provider mysql, models: User (deviceHash unique = device lock), Session, DailyCredit (@@unique userId+date), ApiKey, Setting, Book, Chapter, Chunk (embedding Json, embedded flag), Question
- .env: TiDB DATABASE_URL (sslaccept=strict), ADMIN_EMAIL=admin@tutor.bd, ADMIN_PASSWORD=admin1234
- Fixed stale shell env DATABASE_URL (old sqlite) that blocked db:push; killed+restarted dev server clean
- `bun run db:push` → schema synced to TiDB studentdb, client regenerated
- Installed: katex, remark-math, rehype-katex, @types/katex (react-markdown already present)

Stage Summary:
- DB layer fully on TiDB Serverless `studentdb`, zero local sqlite
- One-device-one-account enforced by User.deviceHash @unique
- Daily credits keyed by date string (Asia/Dhaka) → midnight auto-reset

---
Task ID: 3-a
Agent: main (Z.ai Code)
Task: Complete backend (auth, credits, key-pool, Gemini, RAG, admin APIs)

Work Log:
- src/lib/password.ts (scrypt hash/verify), tz.ts (todayDhaka, startOfDhakaDay), settings.ts (cached, configurable chatModel/embeddingModel/dailyCredits), credits.ts (consume/refund), session.ts (DB-backed httpOnly cookie sessions), types.ts, bn.ts (toBn, SUBJECTS), api.ts (client fetch wrapper)
- src/lib/keypool.ts: round-robin + auto-failover (429/5xx→next key; 401/403→auto-deactivate key; NO_KEYS/KEY_POOL_EXHAUSTED errors)
- src/lib/gemini.ts: batchEmbedContents (3072-dim, RETRIEVAL_DOCUMENT/QUERY), generateContent with Bengali tutor system prompt (step-by-step, LaTeX $..$/$$..$$, real-life examples, book references)
- src/lib/chunk.ts: paragraph/sentence chunking ~850 chars + page estimation (1500 chars/page)
- src/lib/rag.ts: in-memory chunk cache (TTL 2min) + cosine similarity top-3 retrieval, threshold 0.3, subject filter
- API routes: auth/signup (device lock 409 DEVICE_EXISTS), auth/login (403 DEVICE_MISMATCH, admin exempt), auth/logout, auth/me, chat (credits→embed→RAG→keypool→generate→save, refund on fail), chat/history, admin/keys (GET/POST/PATCH + DELETE [id]), admin/books (GET/POST auto-chunking + DELETE [id]), admin/embed (batch 20, take 100/run), admin/stats, admin/settings (GET/PUT)
- Fixed: removed invalid export from settings route; Chapter orderBy createdAt→title; prisma regenerate
- tsc clean (only pre-existing examples/skills errors remain)

Stage Summary:
- Full backend live on port 3000 (dev). API contract types in src/lib/types.ts, client helper src/lib/api.ts, bn.ts shared utils
- Default admin seeded lazily on first login/signup: admin@tutor.bd / admin1234
- Models configurable via admin settings (defaults: gemini-2.5-flash-lite, gemini-embedding-001)

---
Task ID: 3-c
Agent: frontend-styling-expert
Task: Admin panel UI (keys pool, knowledge base, stats, settings)
Work Log:
- Read worklog + verified live API contract by reading src/app/api/admin/* route sources (keys/books/embed/stats/settings) and src/lib/{api,types,bn}.ts before building
- admin-view.tsx: sticky header (ShieldCheck in emerald-600 rounded square, "অ্যাডমিন ড্যাশবোর্ড" + email hidden sm:block, ghost LogOut h-11 w-11 with rose hover), shadcn Tabs defaultValue="keys", 4 triggers (KeyRound/Library/BarChart3/Settings + Bengali labels, active = emerald-50/emerald-700), TabsContent mount-on-demand (Radix unmounts inactive), max-w-4xl px-4 py-6 container, subtle framer-motion fade-in on main
- keys-tab.tsx: emerald info Alert (exact spec copy), add form Card (Label+Input label; password-style key Input font-mono with Eye/EyeOff h-11 w-11 toggle) → POST /api/admin/keys then refresh; list Card max-h-96 divide-y overflow-y-auto rows: emerald/rose status dot, label|"লেবেল নেই", masked font-mono text-xs, toLocaleDateString('bn-BD') date, lastError in rose text-xs "শেষ এরর: ...", Switch (data-checked emerald) → PATCH, Trash2 two-click confirm (first click → rose "নিশ্চিত?" button, 3s setTimeout reset) → DELETE /api/admin/keys/{id}; separate listError/actionError rose Alerts; skeleton loading + Bengali empty state
- books-tab.tsx: add-book Card (title Input, subject Select from SUBJECTS, board Input placeholder NCTB) + chapter section (title, number min=1, pageStart min=1, Textarea rows=10 with exact spec placeholder); chapters accumulate as DraftChapter[] state rendered as emerald outline Badges with X remove; "অধ্যায় যোগ করো" validates (title required, content ≥50 chars — mirrors backend 400); "বই সংরক্ষণ করো" → POST /api/admin/books → clear form + success Alert + refresh; books list: Card per book (title font-semibold, subject Badge emerald-100, board text-xs), chapter rows inside max-h-96 overflow-y-auto: "অধ্যায় {n}. {title}" (toBn), "চাঙ্ক: {x}/{y} এমবেডেড" + Progress (h-2 bg-emerald-100); per-book embed Button (Sparkles / Loader2 spinner while running, disabled when busy or allEmbedded, label "আরও এমবেড করুন" when remaining>0) → POST /api/admin/embed {bookId} then refresh; inline result "{n}টি এমবেড হলো, বাকি {m}" (amber if remaining>0 else emerald); 503 NO_KEYS/KEY_LIMIT → rose Alert with backend Bengali message; Trash2 two-click delete same pattern
- stats-tab.tsx: GET /api/admin/stats; grid-cols-2 sm:grid-cols-3 gap-3 of 6 Cards — মোট শিক্ষার্থী(Users), আজকের প্রশ্ন(MessageSquare), মোট প্রশ্ন(HelpCircle), মোট চাঙ্ক(Database), এমবেডেড চাঙ্ক(CheckCircle2), সক্রিয় কী(KeyRound "{activeKeys}/{totalKeys}") — icon in h-10 w-10 emerald-100 rounded-lg, toBn big bold values; RefreshCw button (Loader2 spin) + setInterval 30s auto-refresh with clearInterval cleanup
- settings-tab.tsx: GET /api/admin/settings → skeleton; Card form: চ্যাট মডেল + এমবেডিং মডেল (font-mono inputs) + দৈনিক প্রশ্ন কোটা (number 1–1000, client validation) with the three spec helper texts (text-xs text-stone-500); Save → PUT → syncs to returned settings + emerald Alert "সেভ হয়েছে ✓" auto-hides after 4s (cleared on edit)
- tsc --noEmit: ZERO errors in src/components/tutor/** (also clean under --noUnusedLocals/--noUnusedParameters); remaining errors only in src/lib/device.ts (backend agent's file, untouched per constraint) and examples/skills (ignored)
Stage Summary:
- Admin panel UI complete: 5 client components under src/components/tutor/admin/, all Bengali copy, emerald-600 primary / amber-500 accents / stone neutrals / rose errors, white rounded-2xl border-emerald-100 shadow-sm cards, h-11 touch targets, mobile-first stacking, max-h-96 scroll lists, skeleton loaders, rose Bengali error Alerts via shared api()/ApiError
- Exported signatures: AdminView({ user: UserInfo, onLogout: () => void }) in admin-view.tsx; KeysTab() in keys-tab.tsx; BooksTab() in books-tab.tsx; StatsTab() in stats-tab.tsx; SettingsTab() in settings-tab.tsx (tab components take no props, self-fetching)
- API contract fully matched spec — no mismatches (embed route's KEY_POOL_EXHAUSTED surfaces as code KEY_LIMIT/503 per spec; PUT settings clamps quota 1–1000 server-side, mirrored client-side)
- Two-click delete confirm implemented per-tab (confirmId + 3s timeout ref), not extracted into a shared hook to respect the 5-file constraint
---
Task ID: 3-b
Agent: frontend-styling-expert
Task: Auth view + student chat UI (device fingerprint, speech, KaTeX messages)
Work Log:
- Verified ui/ exports (button, input, textarea, card, badge, tabs, select, label, skeleton, alert) and backend contract via src/lib/{api,types,bn}.ts + chat route (NO_CREDITS carries credits in error payload)
- src/lib/device.ts: getDeviceHash() — UA+lang+cores+screen+DPR+tz+canvas(বাংলা টেক্সট+রঙিন ব্লক, toDataURL)+WebGL renderer/vendor জোড়া করে SHA-256 (crypto.subtle) → 64-hex; crypto.subtle না থাকলে 8×স্যাল্ট FNV-1a ফলব্যাক; memoized in module + localStorage('zai_device_hash')
- src/lib/speech.ts: Web Speech API shim without `any` (narrow *Like interfaces, numeric index signatures, ctor via `window as unknown as {SpeechRecognition?, webkitSpeechRecognition?}`); isSttSupported/startListening (bn-BD, interimResults=false, maxAlternatives=1, Bengali error map, stop handle) / isTtsSupported/speakBengali (strips $$..$$, $..$, ```code```, markdown symbols; bn* voice, rate 0.95, optional onEnd callback for speaking-state UI) / stopSpeaking
- src/components/tutor/auth-view.tsx: hero (GraduationCap emerald circle, H1, subtitle, 4 feature chips Zap/BookOpen/Mic/Sigma), device-verify Badge (ShieldCheck, pending→ready), Tabs লগইন/সাইন-আপ with h-11 inputs, Bengali client-side validation (name≥2, password≥6 via toBn), rose Alert with DEVICE_EXISTS/EMAIL_EXISTS/DEVICE_MISMATCH mapping, footer one-device note
- src/components/tutor/chat-view.tsx: h-dvh flex-col — sticky header (credits Badge আজ: বাকি/মোট প্রশ্ন বাকি, admin ∞, subject Select সব বিষয়+SUBJECTS, h-11 logout w/ POST /api/auth/logout), flex-1 min-h-0 scroll area (max-w-2xl), sticky footer input w/ safe-area pb, Textarea Enter=send (isComposing guarded) Shift+Enter newline, mic (STT-supported only; pulsing rose while listening + শুনছি label), send button disabled while empty/loading, typing dots (CSS bounce), NO_CREDITS → system message + 🌙 কাল রাত ১২টায়… + credits sync from error.data.credits, 3 suggestion chips on empty state, history load (HistoryMessage → user+tutor pairs, welcome fallback, skeleton while loading)
- src/components/tutor/message-bubble.tsx: user (emerald-600, rounded-br-sm), tutor (white card, ReactMarkdown+remarkMath+rehypeKatex{throwOnError:false}, custom components map p/ul/ol/li/strong/code/pre/h1-h3/a/table, overflow-x-auto wrapper, 'katex/dist/katex.min.css' imported here since globals.css lacks it), amber reference chips ({book} • {chapter} • পৃষ্ঠা toBn) + Volume2/Square TTS button (speaking state via onEnd), system → centered amber notice; framer-motion fade-in (opacity+y, 0.22s)
- Fixed: ChatMessage = MessageBubbleData & {id}; WebGL getContext union cast; removed effect-setState (react-hooks/set-state-in-effect) by always rendering TTS button with runtime guard
- bunx tsc --noEmit → 0 errors; bunx eslint on all 5 files → 0 problems; no blue/indigo/violet anywhere
Stage Summary:
- Exported: getDeviceHash(): Promise<string> (lib/device.ts); isSttSupported(), startListening(opts:{onResult,onError,onEnd}): {stop}|null, isTtsSupported(), speakBengali(text, onEnd?), stopSpeaking() (lib/speech.ts)
- Exported: AuthView({onSuccess: (user: UserInfo, credits: Credits) => void}) — src/components/tutor/auth-view.tsx
- Exported: ChatView({user: UserInfo, onLogout: () => void}) — src/components/tutor/chat-view.tsx (renders /api/auth/me once on mount to hydrate initial credits; calls POST /api/auth/logout before onLogout())
- Exported: MessageBubble({message: {role:'user'|'tutor'|'system', text, references?}}) + type MessageBubbleData — src/components/tutor/message-bubble.tsx
- Notes: credits badge shows remaining/limit ("আজ: {limit-used}/{limit} প্রশ্ন বাকি") per spec parenthetical; NO_CREDITS extra line uses error limit (default ৩০); page.tsx still needs wiring: AuthView/ChatView swap (owned by main agent)
Task ID: 4
Agent: main (Z.ai Code)
Task: Integration wiring + e2e verification + hybrid AI engine

Work Log:
- Wired src/app/page.tsx (stage machine: loading→guest→student/admin) + layout.tsx (Hind Siliguri Bengali font, lang=bn, KaTeX CSS)
- globals.css: font tokens (--font-hind), emerald primary (oklch), custom scrollbar, katex-display overflow
- Dispatched subagents 3-b (auth+chat UI) & 3-c (admin UI) — both delivered, tsc+eslint clean
- e2e via agent-browser: signup → chat UI ✓, logout → admin login ✓, 3 real Gemini keys added via UI ✓, sample NCTB book added (4 chunks) ✓, device-lock test → DEVICE_EXISTS blocked ✓, stats live ✓, mobile viewport ✓
- DISCOVERY: user provided 3 NEW-format Gemini keys (নতুন AQ. ফরম্যাট — রিড্যাক্টেড) — valid, but sandbox egress IP is Hong Kong → Gemini free tier geo-blocked ("User location is not supported"); also gemini-2.5-flash-lite retired for new users → default chatModel now gemini-3.5-flash-lite (per Google's error message)
- Switched gemini.ts to x-goog-api-key header auth (works for both AIza and AQ. formats) + GEO_BLOCKED detection (451)
- Added CIRCUIT BREAKER to keypool (engineDownUntil 2min after geo-block/pool-exhaustion)
- Added z-ai fallback engine (src/lib/zai.ts + src/lib/ai-engine.ts): chat always answered; generation prefers Gemini pool, falls back to z-ai
- Added TF-IDF lexical retrieval fallback in rag.ts (Bengali tokenizer, stopwords, IDF, rare-term scoring) — vector→lexical auto-fallback keeps book references working without embeddings
- chat route: retrieval never blocks answer; engine field in response; refunds on failure
- Fixed: duplicate invalidateChunkCache; empty-bubble artifact during loading (typing dots only); weak-match hallucination (scoring: 2+ terms OR rare term, score>0.8)
- Verified real E2E: "আর্কিমিডিসের সূত্র" → Bengali step-by-step + 📖 reference (পৃষ্ঠা ৪২-৪৮ chips) + credits 30→29→28→26 + history persisted in TiDB; quadratic question → KaTeX rendered ($x^2$, $x=2$, $x=3$); photosynthesis → correct chapter/page citation + chips
- tsc + eslint clean; dev server healthy

Stage Summary:
- FULL SYSTEM WORKING E2E in browser verification
- Gemini key-pool = production path (US/EU deploy); z-ai + lexical = sandbox/anywhere fallback — students NEVER blocked
- Admin creds: admin@tutor.bd / admin1234 (from env)

---
Task ID: 5
Agent: main (Z.ai Code)
Task: Direct PDF upload from admin panel — "upload korlam, baki sob automatically holo"

Work Log:
- User request: admin panel থেকে সরাসরি PDF আপলোড → টেক্সট এক্সট্র্যাক্ট → অধ্যায় চেনা → চাঙ্ক → এমবেড → DB, সব অটোমেটিক। Also raised size limit 30MB→150MB per user request.
- Installed: unpdf (pdf.js text extraction), pdf-lib + @pdf-lib/fontkit + regenerator-runtime (test-PDF generation only)
- next.config.ts: serverExternalPackages ["unpdf"]
- src/lib/chunk.ts: added chunkPages() — page-aware sentence chunking (দাঁড়ি/বিরাম boundaries), target ~850 chars, closes chunks at page boundaries → real page numbers on every chunk
- src/lib/pdf.ts (new): extractPdfPages() — per-page text, Bengali visual-order fix (ি/ে/ৈ pre-base reorder "গিত"→"গতি", ো/ৌ rejoin), NUL/control-char cleanup (যুক্তবর্ণ glyphs extract as \u0000!), halant-gap space removal (newline-safe), header/footer de-dup (lines on ≥60% pages dropped), page-number-line drop, mangle-proof chapter detection (squashed-line prefix match on অধ্যায়/অধায়/অধযায়/পাঠ/ইউনিট/chapter/unit variants + TOC-line rejection via trailing digits) → sections [{title, number, startPage, endPage}]; fallback = single "সম্পূর্ণ বই" section
- src/lib/book-jobs.ts (new): background auto-embed job — fire-and-forget loop (take 100, batch 20, 300ms pause), round-robin keypool failover, stops silently on NO_KEYS/GEO_BLOCKED/KEY_POOL_EXHAUSTED (partial progress saved), invalidateChunkCache on finish; isAutoEmbedding() exposed
- POST /api/admin/books/upload (new, runtime nodejs): multipart FormData; validations (%PDF magic, 150MB cap, NEEDS_OCR detection when totalChars<120, PDF_BROKEN, EMPTY_CONTENT); bulk insert via createMany (fast for big books); rollback book on failure; responds {book, pageCount, chunkCount, autoEmbed:true} then startAutoEmbed(bookId)
- GET /api/admin/books: + autoEmbedding flag per book; types.ts BookInfo.autoEmbedding?
- books-tab.tsx rewritten: mode toggle (PDF আপলোড default / ম্যানুয়াল লেখা), drag-drop zone + hidden file input + file chip (name/size), optional subject/board, 150MB client validation, processing states ("বই পড়া হচ্ছে…"), success alert with page/chunk counts, 4s polling while any book.autoEmbedding, live "স্বয়ংক্রিয় এমবেড হচ্ছে…" badge, embed button disabled during auto-embed; manual form unchanged
- Debugged dev-server restart env leak: stale shell DATABASE_URL (sqlite) overrode .env TiDB → restarted with `env -u DATABASE_URL`
- Test assets: Noto Sans Bengali fonts installed (~/.local/share/fonts), test book PDF generated via chromium print-to-pdf (mangled case) AND pdf-lib (clean logical case) at /home/z/tmp-tutor/
- Verified: 5-page PDF → 3 chapters auto-detected (গতি/কোষ ও কোষ বিভাজন/আলো) → 8 chunks with real page numbers → auto-embed job ran (stopped GEO_BLOCKED as designed in HK-egress sandbox) → chat Q&A returns references from uploaded PDF (biggan-book/গতি/পৃষ্ঠা ১) via lexical fallback
- Agent-browser E2E: login → PDF mode UI → UI file upload → "প্রসেস হচ্ছে..." → success alert "৫ পৃষ্ঠা থেকে ৮টি চাঙ্ক" → 3 book cards persisted after re-login → mobile 375px no overflow → zero console errors

Stage Summary:
- FEATURE COMPLETE: admin uploads PDF → everything else automatic (extract→chapters→chunks w/ real pages→TiDB save→background auto-embed)
- Size limit now 150MB (both ends)
- Bengali visual-order PDFs handled best-effort; clean logical-order PDFs (NCTB-style) extract near-perfect
- Geo-block note unchanged: embeddings need US/EU deployment; chat never blocked (z-ai + TF-IDF fallback)
- Default subject for PDF upload = সাধারণ (or admin-chosen); board default NCTB
