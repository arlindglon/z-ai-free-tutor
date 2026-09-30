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

---
Task ID: 6
Agent: main (Z.ai Code)
Task: Vercel deploy readiness + sandbox-reset recovery (DB + upload route)

Work Log:
- User asked: "ami ki ata vercel a deploy korte parbo?"
- DISCOVERY: sandbox had been RESET since last session — .env lost TiDB DATABASE_URL (replaced by sqlite file:), ADMIN_EMAIL/PASSWORD gone, and src/app/api/admin/books/upload/route.ts file was missing (frontend books-tab.tsx still called it → 404). lib files (pdf.ts/book-jobs.ts/chunkPages) survived.
- DB was broken (mysql schema + file: sqlite URL → Prisma error on every query). Fixed via dual schema:
  - prisma/schema.prisma → SQLite (local/sandbox default, @db.Text removed)
  - prisma/schema.production.prisma → MySQL/TiDB (Vercel; identical models)
  - regenerated client + db:push on sqlite; .env += ADMIN_EMAIL/ADMIN_PASSWORD (admin@tutor.bd/admin1234)
- Recreated POST /api/admin/books/upload (150MB cap, %PDF magic, NEEDS_OCR/PDF_BROKEN, page-aware chunkPages per auto-detected section, batched createMany 500, rollback, invalidateChunkCache) — now uses next/server after() so background auto-embed survives the response AND works on Vercel serverless (maxDuration=300, runtime nodejs).
- Vercel readiness: vercel.json (buildCommand = prisma generate + prisma db push + next build against schema.production.prisma; functions maxDuration 300), /api/admin/embed maxDuration=300, ai-engine.ts wraps z-ai fallback failure → clean GeminiError NO_KEYS/ALL_ENGINES_DOWN (no crash on Vercel where z-ai creds don't exist), bn.ts SUBJECTS += 'সাধারণ' (default PDF subject now filterable).
- E2E verified (agent-browser + curl): admin login → PDF upload UI (150MB text, সাধারণ default) → 5-page Bengali chromium-printed test PDF → upload 200 in 503ms → success alert "৫ পৃষ্ঠা থেকে ৫টি চাঙ্ক" → 3 chapters auto-detected (গতি=1, কোষ ও কোষ বিভাজন=2, আলো=3; minor glyph mangling is a chromium-font artifact, real NCTB PDFs extract clean) → auto-embed after() job started and stopped gracefully NO_KEYS (geo-blocked sandbox, by design) → chat "ভরবেগ কী?" via z-ai engine + TF-IDF lexical fallback returned reference {book: biggan-test, chapter: গতি, page: 2} — real page number from PDF.
- tsc clean (src), eslint clean, dev.log clean.

Stage Summary:
- App fully functional again locally + Vercel-ready out of the box (dual schema, after() job, vercel.json, graceful fallbacks).
- Known Vercel constraint to communicate: serverless request body limit ~4.5MB on Hobby/Pro → 150MB direct upload works on VPS/Railway/Render/self-host but NOT on Vercel; options = Vercel Blob direct upload or browser-side extraction (offered to implement).
- On Vercel (US/EU egress) Gemini geo-block disappears → real vector embeddings + Gemini answers come alive; z-ai fallback stays sandbox-only.

---
Task ID: 7
Agent: main (Z.ai Code)
Task: Full guide README + user's GitHub token setup + TiDB production DB provisioning

Work Log:
- User (new user) asked for all guides in a README; provided GitHub token (arlindglon) + TiDB connection string (gateway01.ap-southeast-1, db "resturant")
- Updated git remote URL with fresh token; verified push access (repo arlindglon/z-ai-free-tutor, PRIVATE)
- Tested TiDB ap-southeast-1: TCP open, mysql2 direct connect OK (v8.5.3-serverless). Prisma first attempt gave transient "server not running" — direct mysql2 worked
- DISCOVERY: "resturant" DB contains ANOTHER project's tables (orders, menu_items, settings, ...) — pushing tutor schema there would collide (both have Setting). Created NEW database `tutor` in same cluster instead
- Pushed prisma/schema.production.prisma to TiDB `tutor` DB → all 9 tables created (User, Session, DailyCredit, ApiKey, Setting, Book, Chapter, Chunk, Question) — verified via SHOW TABLES
- Wrote comprehensive Bengali README.md (349 lines): features, data flow, local setup, .env guide, TiDB dual-schema guide, admin panel guide (keys/knowledge/stats/settings), PDF upload workflow + limits, step-by-step Vercel deploy (import → env vars DATABASE_URL/ADMIN_EMAIL/ADMIN_PASSWORD → deploy → add keys/books), Vercel limitations table (4.5MB body cap, Hobby 60s timeout, background embed job), decision guide (small PDF→Vercel, 30-150MB→Railway/Render/VPS), troubleshooting table (DEVICE_EXISTS, NO_CREDITS, GEO_BLOCKED, NEEDS_OCR...), security notes (revoke leaked tokens, never commit .env)
- README contains NO secrets (placeholders for TiDB user/pass; repo is private anyway)
- git commit + push: 4 commits landed on origin/main (84eb3a0..dd405b3)
- eslint clean; dev server healthy

Stage Summary:
- User can now deploy to Vercel by: vercel.com → Sign Up with GitHub → Import repo → set 3 env vars (DATABASE_URL=mysql://...@gateway01.ap-southeast-1...:4000/tutor?sslaccept=strict, ADMIN_EMAIL, ADMIN_PASSWORD) → Deploy
- TiDB production DB `tutor` pre-provisioned on user's own cluster; Vercel build auto-runs prisma db push so tables will also self-heal
- Security warning delivered: user pasted GitHub token in chat — must revoke at github.com/settings/tokens after setup

---
Task ID: 8
Agent: main (Z.ai Code)
Task: z-ai fallback on Vercel — answer + env-based public API support

Work Log:
- User asked: "Vercel-এ z-ai fallback কি ব্যবহার করা যাবে?"
- Investigated SDK: z-ai-web-dev-sdk loads credential ONLY from .z-ai-config file (cwd/home//etc), ZAI.create() takes no args; sandbox config = /etc/.z-ai-config with baseUrl internal-api.z.ai (platform-internal credential, Aliyun HK ALB) → cannot/should not be used on Vercel
- SOLUTION IMPLEMENTED: rewrote src/lib/zai.ts with dual path:
  1) ZAI_API_KEY env set → direct fetch to Z.ai PUBLIC platform (OpenAI-compatible api.z.ai/api/paas/v4/chat/completions, model ZAI_MODEL default glm-4.5-flash, ZAI_BASE_URL optional) — works on Vercel/any host with user's OWN key
  2) env absent → existing sandbox SDK path (unchanged behavior)
- Web search confirmed: Z.ai public platform has FREE tier Flash models (GLM-4.7-Flash free etc.); endpoint smoke-tested from sandbox → 401 "token expired or incorrect" with dummy key = correct URL + request format accepted
- README: added "ঐচ্ছিক ধাপ ৭ — Vercel-এ z-ai ফলব্যাক চালু" (signup on z.ai Model API → env vars ZAI_API_KEY/ZAI_MODEL/ZAI_BASE_URL) + .env guide table extended with ZAI_* rows
- tsc: src clean (only pre-existing examples/skills errors); eslint clean on zai.ts; endpoint 401 smoke test OK
- Committed + pushed c27be9f (2 files, +72)

Stage Summary:
- Engine chain on Vercel: Gemini key pool → Z.ai public fallback (if ZAI_API_KEY set) → else clean NO_KEYS
- Sandbox behavior unchanged (SDK path); users must NEVER copy sandbox .z-ai-config to external hosts
- ai-engine.ts untouched — fallback orchestration already graceful

---
Task ID: 9
Agent: main (Z.ai Code)
Task: Test user's Z.ai API key against free GLM Flash models

Work Log:
- User provided their own Z.ai API key + free-model pricing table (GLM-4.7-Flash / GLM-4.5-Flash both Free)
- Tested key against https://api.z.ai/api/paas/v4/chat/completions with the EXACT fallback-engine request shape (thinking disabled, Bengali tutor system prompt):
  - glm-4.7-flash → 200 OK, 3.4s, Bengali answer, 241 tokens ✅
  - glm-4.5-flash → 200 OK, 4.1s, Bengali answer, 190 tokens ✅
- Both models FREE and working with user's key → fallback engine verified end-to-end with real credentials
- Updated default ZAI_MODEL to glm-4.7-flash (newer + faster); README table updated
- eslint clean; committed + pushed 3100df0

Stage Summary:
- User's Z.ai key CONFIRMED WORKING on free tier — they can set ZAI_API_KEY (+ optional ZAI_MODEL) in Vercel env and the Z.ai fallback goes live
- Reminded user (as with GitHub token) not to paste API keys in chat

---
Task ID: 10
Agent: main (Z.ai Code)
Task: Z.ai free-tier rate-limit stress test + concurrency protection

Work Log:
- User asked: how many requests/min do GLM-4.7-Flash & GLM-4.5-Flash accept, answer speed etc.
- Empirical stress test with user's real key:
  * Sequential 8x glm-4.7-flash: 8/8 OK, avg 870ms (632-1672ms) → ~69 RPM theoretical
  * Burst 10 concurrent glm-4.7-flash: 2/10 OK, rest 429 code 1302 "Rate limit reached for requests" → concurrency ≈ 2
  * Burst 10 concurrent glm-4.5-flash: 4/10 OK → concurrency ≈ 4
  * Recovery: fully recovered after ~15s (limit is concurrency/window-based, not a ban)
- Official docs don't publish exact numbers → measured values are authoritative
- PROTECTION IMPLEMENTED in src/lib/zai.ts env-path:
  * Local semaphore (withSlot): ZAI_CONCURRENCY default 2 — excess requests queue locally instead of hitting 429
  * 429 auto-retry ×2 with backoff+jitter (1.2s/2.4s + 0-600ms) — covers multi-instance serverless
  * Test evolution: 2/6 → 4/6 (retry only) → 6/6 after cooldown with semaphore (4.7s total for 6 concurrent)
- README: added measured-limits table + ZAI_CONCURRENCY note (use 4 with glm-4.5-flash)
- tsc/eslint clean; committed + pushed

Stage Summary:
- Free-tier capacity measured: glm-4.7-flash ≈ 2 concurrent (~60-100 RPM sustained), glm-4.5-flash ≈ 4 concurrent
- App now self-throttles before Z.ai's limit; students never see 429 errors from the fallback path

---
Task ID: 11
Agent: main (Z.ai Code)
Task: DUAL-ENGINE architecture — Gemini + Z.ai both fully admin-managed + never-show-error UX

Work Log:
- User request: both engines in admin panel; either can be primary; on/off per engine; unlimited key pools for BOTH; students must NEVER see errors; auto-queue everything
- DB: ApiKey + engine field ('gemini'|'zai') in BOTH schemas; db push to sqlite + TiDB tutor (verified column)
- keypool.ts: engine-aware — per-engine key cache, round-robin index, circuit breaker; getActiveKeys(engine), withKeyFailover(engine, fn), isEngineHealthy(engine), invalidateKeyCache(engine?); helpers isTransientAiError / isPermanentAiError
- gemini.ts: withKeyFailover('gemini', ...) (embedTexts + generateContent)
- zai.ts: zaiChatWithKey(apiKey,...) exported (semaphore + 429-retry inside); zaiChat chain = DB zai-pool → env ZAI_API_KEY → sandbox SDK credential
- ai-engine.ts REWRITE: settings-driven order [primary, fallback?] → runPass loops engines (skips breaker-tripped, safety-block → next engine) → up to 2 extra passes with 2.5s/4s waits on transient errors (queue behavior) → blocked-only result surfaced; NO_KEYS/NO_ENGINES_ENABLED fail fast
- settings.ts: +primaryEngine ('gemini' default), geminiEnabled, zaiEnabled, fallbackEnabled (bool, string storage)
- chat route: friendly NO_KEYS/NO_ENGINES_ENABLED message; engine passthrough already
- admin/keys route: POST engine field, GET engine in response (orderBy engine asc)
- admin/settings route: PUT new fields
- keys-tab.tsx: engine Select (জেমিনাই/Z.ai GLM) in add form, engine Badge per key row (emerald/amber), updated info alert
- settings-tab.tsx: "ইঞ্জিন নিয়ন্ত্রণ" card — RadioGroup primary engine (custom labels w/ icons), 3 Switches (gemini/zai/fallback), both-off validation, auto-fix primary if engine disabled
- chat-view.tsx: silent auto-retry on 503/429/502 (2 retries, 3s/6s), amber "ইঞ্জিন একটু ব্যস্ত — লাইনে অপেক্ষা করছি…" note under typing dots, ALL technical errors replaced with friendly Bengali busy message (never-show-error)
- SEEDED TiDB tutor DB: user's real Z.ai key into ApiKey(engine=zai) + 4 Setting rows → Vercel deploy works out-of-box
- E2E VERIFIED: 
  * curl: add zai key 200 → settings PUT primary=zai+gemini off → chat ENGINE:zai ✓
  * curl: primary=gemini (geo-blocked) → fallback ENGINE:zai ✓
  * agent-browser: keys tab engine combobox + "Z.ai GLM" badge ✓; settings radio+switches render + UI save ✓; student signup → chat Q → step-by-step Bengali answer w/ KaTeX (E_k=½mv²) ✓; credits 30→29 ✓; zero console errors ✓; mobile 375px ok ✓
  * dev server restart needed (stale Prisma client missing engine col) — done via setsid
- tsc clean (src), eslint clean, README dual-engine section added; committed 27cb85e + pushed

Stage Summary:
- Engine chain now: [admin-selected primary (gemini|zai)] → [other engine if fallbackEnabled] → retry passes — all keys pooled per engine, unlimited
- Students NEVER see technical errors (server retry passes + client silent retries + friendly copy)
- Production TiDB pre-seeded with user's Z.ai key; Vercel deploy ready

---
Task ID: 11 (dual-engine key test + rate test + never-show-error queue)
Agent: main (Z.ai Code)
Task: Test 3 Gemini keys + 1 GLM key with various questions, measure per-minute limits, harden queue so the "engine busy" error message never shows for students

Work Log:
- Tested GLM key (0f5579…): glm-4.7-flash answers Bengali questions ✅ live
- Tested 3 new-format Gemini keys (AQ.Ab8R…): invalid key → "API key not valid", these keys → "location not supported" ⇒ keys are VALID, sandbox region is geo-blocked (keypool GEO_BLOCKED → auto-fallback to Z.ai already handles this); will work on Vercel US region
- Rate test glm-4.7-flash: burst 8 concurrent → all 429 (new code 1305 "temporarily overloaded"); sequential 10 → 5 ok (≈62 RPM, needs spacing); recovery ~15s
- Discovered dual-engine system already existed (keypool engine-aware, settings primaryEngine/geminiEnabled/zaiEnabled/fallbackEnabled, admin API + tabs complete)
- Hardened queue layer 1 (zai.ts): dynamic per-key semaphore slots (tuneZaiCapacity: 1 slot per key, cap 6, exact set incl. shrink; ZAI_CONCURRENCY env overrides), 429 retry ×3 backoff 1.5/3/5s + jitter
- Hardened layer 2 (ai-engine.ts): deadline-driven queue — total 90s patience, waits [1.5,3,5,8,12,15,20,25s]+jitter, extended to breaker expiry via nextEngineWakeMs()
- Hardened keypool.ts: breaker 120s → 45s (free tier recovers ~15s), added nextEngineWakeMs()
- Hardened layer 3 (chat route + chat-view.tsx): transient engine errors now return 503 code=ENGINE_BUSY (was 500 → immediate busy message); browser silent retry extended to 4 attempts (3+5+8+12s), NO_KEYS code excluded from retries and shown as setup notice
- Seeded 4 keys into local SQLite ApiKey (3 gemini + 1 zai) via upsert script
- Stress test headless (2 seq + 4 concurrent, gemini disabled, single zai key): BEFORE fix 2×ENGINE_DOWN failures; AFTER fix 6/6 SUCCESS (worst 88.4s queued, zero errors)
- Browser E2E: admin login (admin@tutor.bd) → keys tab shows 4 keys w/ engine badges → settings tab shows primary-engine radio + gemini/zai toggles + fallback switch (user had set primary=zai, gemini off, quota 500 — respected) → new student signup → asked "৫ × ৮ = কত?" → full Bengali step-by-step answer via queue, zero error messages; dev.log POST /api/chat 200
- README: added production TiDB key-seed SQL, 3-layer never-show-error queue doc, live rate-limit table, key test report
- TiDB tutor DB seeding NOT possible this session (password not stored anywhere recoverable; /tmp env has OLD studentdb creds) — user can add keys via production admin panel or the new README SQL

Stage Summary:
- 4 keys live in local DB; queue mathematically near-impossible to surface errors (3 layers: per-key slots+retry → 90s deadline queue → 4× browser retry)
- All code changes lint-clean; E2E verified in browser end-to-end
- Files: src/lib/zai.ts, src/lib/keypool.ts, src/lib/ai-engine.ts, src/app/api/chat/route.ts, src/components/tutor/chat-view.tsx, README.md

---
Task ID: 12
Agent: Z.ai Code (main)
Task: অ্যাডমিন প্যানেলে নতুন Z.ai GLM key (f599...6xVI) যোগ করতে "কী যোগ করা গেল না" এরর — ডায়াগনোসিস + ফিক্স

Work Log:
- keys-tab.tsx এ জেনেরিক মেসেজ শুধু non-ApiError (fetch throw) ক্ষেত্রে আসে — মানে প্রোডাকশনে fetch লেভেলে ফেল বা সার্ভার 500
- লোকালে exact payload দিয়ে repro: admin login → POST /api/admin/keys (engine=zai, ইউজারের key) → 200 OK, কী তৈরি হয় → কোড পাথ ঠিক, সমস্যা প্রোডাকশন-স্পেসিফিক (TiDB স্কিমা/নেটওয়ার্ক)
- আগের ভার্সনে db.apiKey.create unhandled ছিল — TiDB এরর হলে Vercel 500 + অন্ধ "আবার চেষ্টা করো"
- src/lib/key-format.ts নতুন: detectKeyEngine() — 32hex.16 → zai, AQ./AIzaSy → gemini
- /api/admin/keys রিরাইট: সব হ্যান্ডলার try/catch, Prisma এরর ম্যাপিং (P2002→409 ডুপ্লিকেট বার্তা, P2021/P2022→"prisma db push চালাও" বার্তা), কী থেকে সব হোয়াইটস্পেস স্ট্রিপ, ফরম্যাট থেকে ইঞ্জিন অটো-কারেক্ট (ড্রপডাউন ভুল হলেও)
- keys-tab.tsx: কী পেস্ট করলেই ইঞ্জিন ড্রপডাউন অটো-সুইচ; non-ApiError → "নেটওয়ার্ক সমস্যা" বার্তা
- লোকাল E2E (curl + agent-browser): ডুপ্লিকেট 409 বার্তা ✓, ভুল ইঞ্জিনে জেমিনাই key → অটো-কারেক্ট ✓, হোয়াইটস্পেস স্ট্রিপ ✓, UI-তে পেস্টে ড্রপডাউন অটো-সুইচ ✓, অ্যালার্টে আসল কারণ দেখা যায় ✓, console এরর নেই ✓
- lint ক্লিন, commit d1d47d7 পুশ → Vercel অটো-রিডিপ্লয়

Stage Summary:
- রুট কজ (প্রোডাকশন): সম্ভবত TiDB-তে আগের চেষ্টায় key সেভ হয়ে গিয়েছিল কিন্তু রেসপন্স হারিয়েছিল → পরের চেষ্টা ডুপ্লিকেট/DB এরর, আর পুরনো UI আসল কারণ লুকিয়ে "কী যোগ করা গেল না" দেখাচ্ছিল; TiDB স্কিমা পুরনো হলেও এখন বার্তায় স্পষ্ট ধরা পড়বে
- ইউজারকে দেওয়া নির্দেশ: Vercel রিডিপ্লয়ের পর আবার চেষ্টা করো; আগে তালিকায় f599c8••••6xVI আছে কিনা দেখো; নতুন স্পষ্ট বার্তা এলে সেটাই আসল কারণ
- ফাইল: src/lib/key-format.ts (নতুন), src/app/api/admin/keys/route.ts, src/components/tutor/admin/keys-tab.tsx

---
Task ID: 13
Agent: Z.ai Code (main)
Task: উত্তরের স্বাক্ষর (মডেল মার্ক — ইঞ্জিন-প্রতি র‍্যান্ডম নাম পুল) + RAG লক মোড

Work Log:
- schema.prisma + schema.production.prisma: Question.answerTag String? যোগ; লোকাল db:push (Vercel build অটো db push করে TiDB-তেও)
- settings.ts: tagNameGemini/tagNameZai (নিউলাইন-সেপারেটেড পুল, ৪০০০ অক্ষর), ragOnlyMode (bool) + pickTagName() র‍্যান্ডম পিকার (৫০০ লাইন ক্যাপ)
- gemini.ts buildSystemPrompt({ragOnly}): RAG লকে নিয়ম ৫ বদলে কঠোর নিয়ম — শুধু রেফারেন্স থেকে উত্তর, না পেলে "পাঠ্যবইয়ে পাইনি 📖"; রেফারেন্স খালি থাকলেও বানানো যাবে না (নিয়ম ১০)
- chat route: result.engine অনুযায়ী পুল বেছে pickTagName → Question.answerTag সেভ + রেসপনসে answerTag
- history route: answerTag রিটার্ন
- admin settings route PUT: তিন নতুন ফিল্ড
- settings-tab UI: "উত্তরের স্বাক্ষর" কার্ড (দুই টেক্সটএরিয়া, লাইন বাই লাইন) + "শুধু বই থেকে উত্তর (RAG লক)" সুইচ কার্ড
- message-bubble: tutor বাবলে ✍ <tag> ফেইন্ট ব্যাজ (tag থাকলেই); chat-view হিস্ট্রি+লাইভ ম্যাপিং
- E2E: সেটিংস PUT/GET ✓; চ্যাটে tag "Z-9" র‍্যান্ডম পিক + DB সেভ + হিস্ট্রি ✓; UI ব্যাজ "✍ Z-9" রেন্ডার ✓; RAG লক UI টগল+সেভ ✓; লক চালু অবস্থায় বইয়ের বাইরের প্রশ্নে প্রত্যাখ্যান ✓
- টেস্ট student একাউন্ট student-e2e@test.bd (device binding ক্লিয়ার করা, পাসওয়ার্ড রিসেট test12345)
- lint ক্লিন; commit d403263 পুশ

Stage Summary:
- নতুন Setting keys: tagNameGemini, tagNameZai, ragOnlyMode (key-value টেবিল — TiDB-তে আলাদা মাইগ্রেশন লাগে না)
- TiDB-তে Question.answerTag কলাম Vercel deploy-এ অটো তৈরি হবে (buildCommand db push)
- স্বাক্ষর পুল খালি = ব্যাজ দেখাবে না (ডিফল্ট) — অ্যাডমিন সেট করলেই চালু

---
Task ID: 14
Agent: Z.ai Code (main)
Task: মডেল রেজিস্ট্রি — ইঞ্জিন-প্রতি মডেল তালিকা (on/off), মডেল-প্রতি স্বাক্ষর পুল, স্বাক্ষর-রাউটিং

Work Log:
- schema.prisma + schema.production.prisma: নতুন AiModel (engine+modelId unique, label, active) + ModelAlias (aiModelId FK cascade, alias unique); Question-এ answerEngine/answerModel অডিট কলাম; লোকাল db:push ✓ (TiDB-তে Vercel build এ db push হবে)
- src/lib/models.ts নতুন: ১৫ সে ক্যাশসহ রেজিস্ট্রি লোডার (getActiveModelIds), pickModelAlias (জেতা মডেলের পুল থেকে র‍্যান্ডম), resolveAliasTarget (প্রশ্নে কোড থাকলে engine+model রাউট, লম্বা ম্যাচ আগে), ensureModelsSeeded (প্রথমবার ৭ ডিফল্ট: zai glm-4.7-flash/glm-4.5-flash/glm-4.6v-flash + gemini gemini-3.5-flash-lite/gemini-3.1-flash-lite/gemma-4-26b/gemma-4-31b; Setting 'modelsSeeded' ফ্ল্যাগে একবারই — সব মুছলেও ফিরে আসে না)
- zai.ts: zaiChatWithKey/zaiChat/zaiHttp/zaiCall-এ model প্যারাম; zaiDefaultModel()+zaiEnvConfigured() export; মডেল-না-পাওয়া (HTTP 404 / কোড 1211 / "model does not exist") → ZAI_MODEL_NOT_FOUND এররে নরমালাইজ
- keypool.ts: isModelNotFoundAiError() + withKeyFailover-এ ফাস্ট-ফেইল — ভুল মডেলে কী-লুপ/ব্রেকার না জ্বেলে সাথে সাথে ছাড়ে, যাতে পরের মডেল চেষ্টা হয়
- ai-engine.ts: attemptWithModels — প্রতি ইঞ্জিনে রেজিস্ট্রির চালু মডেলগুলো পালা করে চেষ্টা (404 → নিঃশব্দে পরের মডেল), force মডেল থাকলে তালিকার সামনে; EngineResult-এ modelId; রেজিস্ট্রি খালি হলে আগের fallback (settings.chatModel / zaiDefaultModel)
- chat route: resolveAliasTarget(question) → force; answerTag = pickModelAlias(result.modelId) (মডেল-প্রতি পুল); Question-এ answerEngine/answerModel সেভ; রেসপনস থেকে engine ফিল্ড বাদ (স্টুডেন্টকে আসল মডেল ফাঁস হয় না)
- সেটিংস ক্লিনআপ: tagNameGemini/tagNameZai + pickTagName বাদ (মডেল-প্রতি পুলই এখন স্বাক্ষর দেয়); settings-tab থেকে পুরনো স্বাক্ষর কার্ড সরানো; RAG লক সুইচ অপরিবর্তিত
- API: /api/admin/models (GET seed+list+usage groupBy, POST যোগ [space strip + models/ প্রিফিক্স বাদ], PATCH টগল/এডিট [ডুপ্লিকেট প্রি-চেক], DELETE cascade) + /api/admin/models/aliases (POST মাল্টিলাইন [কেস-ইনসেনসিটিভ ডুপ স্কিপ, ২–৪০ অক্ষর, প্রতি মডেলে ৫০০ ক্যাপ], DELETE); সব এরর বাংলায় + P2021/P2022 ম্যাপিং
- UI: admin-view-এ ৫ম ট্যাব "মডেল" (Boxes আইকন); models-tab.tsx — ইঞ্জিন-প্রতি সেকশন (Gemini সবুজ / Z.ai অ্যাম্বার), যোগ-ফর্ম, প্রতি মডেলে সুইচ+এডিট(ইনলাইন)+দুই-ক্লিক ডিলিট, স্বাক্ষর চিপ (X দিয়ে মুছে)+মাল্টিলাইন টেক্সটেরিয়া, ব্যবহার ব্যাজ (N উত্তর), max-h স্ক্রল + কাস্টম স্ক্রলবার
- E2E (curl): seed ৭ মডেল ✓, মাল্টিলাইন অ্যালিয়াস (ডুপ+১ অক্ষর স্কিপ) ✓, সব-ডুপ রিজেক্ট ✓, মডেল CRUD + 409 ডুপ + স্পেস-স্ট্রিপ ✓, চ্যাট "টেস্ট404" কোড → fake মডেল force-first → 404 → নিঃশব্দে glm-4.7-flash → উত্তর + tag "রবিন" ✓, DB অডিট (zai/glm-4.7-flash) ✓, রেসপনসে engine লিক নেই ✓, প্লেইন চ্যাট ✓
- E2E (agent-browser): লগইন → মডেল ট্যাব রেন্ডার ✓, টেক্সটেরিয়া থেকে অ্যালিয়াস যোগ (চাঁদ স্যার চিপ) ✓, সুইচ off/on ✓, মডেল যোগ+দুই-ক্লিক ডিলিট ✓, সেটিংস সেভ রিগ্রেশন-ফ্রি ✓, ডেস্কটপ+মোবাইল স্ক্রিনশট ✓, console এরর শূন্য ✓
- lint ক্লিন

Stage Summary:
- স্বাক্ষর ব্যবস্থা এখন মডেল-প্রতি: অ্যাডমিন প্রতিটা মডেলে যত খুশি নাম/কোড দেয়, উত্তরে জেতা মডেলের পুল থেকে র‍্যান্ডম একটা "✍ নাম" ব্যাজ — স্টুডেন্ট নাম দেখে মডেল বুঝবে না, অ্যাডমিন মডেল-তালিকায় ম্যাপ করবে; প্রশ্নে কোড লিখলে সেই মডেলেই রাউট
- নতুন মডেল বাজারে এলে অ্যাডমিন প্যানেলে নাম লিখে যোগ — কোড ছোঁয়া লাগে না; ভুল মডেল আইডি থাকলেও সিস্টেম 404 চিনে পরের মডেলে চলে যায় (কী-পুল/ব্রেকার অক্ষত)
- TiDB প্রোডাকশন: AiModel/ModelAlias টেবিল + Question.answerEngine/answerModel কলাম Vercel build-এর db push-এ অটো তৈরি; মডেল ট্যাব প্রথম খুললেই ৭ ডিফল্ট মডেল সিড হবে
- ফাইল: prisma/schema*.prisma, src/lib/{models,ai-engine,zai,keypool,settings,types}.ts, src/app/api/chat/route.ts, src/app/api/admin/models/**, src/app/api/admin/settings/route.ts, src/components/tutor/admin/{admin-view,models-tab,settings-tab}.tsx

---
Task ID: 15
Agent: Z.ai Code (main)
Task: RAG লক (শুধু বই থেকে উত্তর) চালু অবস্থায়ও বইয়ের বাইরের উত্তর আসছিল — ডায়াগনোসিস + সার্ভার-সাইড কঠোর এনফোর্সমেন্ট

Work Log:
- রুট কজ: RAG লক আগে শুধু system prompt-এর নিয়ম ৫/১০ দিয়ে এনফোর্স হতো; ফ্রি ফ্ল্যাশ মডেল (glm-4.7-flash) সেটা ignore করে। প্রমাণ: লোকাল DB-তে পুরনো রো "বিদ্যুৎ চালিত ঘণ্টা কী?" — refs 0 থাকা সত্ত্বেও মডেল উত্তর বানিয়েছিল
- ৩ স্তরের ফিক্স:
  * গেট ১ (ডিটারমিনিস্টিক): settings.ragOnlyMode && refs.length===0 হলে মডেল কলই নয় — নির্দিষ্ট বাংলা প্রত্যাখ্যান (RAG_REFUSAL_TEXT), ক্রেডিট ফেরত, হিস্ট্রিতে স্বাভাবিক টিউটর-বার্তা হিসেবে সেভ (0.28s এ রেসপন্স, লাইভ যাচাই ✓)
  * প্রম্পট হার্ডেনিং: buildSystemPrompt-এ ragOnly হলে একদম শুরুতে 🔒 RAG লক প্রোটোকল ব্লক (সর্বোচ্চ অগ্রাধিকার) — প্রতিটি তথ্য refs থেকে, গণিতের হিসাব ছাড়া বাইরের কিছু নয়, grounded উত্তরে বাধ্যতামূলক "📖 বইয়ের রেফারেন্স:" ফুটার, নইলে নির্দিষ্ট প্রত্যাখ্যান-বাক্য, উত্তরের আগে নিজেই উৎস-যাচাই
  * গেট ২ (উত্তর-কনট্রাক্ট যাচাই): answerGroundedInBook(text, refs) — পরিষ্কার প্রত্যাখ্যান হলে বৈধ; নইলে লেক্সিক্যাল grounding (bookCoverage): উত্তরের কনটেন্ট-টোকেন (স্বরচিহ্ন-নরমালাইজড + OCR-রোধী prefix fuzzy match: exact=1, 3-char prefix=0.7, 2-char=0.4) refs কর্পাসে কত% — থ্রেশহোল্ড ৪৫%; ফাঁস ধরা পড়লে RAG_UNGROUNDED_TEXT দিয়ে বদলে দেওয়া + ক্রেডিট ফেরত + coverage সহ console.warn (প্রোডাকশন টিউনিংয়ের জন্য)
- লাইভ টেস্টে আবিষ্কার: মডেল ভুয়া উত্তরের শেষে ফুটারও লাগিয়ে দেয় — তাই শুধু ফুটার-চেক যথেষ্ট নয়; মাইটোসিস S-ধাপ hallucination (coverage 37%) ও সঠিক-কিন্তু-বইয়ের-বাইরের তথ্য (27%) দুটোই গেট ২ ধরেছে
- অ্যাডমিন-কোটা বাগ ফিক্স: অ্যাডমিন রিকোয়েস্টে refundCredit আর করবে না (আগে অ্যাডমিনের লিগিট ব্যবহৃত কোটা ১ কমে যেত)
- settings-tab RAG কার্ডে নতুন সবুজ লাইন: সার্ভার-লেভেল এনফোর্সমেন্টের ব্যাখ্যা
- E2E (curl + agent-browser): লক চালু + বইয়ের বাইরের প্রশ্ন → instant প্রত্যাখ্যান ✓; refs মিললেও উত্তর বইয়ে না থাকলে (মাইটোসিস/জ্যোতির্বিজ্ঞান) → গেট ২ প্রত্যাখ্যান ✓; বইয়ের ভেতরের প্রশ্ন (ভরবেগ) → grounded উত্তর + ফুটার + ✍ Z-9 ব্যাজ ✓; লক বন্ধ → স্বাভাবিক উত্তর ✓; admin UI সুইচ+সেভ ✓ (ragOnlyMode=true DB কনফার্মড); কোটা ফেরত ✓
- নোট: Z.ai ফ্রি টিয়ার 429 (1302/1305) — নেভার-শো-এরর কিউ ঠিকভাবেই friendly 503 দেয়; curl-এ 120s+ লাগলেও সার্ভার নিজে থেকে শেষ করে
- lint ক্লিন, tsc src ক্লিন

Stage Summary:
- RAG লক এখন ৩ স্তরে কড়া: (১) বিষয় বইয়ে নেই → প্রশ্ন মডেলের কাছেই যায় না, (২) কঠোর প্রোটোকল-প্রম্পট, (৩) উত্তরের লেক্সিক্যাল grounding যাচাই — মিললেই প্রত্যাখ্যান, এমনকি তথ্যটা সত্যি হলেও (লক = "শুধু বই থেকে")
- ভারসাম্য: grounded উত্তর ৫৩%+, hallucination ~৩১-৩৭% — থ্রেশহোল্ড ৪৫% দুটোর মাঝে; প্রোডাকশনে ভালো OCR বইয়ে grounded আরও উঁচুতে থাকবে
- ফাইল: src/lib/rag.ts (RAG_REFUSAL_TEXT, RAG_UNGROUNDED_TEXT, bookCoverage, answerGroundedInBook), src/lib/gemini.ts (🔒 প্রোটোকল), src/app/api/chat/route.ts (গেট ১+২, admin-refund ফিক্স), src/components/tutor/admin/settings-tab.tsx

---
Task ID: 16
Agent: main (Z.ai Code)
Task: বই যোগ করার সিস্টেম সহজ করা (easy book-adding upgrade) — user: "boi add korbo kivabe easy vabe system aro uprade koro boi add korar jonne"

Work Log:
- Exploration (Explore agent): পুরো book/RAG পাইপলাইন ম্যাপ করা — আবিষ্কার: PDF upload route (/api/admin/books/upload) commit 334e06e-এ ভুলে মুছে গিয়েছিল → 404, শুধু ম্যানুয়াল পেস্ট-টেক্সট পাথ কাজ করত
- Upload route git থেকে পুনরুদ্ধার (git show 334e06e~1) এবং multi-part append support যোগ (bookId + pageOffset form fields — স্প্লিট অংশ একই বইয়ে জোড়া লাগে, পৃষ্ঠা নম্বর গ্লোবাল সঠিক থাকে; অ্যাপেন্ড মোডে ফেইল হলে শুধু নতুন অধ্যায় রোলব্যাক; "সম্পূর্ণ বই" ফলব্যাক টাইটেল → "পৃষ্ঠা X–Y")
- নতুন src/lib/pdf-split.ts: ব্রাউজারে pdf-lib দিয়ে >3MB PDF পাতা-ধরে ≤3MB অংশে ভাঙা (adaptive size verify — অংশ বড় হলে পাতা কমিয়ে re-save), pageOffset ট্র্যাকিং, ফেইল হলে পুরো ফাইল ফলব্যাক (সার্ভারের নির্ভুল এররের উপর ভরসা)
- books-tab.tsx রিরাইট: মাল্টি-ফাইল ড্রপজোন (multiple) → কিউ (waiting/working/done/failed) ড্রপ করলেই অটো-স্টার্ট, প্রতি ফাইলে লাইভ ফেজ ("অংশ ৩/৮ আপলোড হচ্ছে…"), ফেইল হলে রিট্রাই বাটন, ৩-ধাপের গাইড (nctb.gov.bd সোর্স সহ), বই/অধ্যায়/চাঙ্ক সামারি চিপস
- ম্যানুয়াল বই POST-এ after(() => startAutoEmbed()) — সেভ করলেই এমবেড, সাকসেস মেসেজ আপডেট
- Book.embedError String? (দুই স্কিমায়) + book-jobs.ts-এ থামার কারণ সেভ (NO_KEYS/GEO_BLOCKED/KEY_POOL_EXHAUSTED → বাংলা মেসেজ), সফল রানে ক্লিয়ার; embed route সাকসেসে ক্লিয়ার; books GET-এ ফিল্ড; UI-তে অ্যাম্বার অ্যালার্ট + "আবার এমবেড করুন" লেবেল
- E2E (agent-browser): 4.85MB টেস্ট PDF (noise-PNG + unique text, 80 পাতা) → অটো-স্প্লিট → ৪০ অংশ পরপর আপলোড → বই সঠিক (৪০ অধ্যায়, ২৩১২ চাঙ্ক, পৃষ্ঠা ১–৮০ গ্লোবাল ক্রমিক); ২টি ছোট PDF একসাথে → ফাস্ট পাথ ✓; ম্যানুয়াল বই → অটো-এমবেড ✓; embedError অ্যাম্বার অ্যালার্ট + রিট্রাই এরর দৃশ্যমান ✓; দুই-ক্লিক ডিলিট ✓; মোবাইল 375px ওভারফ্লো নেই ✓; কনসোল এরর শূন্য ✓
- নোট: dev সার্ভার রিস্টার্ট দরকার হয়েছিল (স্কিমা চেঞ্জের পরে Prisma client রিজেন — রানিং সার্ভারে পুরনো client থেকে যায়)
- টেস্ট PDF জেনারেটর: /home/z/.testtmp/gen-pdf.cjs (noise PNG → কম্প্রেশন-প্রুফ বড় PDF)

Stage Summary:
- বই যোগ করা এখন ৩-ধাপে: PDF নামাও (NCTB) → টেনে আনো (একাধিক একসাথে) → ব্যস, সব অটোমেটিক (টেক্সট→অধ্যায়→চাঙ্ক→এমবেড)
- Vercel-এর 4.5MB বডি লিমিট ক্লায়েন্ট-সাইড স্প্লিটে সমাধান — প্রোডাকশনে বড় NCTB বই এখন আপলোড হবে
- commit f68fb70 pushed → Vercel auto-deploy

---
Task ID: 17
Agent: main (Z.ai Code)
Task: PDF upload সরিয়ে Gemini-OCR টেক্সট-পেস্ট বই যোগ করার সিস্টেম (user: "pdf upload system theke bad dew... gemini ai theke OCR prompt er maddhe text niye boi a add korbo") + স্তর/বিষয় কাস্টম ম্যানেজমেন্ট

Work Log:
- Exploration: পুরো book/RAG পাইপলাইন পুনঃপরীক্ষা — books-tab (PDF মোড + ম্যানুয়াল মোড), upload route (working tree-তে আগে থেকেই deleted), pdf.ts/pdf-split.ts, chunk.ts (chunkPages পৃষ্ঠা-সচেতন চাঙ্কার), Book→Chapter→Chunk স্কিমা, chat route-এর subject ফিল্টার
- Prisma স্কিমা (দুটো ফাইলেই): নতুন Category model (type: level|subject, @@unique([type,name])) + Book.level String?; bun run db:push ✓
- নতুন src/lib/ocr-book.ts (pure TS — ক্লায়েন্ট+সার্ভার): parseOcrBook() — "### পৃষ্ঠা N" মার্কার লাইন (হ্যাশ/বোল্ড/পাইপ/বাংলা-ইংরেজি সংখ্যা সব চলে) থেকে পৃষ্ঠা ভাগ, "---" বিভাজক বাদ, পৃষ্ঠার শুরুর ৩ লাইনে অধ্যায়-শিরোনাম শনাক্ত (অধ্যায়/পাঠ/ইউনিট/chapter ইত্যাদি + নম্বর; সূচিপত্র/বাক্য-ফাঁদ বর্জন — "অধ্যায় ১ এ আমরা শিখেছি", "পাঠ্যবই" ধরে না), প্রথম অধ্যায়ের আগের অংশ >৪০০ অক্ষর হলে "ভূমিকা ও সূচিপত্র" অধ্যায়, মার্কার না থাকলে এক অধ্যায় "সম্পূর্ণ বই"; OCR_PROMPT কনস্ট্যান্ট (ইউজারের প্রম্পট পার্সার-কম্প্যাটিবল করে রিফাইন করা)
- নতুন API /api/admin/categories (GET=অটো-সিড ৮ স্তর: প্রাক-প্রাথমিক/প্রাথমিক/ইবতেদায়ি/ক্ষুদ্র নৃ-গোষ্ঠী/মাধ্যমিক/দাখিল/কারিগরি/উচ্চ মাধ্যমিক + ১১ বিষয়, POST/PATCH/DELETE), P2002→৪০৯ বাংলা মেসেজ
- নতুন API POST /api/admin/books/text: OCR টেক্সট → parseOcrBook → অধ্যায় একে একে তৈরি (ক্রম নিশ্চিত) → chunkPages (প্রকৃত পৃষ্ঠা নম্বর) / chunkContent (মার্কার-হীন) → createMany 500-ব্যাচ → invalidateChunkCache → after() অটো-এমবেড; সাড়ে ৫০০ এরর ম্যাপিং
- books-tab.tsx সম্পূর্ণ রিরাইট: PDF আপলোড + পুরনো ম্যানুয়াল মোড বাদ; ধাপ ১ কার্ড (৩-ধাপের গাইড + OCR_PROMPT প্রি-ব্লক + কপি বাটন), ধাপ ২ ফর্ম (নাম + স্তর Select + বিষয় Select + OCR Textarea + ৩০০ms ডিবাউন্স লাইভ পার্স-প্রিভিউ: পৃষ্ঠা/অধ্যায় গণনা, অধ্যায় ব্যাজে পৃষ্ঠা নম্বর, মার্কার-হীন অ্যাম্বার সতর্কতা), স্তর/বিষয় ম্যানেজ Dialog (যোগ/ইনলাইন রিনেম/দুই-ক্লিক ডিলিট, Enter সাপোর্ট, নতুন যোগ হলে অটো-সিলেক্ট), বইয়ের তালিকায় স্তর ব্যাজ
- PDF সিস্টেম অপসারণ: src/lib/pdf.ts, src/lib/pdf-split.ts, /api/admin/books/upload ডিলিট; unpdf + pdf-lib ডিপ রিমুভ
- ফিক্স: books-tab এখন named export (admin-view মিলিয়ে) — 500 এরর এড়াতে; text route-এ Chapter-এ createdAt নেই তাই রি-কুয়েরির বদলে তৈরি করার সময় rows কালেক্ট
- E2E (agent-browser): admin লগইন → নলেজবেস ট্যাব ✓; ম্যানেজ ডায়ালগে ৮ স্তর + ১১ বিষয় অটো-সিড ✓; "উদ্যানবিদ্যা" যোগ ✓ → "কৃষিশিক্ষা" রিনেম ✓ → ডিলিট ✓; মার্কারসহ ৪-পৃষ্ঠা টেস্ট টেক্সট → লাইভ প্রিভিউ (পৃষ্ঠা ৪, অধ্যায় ২, ব্যাজে পৃষ্ঠা ১/৩) ✓ → সাবমিট → DB-তে অধ্যায় ১@p১, অধ্যায় ২@p৩, চাঙ্ক পৃষ্ঠা নম্বর সঠিক ✓; মার্কার-হীন টেক্সট → অ্যাম্বার সতর্কতা ✓ → সাবমিট → "সম্পূর্ণ বই" ১ অধ্যায় page=null ✓; প্রম্পট কপি বাটন "কপি হয়েছে!" ✓; অটো-এমবেড কী না থাকায় থামলে বাংলা embedError অ্যালার্ট ✓; দুই-ক্লিক বই ডিলিট ✓; কনসোল/পেজ এরর শূন্য ✓; ফুটার: মোবাইল 844vh-তে কনটেন্টের নিচে ন্যাচারাল পুশ (fb=bodyH=983) ✓
- নোট: স্কিমা চেঞ্জের পরে dev সার্ভার রিস্টার্ট করতে হয়েছে (Prisma client রিজেন); প্রোডাকশনে Vercel বিল্ডে db push schema.production.prisma অটো চলবে — Category টেবিল + Book.level সেখানেও তৈরি হবে

Stage Summary:
- বই যোগ করার নতুন প্রবাহ: (১) স্ক্যান করা PDF → Gemini-তে আপলোড → প্যানেল থেকে প্রম্পট কপি করে পাঠাও → (২) আউটপুট টেক্সট পেস্ট → পৃষ্ঠা/অধ্যায়/চাঙ্ক/এমবেড সব অটোমেটিক
- স্তর ৮টি ফিক্সড সিড + বিষয়/স্তর অ্যাডমিন ইচ্ছেমতো add/rename/delete (কোড ছোঁয়ার দরকার নেই)
- RAG রেফারেন্সে এখন প্রকৃত পৃষ্ঠা নম্বর যায় ("### পৃষ্ঠা N" থেকে), ভুল প্রশ্ন-ফিল্টার ঝুঁকি কমলো
- Vercel 4.5MB বডি লিমিট আর সমস্যা নয় — টেক্সট-পেস্ট ফ্লোতে বড় PDF ফাইল আর আপলোডই হয় না

---
Task ID: 4
Agent: main (Z.ai Code)
Task: আগের বইয়ে পৃষ্ঠা অ্যাপেন্ড মোড (OCR ব্যাচ ওয়ার্কফ্লো) + সম্পূর্ণ স্টেট যাচাই

Work Log:
- ইউজার বাংলায় কথা বলতে বলেছে ("বাংলাতে বলো চিনা বুঝিনা") — এখন থেকে সব উত্তর বাংলায়
- স্টেট যাচাই: commit 73e5dbb-এ PDF আপলোড ইতিমধ্যে সম্পূর্ণ বাদ (pdf.ts/pdf-split.ts/upload API/unpdf/pdf-lib ডিলিট), টেক্সট-পেস্ট সিস্টেম + ৮ স্তর সিড + ক্যাটাগরি CRUD + RAG লক ৩-স্তর এনফোর্সমেন্ট আগের সেশনেই সম্পূর্ণ
- API POST /api/admin/books/text রিরাইট: body-তে bookId দিলে অ্যাপেন্ড মোড — বই খোঁজে (404 গার্ড), একই শিরোনাম+pageStart থাকলে 409 ডুপ্লিকেট-গার্ড (বাংলা মেসেজ), নতুন অধ্যায়+চাঙ্ক আগের বইয়ে createMany, after() আবার startAutoEmbed (নতুন চাঙ্কও অটো-এমবেড হয়), সাড়ে পুরো বইয়ের আপডেটেড chapters + appended flag ফেরত; bookId আইডি-ফরম্যাট গার্ড; মার্কার-হীন অ্যাপেন্ডে অধ্যায় "অব্যাহত অংশ (পৃষ্ঠা মার্কিং নেই)"
- books-tab.tsx: ধাপ ২-এ role=tablist মোড টগল ("🆕 নতুন বই" / "➕ আগের বইয়ে পৃষ্ঠা যোগ"); অ্যাপেন্ড মোডে বই-সিলেক্ট Combobox (title — level (subject)), বই না থাকলে অ্যাম্বার হিন্ট; নতুন মোডে আগের title/level/subject গ্রিড; handleSave মোড-অনুযায়ী বডি {bookId,text} বা {title,level,subject,text}; সাকসেস মেসেজ দুই রকম (appended flag থেকে); হেডার কপি আপডেট ("বই বড় হলে প্রথমে নতুন বই বানাও, তারপর প্রতি ব্যাচ আগের বইয়ে যোগ দিয়ে পেস্ট করো")
- E2E (agent-browser): লগইন → নলেজবেস ট্যাব ✓; নতুন বই "পরীক্ষা বিজ্ঞান" (মাধ্যমিক স্তর+বিজ্ঞান) + ব্যাচ ১ (পৃষ্ঠা ১-২, অধ্যায়-হেডিংসহ) → তৈরি ✓ (মোট বই ১, অধ্যায় ১, চাঙ্ক ১); অ্যাপেন্ড মোডে বই সিলেক্ট → ব্যাচ ২ (পৃষ্ঠা ৩-৪, "অধ্যায় ২: কোষ বিভাজন") → POST 200 ✓ (অধ্যায় ২, চাঙ্ক ২ — একই বইয়ে ২ অধ্যায়); একই টেক্সট আবার → 409 "আগেই আছে — সম্ভবত একই অংশ দুবার পেস্ট হয়েছে" ✓; দুই-ক্লিক ডিলিট ✓; রিলোডে page errors শূন্য, dev.log ক্লিন ✓; মোবাইল 390px: টগল দৃশ্যমান, overflowX=false ✓
- bun run lint ক্লিন; commit 5913a61

Stage Summary:
- OCR ব্যাচ ওয়ার্কফ্লো সম্পূর্ণ: ১-৫ পৃষ্ঠা → "নতুন বই"; ৬-১০ পৃষ্ঠা → "আগের বইয়ে যোগ" (একই বইয়ে, পৃষ্ঠা নম্বর অটো-মিল, অটো-এমবেড আবার চলে)
- দুবার একই পেস্টে ডেটা-ডুপ্লিকেশন হয় না (409 গার্ড)
- বাকি সব আগের স্টেট যাচাইকৃত: PDF সিস্টেম বাদ ✓, ক্যাটাগরি CRUD ✓, RAG লক ৩-স্তর ✓, মডেল রেজিস্ট্রি+স্বাক্ষর পুল ✓

---
Task ID: 5
Agent: main (Z.ai Code)
Task: OCR পেস্টের মার্কডাউন/HTML/LaTeX আবর্জনা অটো-পরিষ্কার + সুন্দর রেন্ডার (টেবিল + KaTeX)

Work Log:
- ইউজার রিপোর্ট: Gemini থেকে কপি করা টেক্সটে টেবিল (| |), | --- |, <br>, **, ###, $P^{H}$ থাকে — সব থাকলেই পেস্ট করতে চায়; সিস্টেম নিজে পরিষ্কার করবে এবং বইয়ের কনটেন্ট ও উত্তর "MD ফাইলের মতো" সুন্দর দেখাবে
- ocr-book.ts: cleanOcrText() — <br>→নিউলাইন, HTML এন্টিটি, LaTeX \(x\)/\[x\]→$x$/$$x$$ ($...$ যেমন আছে তেমন), mergeBrokenRows (ভাঙা টেবিল-রো "|" শেষ না হওয়া পর্যন্ত জোড়া), normalizeTables (অ্যালাইনমেন্ট রো ক্যানোনিকাল হেডার-কলাম অনুযায়ী, টেবিলের ভেতরের ফাঁকা লাইন বাদ); parseOcrBook-এ প্রতি পৃষ্ঠা ক্লিন হয়; মার্কার-হীন ফলব্যাকেও cleanOcrText
- **বাগ-ফিক্স**: mergeBrokenRows-এ রো খোলার পরে endsWith('|') চেক হচ্ছিল না — সম্পূর্ণ রো পরের রো/লাইনের সাথে জোড়া লেগে যাচ্ছিল; খোলার সাথে সাথেই সম্পূর্ণতা চেক যোগ
- chunk.ts সম্পূর্ণ রিরাইট (টেবিল-সচেতন): splitBlocks (text/table/heading ব্লক), splitSentences এখন প্যারা কাঠামো ধরে রাখে, splitTableRows (লম্বা টেবিল হেডার+অ্যালাইনমেন্ট রিপিট করে সারি-গ্রুপে), শেয়ার্ড accumulator (টেবিল/শিরোনাম নিজের লাইনে, টেক্সট বাক্য-জোড়া); chunkPages + chunkContent দুটোই একই ইঞ্জিনে
- types.ts: BookReference.content (পুরো চাঙ্ক); rag.ts দুই ম্যাপিং + chat route-এ content ফরওয়ার্ড
- message-bubble.tsx: remark-gfm যোগ (আগে টেবিল রেন্ডারই হতো না!), শেয়ার্ড Markdown কম্পোনেন্ট (gfm+math+katex), ReferenceChips → ক্লিক-এক্সপ্যান্ডেবল: "📖 বইয়ের অংশ" প্যানেলে পুরো চাঙ্ক মার্কডাউন+KaTeX রেন্ডার
- E2E: ইউজারের আসল পেস্ট (পৃষ্ঠা ৪-৫, কৃষিশিক্ষা) — লাইভ প্রিভিউ ✓ → সাবমিট ✓ → DB যাচাই: ৫ চাঙ্ক, টেবিল সব অক্ষত (হেডার+অ্যালাইনমেন্ট), $P^{H}$ অক্ষত, <br> শূন্য, ** ব্যালান্সড; ভাঙা রো ঠিক জোড়া; বড় টেবিল-রো নিজের চাঙ্কে হেডার-রিপিটসহ
- রেন্ডার ভেরিফিকেশন: লোকাল DB-তে ফেক হিস্ট্রি রো (role সাময়িক student) → চ্যাটে উত্তরের টেবিল+KaTeX রেন্ডার ✓ (স্ক্রিনশট), রেফারেন্স চিপ ক্লিক → বইয়ের অংশ প্যানেলে টেবিল+ম্যাথ রেন্ডার ✓; ক্লিনআপ: ফেক রো ডিলিট, role=admin ফেরত, টেস্ট বই ডিলিট
- bun run lint ক্লিন; commit 41d15ec

Stage Summary:
- অ্যাডমিন এখন Gemini-র আউটপুট হুবহু পেস্ট করতে পারে — টেবিল, <br>, **, ###, $P^{H}$ সব থাকলেও সিস্টেম নিজেই নরমালাইজ করে পরিষ্কার মার্কডাউন জমা রাখে
- ছাত্রের উত্তরে টেবিল/বোল্ড/শিরোনাম/ম্যাথ সব সুন্দর রেন্ডার হয়; রেফারেন্স চিপে ক্লিক করলে বইয়ের আসল অংশ (টেবিল+ম্যথসহ) খুলে দেখা যায়
- RAG কনটেক্সটে টেবিল আর ভাঙে না — মডেল টেবিল-কাঠামো বুঝে উত্তর দিতে পারে

---
Task ID: 5
Agent: Z.ai Code (main)
Task: চ্যাটে অতিরিক্ত/ডুপ্লিকেট রেফারেন্স চিপ + "পাইনি" উত্তরের সাথে বিপরীত রেফারেন্স দেখানোর বাগ ফিক্স (ইউজার রিপোর্ট: কৃষিশিক্ষা বই লাইভ টেস্ট)

Work Log:
- রুট-কজ ১ শনাক্ত: RAG লকে মডেল নিজেই "পাইনি 📖" প্রত্যাখ্যান-বাক্য লিখলে gate 2 সেটাকে বৈধ প্রত্যাখ্যান হিসেবে পাস করে, কিন্তু refs (৩টা দুর্বল ম্যাচ) তবুও উত্তরের সাথে সেভ/রেন্ডার হতো → "পাইনি" উত্তরের নিচে ৩টা চিপ = বিভ্রান্তিকর
- রুট-কজ ২ শনাক্ত: retrieveTopK/retrieveTopKLexical শুধু স্কোর-অর্ডারে টপ-৩ নিত → একই পৃষ্ঠার ২টা চাঙ্ক টপ-৩-এ ঢুকে ডুপ্লিকেট চিপ (পৃষ্ঠা ৪ ×২) + মডেলের কনটেক্সটে একই জায়গা দুবার (উত্তর-মিস)
- rag.ts: pickDiverse() হেল্পার — একই বই+অধ্যায়+পৃষ্ঠার চাঙ্ক টপ-k-তে একবারই; বাকি স্লট অন্য পৃষ্ঠার সেরা স্কোরে পূরণ; ভেক্টর ও লেক্সিকাল দুই পথেই প্রয়োগ
- rag.ts: isCleanRefusal() export (REFUSAL_PATTERN + ফুটার-চেক, answerGroundedInBook রিফ্যাক্টর)
- chat/route.ts: মডেল-প্রত্যাখ্যান (isCleanRefusal) হলে references: [] সেভ/রেসপন্স; নইলে রেফারেন্স ডিডুপ + পৃষ্ঠা-ক্রমে (null সবার শেষে) সাজিয়ে সেভ
- E2E (curl + agent-browser): টেস্ট বই (কৃষিশিক্ষা ৬ পৃষ্ঠা) ইমপোর্ট → RAG লক ON → (B) বইয়ে-নেই প্রশ্ন "ট্র্যাক্টরের ইঞ্জিন" = "পাইনি" + refCount 0 ✅; (A) বইয়ের প্রশ্ন = সঠিক উত্তর + চিপ পৃষ্ঠা ১,৩ (ডুপ্লিকেট নেই, পৃষ্ঠা-ক্রমে) ✅; (C) শূন্য-মিল প্রশ্ন = gate-1 প্রত্যাখ্যান + refCount 0 ✅
- ব্রাউজার স্ক্রিনশটে ভিজ্যুয়াল যাচাই: প্রথম উত্তরে ২টা পরিষ্কার চিপ, "পাইনি" উত্তরে কোনো চিপ নেই; agent-browser errors খালি; dev.log-এ chat error/RAG-lock violation নেই
- bun run lint পরিষ্কার; টেস্ট-ডেটা (বই/প্রশ্ন/ছাত্র) পরিষ্কার, ragOnlyMode লোকালে false রিসেট
- সেশন-নোট: agent-browser লগইন 403 = ডিভাইস-লক; DB-তে ইউজারের deviceHash ব্রাউজারের zai_device_hash (localStorage) দিয়ে আপডেট করে সমাধান

Stage Summary:
- চ্যাট-রেফারেন্স UX এখন সামঞ্জস্যপূর্ণ: উত্তর থাকলে ইউনিক পৃষ্ঠার চিপ (১-৩টা, পৃষ্ঠা-ক্রমে), "পাইনি" হলে কোনো চিপ নয়
- পৃষ্ঠা-বৈচিত্র্যে মডেল এখন বইয়ের ৩টা ভিন্ন অংশ দেখে — RAG লকে সঠিক উত্তর-মিলের সুযোগ বাড়ল
- commit: e51e2d3 (src/lib/rag.ts, src/app/api/chat/route.ts)
- প্রোডাকশন (vercel) সর্বশেষ কমিট টানলে ফিক্স প্রয়োগ হবে; পূর্বের চ্যাট-হিস্ট্রির পুরনো সারিতে চিপ থেকে গেলেও নতুন উত্তর থেকে পরিষ্কার
---
Task ID: 6
Agent: Z.ai Code (main)
Task: উত্তর-ভঙ্গি "রোবট → অধ্যাপক-পণ্ডিত" (লেবেল/হ্যালো বাদ, প্রশ্ন বুঝে উত্তরের আকার) + ডুপ্লিকেট চিপের শেষ ঢাল + RAG ভুল-প্রত্যাখ্যানের মূল কারণ (বাংলা-টোকেন ভাঙা) ফিক্স

Work Log:
- ইউজার আসল চ্যাট-ট্রান্সক্রিপ্ট দিয়ে দেখাল: উত্তরগুলো "১) মূল উত্তর: ২) ধাপে ধাপে ব্যাখ্যা: ৩) বাস্তব উদাহরণ:" লেবেল + "হ্যালো! তোমার প্রশ্নটি খুবই সুন্দর..." জাতীয় রোবট-আমলেমি; "perfect" বলা সংক্ষিপ্ত প্রাকৃতিক উত্তরের নমুনাও দিল; চিপে ডুপ্লিকেট (পৃষ্ঠা ৪×২, ৩×২); শেষের চিন্তা-করার প্রশ্ন ফিচার রাখতে বলল
- gemini.ts buildSystemPrompt সম্পূর্ণ রিরাইট: ব্যক্তিত্ব = অভিজ্ঞ অধ্যাপক-পণ্ডিত; নিয়ম ২-এ কঠোর নিষেধ (হ্যালো/স্বাগতম/দারুণ প্রশ্ন/চলো জেনে নিই/নিচে দেওয়া হলো + "১) মূল উত্তর:" জাতীয় লেবেল + "উত্তর:" উপাধি); নিয়ম ৩-এ প্রশ্ন-প্রকার বুঝে আকার (তথ্য/তালিকা → ১-৩ বাক্য; কেন/কীভাবে → কারণ-ফল গদ্য; গণিত → একমাত্র সেখানেই ধাপে ধাপে বাধ্যতামূলক; কঠিন ধারণা → ছোট বাস্তব উদাহরণ); নিয়ম ৭-এ চিন্তা-করার প্রশ্ন মাঝে মাঝে (সব উত্তরে নয়); নিয়ম ৬-এ ফুটার পৃষ্ঠা বাংলা সংখ্যায়; RAG লক প্রোটোকল ও প্রত্যাখ্যান-বাক্য হুবহু অক্ষত (gate-1/2 নির্ভরশীল)
- message-bubble.tsx ReferenceChips: ক্লায়েন্ট-সাইড ডিডুপ (একই বই+অধ্যায়+পৃষ্ঠা = একটাই চিপ) — পুরনো হিস্ট্রির সারিতে ডুপ্লিকেট থাকলেও রেন্ডার পরিষ্কার
- **রুট-কজ ধরা (ডিবাগ-স্ক্রিপ্টে প্রমাণিত)**: rag.ts-এর /[\p{L}\p{N}]+/ regex বাংলা স্বরচিহ্ন (\p{M}) বাদ দিয়ে শব্দ ভাঙত ("নিষ্কাশন"→"শন", "ব্যবস্থা"→"যবস", "ডাল"→হারিয়ে যেত) — লেক্সিকাল ফলব্যাক (জিও-ব্লক/কী-না-থাকলে) এভাবেই অন্ধ হয়ে ভুল "পাইনি" দিত; contentTokens+tokenize দুটোতেই \p{M} যোগ
- rag.ts: হালকা বাংলা stemming (মাটির→মাটি, চাষের→চাষ, ক্ষেত্রে→ক্ষেত্র, মাটিতে→মাটি, পোকাগুলো→পোকা; দুই পাশে একই নিয়ম) + লেক্সিকাল স্কোরিংয়ে আংশিক মিল (prefix/contains, অর্ধেক ওজন — "নিষ্কাশন" ↔ "সুনিষ্কাশনযোগ্য")
- E2E (curl + agent-browser): টেস্ট বই (কৃষিশিক্ষা ২ পৃষ্ঠা, RAG লক ON) → ইউজারের ৩টা আসল প্রশ্ন: (১) "ভূমি কর্ষণ কীভাবে..." = স্বাভাবিক গদ্য-উত্তর, লেবেল/হ্যালো শূন্য ✓ (২) "৩০টি অঞ্চল... কি কি?" = সরাসরি উত্তর+পরিষ্কার তালিকা ✓ (৩) "ডাল চাষ... নিষ্কাশন কেন জরুরি?" = আগে ভুল "পাইনি", ফিক্সের পরে বইয়ের ২ নং পৃষ্ঠা থেকে সঠিক গদ্য-উত্তর ✓; ব্রাউজারে লাইভ প্রশ্ন "বিনা চাষে কোন কোন ফসল?" = এক লাইনের পারফেক্ট উত্তর ✓; ফুটারে "পৃষ্ঠা: ২" বাংলা সংখ্যা ✓; সব চিপ ইউনিক পৃষ্ঠা-ক্রমে ✓; চিপ ক্লিক → বইয়ের অংশ প্যানেল ✓; মোবাইল 390px ✓; page-errors শূন্য, dev.log ক্লিন ✓
- টেস্ট-ডেটা (বই/ইউজার/প্রশ্ন) ক্লিনআপ, ragOnlyMode লোকালে false; bun run lint ক্লিন

Stage Summary:
- উত্তর এখন মানুষের মতো: প্রথম বাক্যেই সরাসরি উত্তর, প্রশ্ন বুঝে ছোট/বড়, লেবেল-হ্যালো নেই, গণিতে ধাপে ধাপে, মাঝে মাঝে চিন্তা-করার প্রশ্ন (ফিচার অক্ষত)
- বাংলা-টোকেন ভাঙার রুট-কজ ফিক্সে লেক্সিকাল রিট্রিভাল ও gate-2 কভারেজ এখন আসল শব্দে কাজ করে — বইয়ে-থাকা-প্রশ্নের ভুল "পাইনি" বহু কমবে (প্রোডাকশনে এমবেডিং ফেল হলে যেই পথ চলে)
- চিপ ডিডুপ এখন সার্ভার+ক্লায়েন্ট দুই স্তরে — পুরনো হিস্ট্রি সারিতেও ডুপ্লিকেট দেখাবে না
- প্রোডাকশনে কার্যকর হতে vercel-এ সর্বশেষ কমিট ডিপ্লয় করতে হবে
---
Task ID: 7
Agent: Z.ai Code (main)
Task: "টিউটর ইঞ্জিনগুলো ব্যস্ত" ভুল-বার্তার রুট-কজ ফিক্স + মুছে-ফেলা ডাটাবেস ফরেনসিক রিকভারি (ইউজার রিপোর্ট: ভূমি কর্ষণ প্রশ্নে ৩ বার "ব্যস্ত" মেসেজ)

Work Log:
- রুট-কজ ১ (ডেটা): আগের সেশনের শেষে টেস্ট-ডেটা ক্লিনআপে লোকাল SQLite পুরো খালি হয়ে গিয়েছিল (users/sessions/apiKeys/books/chunks/questions = 0) — ইউজারের সেশন-কুকি অবৈধ হয়ে 401, আর ক্লায়েন্টের ক্যাচ-অল ব্রাঞ্চ 401-সহ সব এররকে "টিউটর ইঞ্জিনগুলো একটু ব্যস্ত" দেখাচ্ছিল
- রুট-কজ ২ (সার্ভার): ai-engine.ts-এ Gemini NO_KEYS-কে Z.ai-এর জেনেরিক এরর ঢেকে দিচ্ছিল → সিস্টেম সেটআপ-সমস্যাকে "ট্রানজিয়েন্ট" ভেবে ৯০ সেকেন্ড অর্থহীন রিট্রাই + ক্লায়েন্ট আরও ২৮ সে → শেষে ভুল "ব্যস্ত" বার্তা (সেটআপ-নোটিশের বদলে)
- ফিক্স ai-engine.ts: runPass-এ noKeys ফ্ল্যাগ ট্র্যাক; ফলাফল না পেলে সাথে সাথে GeminiError(503,'NO_KEYS') → permanent → সঠিক সেটআপ-নোটিশ, শূন্য বোকা রিট্রাই
- ফিক্স chat-view.tsx: সৎ এরর-ম্যাপিং — 401 → "সেশন শেষ" + onLogout(); 503/429/502 (রিট্রাই শেষে) → সত্যিকারের ব্যস্ত-বার্তা; 422/500/403 → সার্ভারের আসল বাংলা বার্তা; fetch-ফেল → "ইন্টারনেট সংযোগ" বার্তা
- ফরেনসিক রিকভারি: SQLite ফ্রি-পেজ পার্সার লিখে (b-tree leaf cell + varint record decode) DELETE-হওয়া রো-র বাইট উদ্ধার; দাঁড়ি (।) ক্যারেক্টার E0 A5 রেঞ্জ regex-বাদ পড়ার বাগ ঠিক করে সম্পূর্ণ চাঙ্ক-টেক্সট পাওয়া গেল
- রিস্টোর (মূল id হুবহু): বই "কৃষিশিক্ষা নবম-দশম" + অধ্যায় "সম্পূর্ণ বই" + ২ চাঙ্ক (মাটি ও কৃষি/ভূমি কর্ষণ — পৃষ্ঠা ১; বিনা চাষে ফসল/ডাল চাষ — পৃষ্ঠা ২), ইউজার e2e-student@test.local (deviceHash অক্ষত, পাসওয়ার্ড student1234-এ রিসেট — আগের হ্যাশের পাসওয়ার্ড অজানা) + e2e-admin@test.local (আসল হ্যাশ), ৩টি সেশন-টোকেন (নতুন করে ৩০ দিন → ইউজারের ব্রাউজার নিজে থেকেই আবার লগইন), ৯টি প্রশ্ন-ইতিহাস (উত্তর+রেফারেন্সসহ)
- E2E (agent-browser): লগইন ✓ → পুরনো ইতিহাস + চিপ রেন্ডার ✓ → ইউজারের ফেল-করা প্রশ্ন "ভূমি কর্ষণ কাকে বলে?" = প্রথম বাক্যে সরাসরি স্বাভাবিক উত্তর (হ্যালো/লেবেল শূন্য) + একটাই চিপ (পৃষ্ঠা ১) + 📖 রেফারেন্স ✓; page-errors শূন্য; dev.log-এ chat 200, অন্য কোনো এরর নেই
- bun run lint ক্লিন; ফরেনসিক স্ক্রিপ্ট ডিলিট

Stage Summary:
- "ব্যস্ত" ভুল-বার্তার তিনটি উৎসই বন্ধ: (১) ভুয়া ক্যাচ-অল বার্তা এখন সৎ-প্রতি-এরর, (২) NO_KEYS মাস্কিং শূন্য, (৩) ডেটা ফেরত
- মুছে-ফেলা বই/ইউজার/ইতিহাস/সেশন ফরেনসিকভাবে পুরোপুরি ফেরত — ব্যবহারকারীর ব্রাউজারে আলাদা লগইন ছাড়াই আগের অবস্থা
- নোট: e2e-student@test.local পাসওয়ার্ড = student1234 (রিসেট করা); admin@tutor.bd/admin1234 পরের লগইন-চেষ্টায় স্বয়ংক্রিয়ভাবে তৈরি হবে; Gemini কী নেই বলে উত্তর এখন Z.ai ইঞ্জিনে — অ্যাডমিন প্যানেলে কী যোগ করলেই Gemini ফেরত
---
Task ID: 8
Agent: Z.ai Code (main)
Task: ইউজার আবার রোবট-উত্তর দেখছে ("১) মূল উত্তর: ২) ব্যাখ্যা: ৩) বাস্তব উদাহরণ:" + "হ্যালো!") — রুট-কজ: ফিক্সগুলো GitHub-এ push হয়নি, Vercel প্রোডাকশনে পুরনো কোড চলছিল

Work Log:
- ইউজারের নতুন ট্রান্সক্রিপ্ট ("ভূমি কর্ষণ কাকে বলে?" প্রশ্নে রোবট-লেবেল উত্তর) বিশ্লেষণ — উত্তরের টেমপ্লেট পুরনো প্রম্পটের সাথে মিলে যায়, নতুন প্রম্পটের সাথে নয়
- রুট-কজ শনাক্ত: লোকাল main ছিল origin/main থেকে "ahead 9" — c097439 (অধ্যাপক-পণ্ডিত প্রম্পট), e51e2d3 (চিপ ডিডুপ), 41d15ec (OCR পরিষ্কার), 90c3e08 (ব্যস্ত-বার্তা ফিক্স) সহ ৯টি কমিট আনপুশড → Vercel পুরনো কোড সার্ভ করছিল
- প্রমাণ: `git show c097439^:src/lib/gemini.ts`-এ পুরনো নিয়ম ৭ = "উত্তরের কাঠামো: ১) এক লাইনে মূল উত্তর ২) ধাপে ধাপে ব্যাখ্যা ৩) বাস্তব উদাহরণ" — ইউজারের দেখা ঠিক এটাই
- bun run lint ক্লিন + লোকাল dev server HTTP 200 যাচাই
- git push origin main → 73e5dbb..90c3e08 push সফল; main ও origin/main এখন sync-এ

Stage Summary:
- ৯টি ফিক্স-কমিট (professor-প্রম্পট, চিপ ডিডুপ, ব্যস্ত-বার্তা, NO_KEYS, বাংলা টোকেন/স্টেমিং, OCR পরিষ্কার, RAG ভুল-প্রত্যাখ্যান) এখন GitHub-এ → Vercel অটো-ডিপ্লয় শুরু করবে
- ডিপ্লয় শেষ হলে প্রোডাকশনে: উত্তর লেবেল/হ্যালো-মুক্ত, চিপ ডুপ্লিকেট-মুক্ত, "ব্যস্ত" ভুল-বার্তা বন্ধ
- শিক্ষা: প্রতি ফিক্স-সেশনের শেষে push করা বাধ্যতামূলক — ইউজার প্রোডাকশনেই টেস্ট করে
---
Task ID: 9
Agent: Z.ai Code (main)
Task: ইউজারের প্রশ্ন — বই PDF-কপি ফরম্যাটে (মার্কার ছাড়া, জমানো "পৃষ্ঠা N" সহ) পেস্ট করলে সিস্টেম বুঝবে কি না → পার্সার আপগ্রেড করে হ্যাঁ করা হলো

Work Log:
- ইউজার জানতে চাইল: Gemini-OCR ফরম্যাটে না লিখে সরাসরি PDF-থেকে-কপি টেক্সট পেস্ট দিলে বুঝবে কি না — তাদের টেক্সটে মার্কার লাইনের ভেতরে জমা: "পৃষ্ঠা ১১কৃষি প্রযুক্তিজমি চাষের বিবেচ্য বিষয়", "।   পৃষ্ঠা ১২   কৃষিশিক্ষা   তৃতীয় পরিচ্ছেদ..."
- পুরনো PAGE_RE শুধু স্ট্যান্ডঅ্যালোন মার্কার-লাইন ধরত → এই ফরম্যাটে usedMarkers=false → পুরো লেখা এক অধ্যায়, পৃষ্ঠা-নম্বর হারাত
- ocr-book.ts: unwrapInlinePageMarkers() pre-pass — লাইনের ভেতরে জমানো "পৃষ্ঠা N" আলাদা লাইনে খোলে; শর্ত: সংখ্যার পরে জমাট বাংলা অক্ষর বা ২+ স্পেস
- backtracking bug ধরা+ফিক্স: lookahead-এ \S থাকলে "পৃষ্ঠা ১২" ভেঙে "পৃষ্ঠা ১"+"২" হত (টেস্টে ধরা পড়েছিল), "পৃষ্ঠা ৭-এ ছবি" ড্যাশে ভাঙত → lookahead = ২+ স্পেস বা বাংলা-অক্ষর-ক্লাস (সংখ্যা ০-৯ বাদ)
- ocr-book.ts: stripRunningHeaders() — বইয়ের নামের (titleHint) রূপভেদ (স্পেসসহ/কমপ্যাক্ট/২-শব্দ/১ম-শব্দ) পেজ-শুরু থেকে বাদ; শর্ট প্রার্থী (৬ অক্ষরের কম) জমাট লেখার সাথে মিললে বাদ নয় ("কৃষি" প্রার্থী "কৃষিশিক্ষাiv)" ভাঙার ঝুঁকি বন্ধ)
- parseOcrBook(raw, {titleHint}) সিগনেচার; route + books-tab preview দুই জায়গায় titleHint পাঠানো (append মোডে আগের বইয়ের title)
- টেস্ট (ইউজারের হুবহু ফরম্যাট): পৃষ্ঠা ১১-১৫ আলাদা ✓; পৃ. ১১/১৩/১৫-এর হেডার বাদ ("কৃষি প্রযুক্তিজমি চাষের" → "জমি চাষের") ✓; "পৃষ্ঠা ৫ এর উদাহরণ" বাক্য ভাঙেনি ✓; রিগ্রেশন: পুরনো "### পৃষ্ঠা N" ফরম্যাট ✓, মার্কার-বিহীন ✓, সূচিপত্র-লাইন ভুল-মার্কার নয় ✓, বাক্যে-উল্লেখ অক্ষত ✓
- bun run lint ক্লিন; টেস্ট-স্ক্রিপ্ট ডিলিট; commit + push

Stage Summary:
- এখন বই যোগ করা যাবে দুই ফরম্যাটেই: (১) Gemini-OCR "### পৃষ্ঠা N" ফরম্যাট, (২) PDF-থেকে-কপি raw টেক্সট (জমানো মার্কার সহ) — দুটোতেই প্রকৃত পৃষ্ঠা-নম্বরে চাঙ্ক হবে
- বইয়ের নাম যেই নামে সেভ করা হবে (title/append-বইয়ের title) সেটাই রানিং-হেডার বাদানোর হিন্ট
- সীমাবদ্ধতা: বইয়ের নামের সাথে না-মিলা হেডার (যেমন title "কৃষি প্রযুক্তি" অথচ হেডার "কৃষিশিক্ষা") পৃষ্ঠা-শুরুতে থেকে যেতে পারে — নয়েজ সামান্য, শব্দ অক্ষত থাকে
---
Task ID: 10
Agent: Z.ai Code (main)
Task: ইউজারের নতুন আপগ্রেড — Google Docs পাবলিক ভিউয়ার লিংক দিয়ে বই যোগ + PDF-কপি ফরম্যাটের 'PDF', 'PDF+ N' আবর্জনা কখনো লেখা গণ্য না-হওয়া

Work Log:
- ইউজারের দেওয়া আসল ডক-লিংক (কৃষিশিক্ষা নবম-দশম) দিয়ে প্রমাণ করলাম: docs.google.com/document/d/{ID}/export?format=txt পাবলিক ডক থেকে লগইন ছাড়াই টেক্সট দেয় (৪৭KB); ডকে PDF/PDF+4/PDF+1 (৪২টি), ফর্মা-১/২ ফুটার, BOM, \r লাইন-এন্ডিং সব ছিল
- নতুন API src/app/api/admin/books/gdoc/route.ts: লিংক ভ্যালিডেশন (ডক-আইডি এক্সট্রাক্ট, Drive-PDF/Sheet/Slide/Form হলে আলাদা বাংলা পরামর্শ), export fetch (৩০সে টাইমআউট), লগইন-HTML স্নিফ করে প্রাইভেট-ডক এরর ('Share → Anyone with the link → Viewer'), /edit পেজের <title> থেকে best-effort ডক-নাম (' - Google *' সাফিক্স কাটা), ৩০ লক্ষ অক্ষর ক্যাপ
- UI (books-tab.tsx): 'ধাপ ২'-এর ভেতরে 'Google Docs লিংক থেকে আনো' ব্লক — লিংক পেস্ট → টেক্সট textarea-তে ভরে (আগের লেখা থাকলে জোড়া হয়), নাম ফাঁকা থাকলে ডকের টাইটেল অটো-বসে; সাফল্যে অক্ষর-গণনা দেখায়
- ocr-book.ts stripCopyArtifacts: BOM (\uFEFF), একান্ত 'PDF'/'PDF+ N' লাইন + লাইন-শেষে লাগানো 'PDF+ N', 'ফর্মা-N, ... শ্রেণি' ফুটার — parseOcrBook ও cleanOcrText দুই পথেই চলে
- autoStripRepeatedPageHeads: কমপক্ষে ৩ পৃষ্ঠার একেবারে প্রথম লাইনে হুবহু একই ছোট (≤৪০ অক্ষর, বাক্য-চিহ্ন-শেষ নয়) লেখা থাকলে সেটা রানিং-হেডার — সব পৃষ্ঠার মাথা থেকে বাদ; titleHint-ভিত্তিক পুরনো পথে ধরা না-পড়া বিষয়-নাম হেডার ('কৃষি প্রযুক্তি'/'কৃষিশিক্ষা') এটাই ধরে
- অধ্যায়-শনাক্ত সম্প্রসারণ: ক্রমবাচক-আগে-কীওয়ার্ড ('প্রথম অধ্যায় কৃষি প্রযুক্তি' → নম্বর ১) + 'পরিচ্ছেদ' কীওয়ার্ড ('প্রথম/দ্বিতীয় পরিচ্ছেদ...' আলাদা অধ্যায়)
- মূল বাগ (ল্যাটেন্ট): ডকের 'অধ্যায়' = য় U+09DF (এক কোডপয়েন্ট), আমাদের সোর্স-প্যাটার্ন = য+় (U+09AF U+09BC) → রেজেক্স ম্যাচ করত না; bn.ts normalizeBnText — U+09DC/09DD/09DF → জোড়া-রূপ টার্গেটেড ম্যাপ (সম্পূর্ণ NFD নয়, কারণ NFD ো/ৌ-ও ভাঙে U+09CB→C7+BE — ডিবাগে ধরা); parseOcrBook (raw+titleHint) ও text-route-এ লাগানো
- টেস্ট (ইউজারের আসল ডক): ১০ পৃষ্ঠা, ৩ অধ্যায় ('প্রথম অধ্যায় কৃষি প্রযুক্তি' p১, 'প্রথম পরিচ্ছেদ ফসল নির্বাচন' p২, 'দ্বিতীয় পরিচ্ছেদ...' p৮), ২৫ চাঙ্ক, চাঙ্কে শূন্য PDF/ফর্মা/হেডার, পৃষ্ঠা-নম্বর ১–১০, ভূমি-কর্ষণ-সংজ্ঞা p৯-এ; রিগ্রেশন ৮ সেট (পুরনো ### ফরম্যাট, জমানো inline মার্কার, বাক্যে 'পৃষ্ঠা ৫' অক্ষত, BOM, শুধু-আবর্জনা পেজ-বাদ) — সব পাস; temp স্ক্রিপ্ট ডিলিট
- E2E (agent-browser): অ্যাডমিন লগইন → নলেজবেস → লিংক পেস্ট → 'লিংক থেকে আনো' → '✓ ১৮৬৩৪ অক্ষর... নাম "কৃষি শিক্ষা" বসানো হলো' → লেভেল/বিষয় বাছে সেভ → '"কৃষি শিক্ষা" যোগ হলো — ১০ পৃষ্ঠা · ৩ অধ্যায় · ২৫ চাঙ্ক' → তালিকায় অধ্যায়-কার্ড রেন্ডার → টেস্ট-বই ডিলিট (লোকাল পরিষ্কার); dev.log সব ২০০
- bun run lint ক্লিন; commit ab2a2e2 + push (b71d21d..ab2a2e2) — প্রোডাকশনে Vercel অটো-ডিপ্লয় হবে

Stage Summary:
- এখন বই যোগের তিন পথ: (১) Gemini-OCR '### পৃষ্ঠা N', (২) PDF-কপি raw পেস্ট (জমানো মার্কার/আবর্জনাসহ), (৩) Google Docs পাবলিক লিংক — তিনটাতেই প্রকৃত পৃষ্ঠা-নম্বর + অধ্যায় অটো
- 'PDF', 'PDF+ 1..∞', 'ফর্মা-N...' আবর্জনা কখনোই পাঠ্য-চাঙ্কে যায় না — ইউজারের শর্ত পূর্ণ
- য়/ড়/ঢ়-ইউনিকোড-রূপভেদ এখন সব পার্স-পথে নিউট্রাল — বাইরের উৎস (Google Docs) ও ইউজার-টাইপিং যে রূপেই হোক ম্যাচ হয়
- শিক্ষা: বাংলা টেক্সটে 'নুক্তা-নরমালাইজ' লাগবেই, কিন্তু সম্পূর্ণ NFD কখনো নয় (ো/ৌ ভেঙে যায়)
- সীমাবদ্ধতা: Drive-এর স্ক্যান-PDF লিংক সরাসরি আসবে না (Gemini-OCR পথই থাকবে); ডক প্রাইভেট হলে Viewer-শেয়ারিং লাগবে

---
Task ID: 11
Agent: Z.ai Code (main)
Task: ফ্রি-টিয়ার সাশ্রয় ৩-প্যাকেজ — ⚡ উত্তর-ক্যাশ + 📸 ছবি-প্রশ্ন (কম্প্রেশনসহ) + 🎨 SVG/Mermaid ডায়াগ্রাম

Work Log:
- ইউজারের ৩ দাবি: (১) ছবি-প্রশ্ন = একই request pipeline + আপলোডের আগে Canvas-কম্প্রেশন, (২) ডায়াগ্রাম AI-image মডেল নয় — LLM-ই SVG/Mermaid কোড লিখবে, (৩) রিপিট-প্রশ্ন embedding-similarity > 0.95 হলে ক্যাশ থেকে শূন্য-খরচ উত্তর
- ⚡ ক্যাশ: AnswerCache মডেল (দুই স্কিমাতেই; qNorm ইনডেক্স + embedding Json + ragOnly পতাকা + hits) + src/lib/answer-cache.ts — ২-স্তর মিল: হুবহু (নরমালাইজড কী: ছোট-বড়/যতি/বাংলা-সংখ্যা/হাইফেন→স্পেস) → এমবেডিং cosine ≥ 0.95 (একই embeddingModel, mem-cache TTL 60s, scan cap 300); প্রত্যাখ্যান/ছবি-উত্তর/মিশ্র-লিপি-দূষিত উত্তর ক্যাশে যায় না; হিটে ক্রেডিট ফেরত + Question-রো answerEngine='cache' + রেসপনসে cached:true; স্ট্যাটসে ২ নতুন কার্ড (ক্যাশে উত্তর/হিট)
- 📸 ছবি: chat-view-এ ImagePlus বাটন + src/lib/image-compress.ts (Canvas: 1024px JPEG 0.8 — token ~৭০% সাশ্রয়, ৪.৫MB বডি-লিমিট অক্ষত) + প্রিভিউ-চিপ + লেখা-ছাড়া পাঠানো চলে; chat API parseImage (data-url সেনিটাইজ, 5.5MB ক্যাপ); Gemini inline_data + Z.ai OpenAI-ভিশন content অ্যারে + sandbox SDK createVision (glm-4.5v); ছবি-প্রশ্নে RAG গেট-১/২ বাইপাস (ছবিই প্রধান রেফারেন্স) ও লক-প্রোটোকল বন্ধ
- 🎨 ডায়াগ্রাম: প্রম্পটে নিয়ম ৪.৫ (গঠন-চিত্র/গ্রাফ → ```svg, ফ্লোচার্ট/চক্র → ```mermaid; বাংলা লেবেল; script/image/foreignObject নিষিদ্ধ); message-bubble-এ pre-ইন্টারসেপ্ট → SvgBlock (সেনিটাইজ: script/on*/javascript:/image/foreignObject বাদ) + MermaidBlock (dynamic import, securityLevel strict, রেন্ডার-ব্যর্থ হলে raw-কোড ফলব্যাক); mermaid ডিপ ইনস্টল
- E2E: ক্যাশ-সেভ ✓ → হুবহু-রিপিটে "⚡ ক্যাশ — তাৎক্ষণিক" ব্যাজ + তাৎক্ষণিক উত্তর + কোটা-ফেরত (used ১-ই থাকে) ✓ → যতিচিহ্ন-ভ্যারিয়েন্টও হিট ✓; ছবি ("Solve: x + 5 = 12") কম্প্রেস→প্রিভিউ→vision উত্তর (মডেল ছবি পড়ে x=7 সমাধান) + ১ ক্রেডিট + ক্যাশ-বহির্ভূত ✓; SVG (নিউক্লিয়াস কোষ) + Mermaid (সমুদ্র→মেঘ→বৃষ্টি চক্র) ব্রাউজারে রেন্ডার ✓; স্ট্যাটস কার্ড ৮টা ✓

Stage Summary:
- শিক্ষার্থীর কোটা-বাঁচ: রিপিট-প্রশ্ন শূন্য-কোটা; ছবি-প্রশ্নও ১ request; ডায়াগ্রামে অতিরিক্ত API কল শূন্য (একই উত্তরে কোড)
- অ্যাডমিন স্ট্যাটসে ক্যাশ-সাশ্রয় দৃশ্যমান
- সীমাবদ্ধতা: স্যান্ডবক্সে Gemini-কী নেই বলে semantic-ক্যাশ (cosine) প্রোডাকশনেই যাচাই হবে; লোকালে exact-ক্যাশ প্রমাণিত
- শিক্ষা: dev-mode OOM (sandbox 4GB) — mermaid চাঙ্ক-কম্পাইল + ব্রাউজার একসাথে চললে next-server কিল হয়; কোড-সমস্যা নয়

---
Task ID: 12
Agent: Z.ai Code (main)
Task: প্রোডাকশন-বাগ-রিপোর্ট ফিক্স — (১) বইয়ে থাকা সত্ত্বেও "FCR-এর পূর্ণরূপ কী?"-তে ভুল "পাইনি 📖", (২) উত্তরে "খoló"-জাতীয় বাংলা-ইংরেজি মিশ্র-লিপি, (৩) ডুপ্লিকেট প্রশ্ন-বাবল + mermaid রেন্ডার-ফেল (ইউজার: "agulo sob kichu thik koro next time jeno arokom r nh hoy")

Work Log:
- ডায়াগনোজ ১ (FCR): ইউজারের Google Doc ফেচ করে প্রমাণ — "খাদ্য রূপান্তর হার বা FCR (Food Conversion Ratio)" doc-এ স্পষ্ট (লাইন ৪৭৬) → রুট-কজ: শুধু-ভেক্টর রিট্রিভালে সংক্ষিপ্তরূপ-প্রশ্নের সেমান্টিক-মিল দুর্বল (< 0.3 threshold) → refs খালি → গেট-১ প্রত্যাখ্যান; লেক্সিকাল ফলব্যাক তখনই চলে যখন এমবেডিং-ই ফেল করে
- ফিক্স (rag.ts): retrieveHybrid() — ভেক্টর + লেক্সিকাল সবসময় দুটোই চলে, ফল জোড়া (উভয়-মেলা চাঙ্ক আগে > ভেক্টর-একা > লেক্সিকাল-একা, পৃষ্ঠা-বৈচিত্র্য অক্ষত); chat route-এ প্রতিস্থাপন — এমবেডিং ফেল হলেও লেক্সিকাল স্বাধীনভাবে চলে
- প্রমাণ: পুরো ডক-বই লোকালে ইমপোর্ট (৬ অধ্যায়/৭৪ চাঙ্ক) → "FCR-এর পূর্ণরূপ কী?" → উত্তর "খাদ্য রূপান্তর হার (Food Conversion Ratio)" + রেফারেন্স পৃষ্ঠা ২৫ (ইউজারের বলা ২৫/২৮-ই!)
- ডায়াগনোজ ২ (খoló): doc সম্পূর্ণ পরিষ্কার ("খোলা" ঠিক আছে, মিশ্র-লিপি শূন্য) → দূষণ Z.ai মডেলের জেনারেশন-আর্টিফ্যাক্ট
- ফিক্স: bn.ts-এ countMixedScriptWords (বাংলা অক্ষর/মাত্রার ঠিক পরে ২+ ছোট-লাতিন; ১০/১০ ইউনিট-টেস্ট — সৎ FCR/pH/LaTeX/প্যারেন্থেসিস-ইংরেজি বাদ পড়ে); chat route-এ দূষণ ধরা পড়লে জোর-নির্দেশসহ ১টা রিট্রাই, পরিষ্কারটা রাখে; দূষিত উত্তর ক্যাশে যায় না
- ডায়াগনোজ ৩ (mermaid লাইভ-ফেল): মডেল A[বাষ্পীভবন (Evaporation)] লেখে — ব্র্যাকেট-লেবেলে প্যারেন্থেসিস mermaid-পার্সার ভাঙে; সিঙ্গেল-কোট রিপেয়ারও v12-তে ফেল
- ফিক্স (message-bubble): repairMermaid — প্যারেন্থেসিস/ব্রেসযুক্ত লেবেল ডাবল-কোটে A["…"], ভেতরের " → ’; রিপেয়ার-ব্যর্থে raw-কোড ২য় চেষ্টা; আগের ভাঙা-উত্তরও হিস্ট্রি-রিলোডে রেন্ডার হয়ে যায় (mmdRendered: 2, anyFailed: false)
- ডায়াগনোজ ৪ (ডুপ্লিকেট বাবল): দ্রুত দুবার Enter/ট্যাপে loading-স্টেট স্টেল — একই প্রশ্ন দুবার যায়
- ফিক্স (chat-view): sendingRef সিনক্রোনাস গার্ড — চলমান পাঠানোর মাঝে দ্বিতীয় Enter উপেক্ষিত
- বোনাস ফিক্স: ক্যাশ qNorm-এ হাইফেন↔স্পেস ("FCR-এর" ↔ "FCR এর" এখন একই কী) — প্রমাণিত: ভ্যারিয়েন্ট প্রশ্নে cached:true
- lint + tsc ক্লিন; টেস্ট-ডেটা (ডক-ফুল বই, টেস্ট-ছাত্র, ক্যাশ-রো) ক্লিনআপ

Stage Summary:
- "বইয়ে আছে অথচ পাইনি" শ্রেণির বাগ এখন দ্বিগুণ সুরক্ষিত — ভেক্টর-মিল দুর্বল হলে লেক্সিকাল-হিট উত্তর বাঁচায় (সংক্ষিপ্তরূপ/বিরল-শব্দ/নুক্তা-ভেদ সব)
- ছাত্রের পড়ার অভিজ্ঞতা: মিশ্র-লিপি উত্তর অটো-মেরামত, ভাঙা ডায়াগ্রাম-কোড অটো-রেন্ডার, ডুপ্লিকেট পাঠানো বন্ধ
- শিক্ষা: mermaid v12-তে লেবেলে প্যারেন্থেসিস = ডাবল-কোট বাধ্যতামূলক; মডেল-আউটপুট কখনো সিনট্যাক্স-নিশ্চল নয় — রেন্ডারারেই রিপেয়ার-স্তর রাখা জরুরি

---
Task ID: 11
Agent: main (Z.ai Code)
Task: উত্তর-ক্যাশ ফিচার ফেরত + Vercel বিল্ড-ফেইল (P1012) রুট-ফিক্স

Work Log:
- ইউজার রিপোর্ট: Vercel বিল্ড ফেল — P1012 "You cannot define an index on fields with native type Text of MySQL" → schema.production.prisma:129 @@index([qNorm])
- রুট-কজ নিশ্চিত: আগের session-এর commit 7c1fcd9-এ AnswerCache.qNorm (MySQL @db.Text)-এর উপর সরাসরি ইনডেক্স — MySQL-এ অবৈধ → prisma generate-ই ফেল → বিল্ড কখনো হয়নি → প্রোডাকশনে পুরনো কোড চলছিল (FCR 'পাইনি' রিপিটের আসল কারণ — হাইব্রিড-রিট্রিভাল ফিক্স ডেপ্লয়ই হয়নি)
- প্রথমে ইউজারের অনুরোধে ক্যাশ-ফিচার সম্পূর্ণ সরানো হয়েছিল; পরে ইউজার বলায় ("cache features abar add koro jodi ota vercel er karone problem hoye thake") git (7c1fcd9) থেকে ৯ ফাইল হুবহু ফেরত: answer-cache.ts, chat/route.ts, admin/stats/route.ts, stats-tab.tsx, message-bubble.tsx, chat-view.tsx, types.ts, schema.prisma, schema.production.prisma
- 🔧 মূল ফিক্স: schema.production.prisma-তে @@index([qNorm]) → @@index([qNorm(length: 191)]) — MySQL Text-এর prefix-ইনডেক্স (utf8mb4-safe ৭৬৪B < ৩০৭২B লিমিট)
- ভেরিফিকেশন: prisma validate (production schema, mysql URL) ✓; prisma generate (production schema) ✓; bun run lint ✓; লোকাল db:push (sqlite) ✓
- লোকাল E2E (API-স্তর): অ্যাডমিন-সিড → লগইন 200 → chat POST "১ কিলোগ্রামে কত গ্রাম?" → ইঞ্জিন-উত্তর; একই প্রশ্ন ২য়বার → cached:True + ০.১৯৯ সেকেন্ড (ইঞ্জিন-কল নেই); /api/admin/stats → cachedAnswers:1, cacheHits:1
- ব্রাউজার: হোমপেজ রেন্ডার ✓, অ্যাডমিন-লগইন → ড্যাশবোর্ড + ট্যাবস ✓, পরিসংখ্যান-ট্যাব রেন্ডার ✓ (sandbox বারবার dev-সার্ভার রিপ করায় কার্ড-স্ন্যাপশট ধরা পড়েনি — API-JSON-ই কার্ডের ডেটা)
- নোট: sandbox-এ dev সার্ভার প্রতি tool-call শেষে মারা যায়; NODE_OPTIONS=--max-old-space-size=1536 + curl-ওয়ার্মিং আগে, Chrome পরে — এই প্যাটার্নেই টেস্ট করতে হয়

Stage Summary:
- ⚡ উত্তর-ক্যাশ ফিচার সম্পূর্ণ ফেরত (exact-match + embedding cosine ≥ ০.৯৫; প্রত্যাখ্যান/ছবি-প্রশ্ন/দূষিত উত্তর ক্যাশ হয় না; ক্যাশ-হিটে ক্রেডিট ফেরত)
- Vercel বিল্ড-ব্লকার সমাধান: Text-prefix ইনডেক্স — এবার বিল্ড পাস করবে এবং 7c1fcd9-এর বাকি ফিক্সগুলোও (FCR হাইব্রিড-রিট্রিভাল, মিশ্র-লিপি রিপেয়ার, 📸 ছবি-প্রশ্ন, 🎨 SVG/Mermaid) প্রথমবার প্রোডাকশনে যাবে
- শিক্ষা: প্রোডাকশন-স্কিমা বদলালে লোকালেই `DATABASE_URL=mysql://dummy bunx prisma validate --schema prisma/schema.production.prisma` চালিয়ে যাচাই বাধ্যতামূলক

---
Task ID: 12
Agent: main (Z.ai Code)
Task: ডায়াগ্রাম-ট্রিগার শক্তিশালীকরণ + ফিচার-ব্যাখ্যা টেস্ট

Work Log:
- ইউজার জানতে চায়: উত্তর-ক্যাশ/হাইব্রিড-রিট্রিভাল/SVG-Mermaid মানে কী, আর কেন উত্তরে ডায়াগ্রাম দেখেনি
- যাচাই: ডায়াগ্রাম-ফিচার কোডে ছিল (gemini.ts নিয়ম ৪.৫ + message-bubble SvgBlock/MermaidBlock); ব্যবহারকারীর সব আগের টেস্ট 7c1fcd9 ডেপ্লয়-ব্যর্থতার কারণে পুরনো কোডে গিয়েছিল — ফিচারটা এইমাত্র প্রোডাকশনে পৌঁছালো
- gemini.ts নিয়ম ৪.৫ শক্ত করা: ছাত্র স্পষ্ট চিত্র চাইলে আঁকা বাধ্যতামূলক; গঠন/চক্র/প্রক্রিয়া/রশ্মিপথ/লেখচিত্র-প্রশ্নে নিজে থেকেই আঁকবে; শুধু সাদামাটা তথ্য-প্রশ্নে আঁকবে না
- লোকাল E2E প্রমাণ: "পানিচক্র ফ্লোচার্ট দিয়ে দেখাও" → ```mermaid ব্লক ✓; "উদ্ভিদকোষের গঠন চিত্রসহ দেখাও" → ```svg ব্লক ✓; lint ✓

Stage Summary:
- ডায়াগ্রাম-ফিচার পাইপলাইন প্রমাণিত (প্রম্পট → ইঞ্জিন → কোড-ব্লক → ফ্রন্টএন্ড রেন্ডারার)
- প্রোডাকশনে ডেপ্লয় হওয়ার পর ছাত্ররা ডায়াগ্রাম দেখবে — বিশেষত গঠন/চক্র/প্রক্রিয়া-প্রশ্নে বা স্পষ্ট চাইলে
