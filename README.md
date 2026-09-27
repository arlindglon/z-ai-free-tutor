# 🎓 Z-AI Free Private Tutor — ফ্রি AI প্রাইভেট টিউটর

> বাংলাদেশের দূরবর্তী এলাকার শিক্ষার্থীদের জন্য **সম্পূর্ণ ফ্রি** AI প্রাইভেট টিউটর।
> বাংলায় প্রশ্ন করো (লিখে বা মাইক দিয়ে বলে) → বই থেকে উত্তর → ধাপে ধাপে ব্যাখ্যা → গণিতের সূত্র KaTeX-এ → পৃষ্ঠা নম্বর রেফারেন্স → পড়ে শোনায়।

GitHub Repo: `https://github.com/arlindglon/z-ai-free-tutor` (private)

---

## 📋 সূচিপত্র

1. [কী কী আছে (Features)](#-কী-কী-আছে-features)
2. [কীভাবে কাজ করে (Data Flow)](#-কীভাবে-কাজ-করে-data-flow)
3. [লোকাল ডেভেলপমেন্ট সেটআপ](#-লোকাল-ডেভেলপমেন্ট-সেটআপ)
4. [Environment Variables (.env) গাইড](#-environment-variables-env-গাইড)
5. [ডেটাবেস গাইড (TiDB)](#-ডেটাবেস-গাইড-tidb)
6. [অ্যাডমিন প্যানেল গাইড](#-অ্যাডমিন-প্যানেল-গাইড)
7. [PDF বই আপলোড গাইড](#-pdf-বই-আপলোড-গাইড)
8. [🚀 Vercel-এ ডিপ্লয় — ধাপে ধাপে](#-vercel-এ-ডিপ্লয়--ধাপে-ধাপে)
9. [Vercel-এর সীমাবদ্ধতা ও সমাধান](#-vercel-এর-সীমাবদ্ধতা-ও-সমাধান)
10. [বিকল্প ডিপ্লয় (Railway / Render / VPS)](#-বিকল্প-ডিপ্লয়-railway--render--vps)
11. [সমস্যা সমাধান (Troubleshooting)](#-সমস্যা-সমাধান-troubleshooting)
12. [🔒 সিকিউরিটি নোট](#-সিকিউরিটি-নোট)

---

## ✨ কী কী আছে (Features)

| Feature | বর্ণনা |
|---|---|
| 🔒 **ডিভাইস লক** | ১টা ডিভাইস = ১টা একাউন্ট (device fingerprint SHA-256) — একাউন্ট শেয়ার করা যায় না |
| 🎫 **দৈনিক ৩০ প্রশ্ন** | প্রতিদিন রাত ১২টায় (Asia/Dhaka) অটো রিসেট — অ্যাডমিন সেটিংস থেকে পরিবর্তনযোগ্য |
| 🔑 **Gemini Key Pool** | একাধিক ফ্রি Gemini API key — round-robin লোড ব্যালেন্সিং + অটো failover (৪২৯/৫xx হলে পরের key) |
| 🤖 **ডুয়াল ইঞ্জিন (Gemini + Z.ai)** | অ্যাডমিন প্যানেল থেকে **দুটো ইঞ্জিনই** নিয়ন্ত্রণ: যেকোনো একটা মূল ইঞ্জিন, on/off সুইচ, **দুটোতেই যত খুশি key**, অটো-ফলব্যাক — শিক্ষার্থী কখনো এরর দেখবে না (অটো queue + silent retry) |
| 📚 **RAG নলেজ বেস** | PDF বই আপলোড → অটো চ্যাপ্টার চেনা → চাঙ্ক → Gemini embedding (3072-dim) → TiDB-তে জমা |
| 📖 **পৃষ্ঠা রেফারেন্স** | প্রতিটি উত্তরে বই • অধ্যায় • পৃষ্ঠা নম্বর চিপ |
| 🧮 **KaTeX গণিত** | $x^2$, $\frac{a}{b}$ — সব সূত্র সুন্দরভাবে রেন্ডার |
| 🎤 **ভয়েস টিউটর** | Web Speech API — মাইক দিয়ে বাংলায় জিজ্ঞেস করো, উত্তর পড়ে শোনায় |
| 🛡️ **জিরো-ডাউনটাইম AI** | Gemini key না থাকলে/জিও-ব্লক হলে অটো ফলব্যাক ইঞ্জিন — শিক্ষার্থী কখনো আটকায় না |

---

## 🔄 কীভাবে কাজ করে (Data Flow)

```
🎤 মাইক/কিবোর্ডে বাংলা প্রশ্ন
        ↓
🔒 ডিভাইস ফিঙ্গারপ্রিন্ট + দৈনিক ক্রেডিট চেক
        ↓
🧠 Gemini Embedding (প্রশ্ন → ৩০৭২-dim ভেক্টর)
        ↓
📚 TiDB-তে সব বইয়ের চাঙ্কের সাথে cosine similarity → Top ৩ প্যারাগ্রাফ
        ↓
🔑 Key Pool থেকে পরের Gemini key
        ↓
✍️ Gemini Flash — বাংলায় ধাপে ধাপে ব্যাখ্যা + বইয়ের রেফারেন্স
        ↓
🧮 KaTeX রেন্ডার + 📖 পৃষ্ঠা চিপ + 🔊 পড়ে শোনানো
```

---

## 💻 লোকাল ডেভেলপমেন্ট সেটআপ

```bash
# ১. রিপো ক্লোন (নিজের token দিয়ে)
git clone https://github.com/arlindglon/z-ai-free-tutor.git
cd z-ai-free-tutor

# ২. প্যাকেজ ইনস্টল
bun install

# ৩. .env ফাইল বানাও (নিচের .env গাইড দেখো)

# ৪. ডেটাবেস টেবিল তৈরি (local dev = SQLite হলে অটো ফাইল হবে)
bun run db:push

# ৫. ডেভ সার্ভার চালু
bun run dev
```

ব্রাউজারে `http://localhost:3000` খোলো। প্রথমবার **অ্যাডমিন লগইন** করো:

```
Email:    admin@tutor.bd   (.env-এ ADMIN_EMAIL)
Password: admin1234        (.env-এ ADMIN_PASSWORD — প্রোডাকশনে অবশ্যই বদলাও!)
```

> **লোকাল ডিফল্ট DB**: `.env`-এ `DATABASE_URL=file:./db/custom.db` (SQLite) থাকলে লোকালে SQLite চলবে।
> লোকালেও TiDB চালাতে চাইলে নিচের [ডেটাবেস গাইড](#-ডেটাবেস-গাইড-tidb) দেখো।

---

## 🔐 Environment Variables (.env) গাইড

প্রজেক্ট রুটে `.env` ফাইল বানাও (`.gitignore`-এ আছে, কখনো commit হবে না):

```env
# ── ডেটাবেস ──────────────────────────────────────────────
# লোকাল ডেভ (SQLite):
DATABASE_URL=file:./db/custom.db

# অথবা TiDB (প্রোডাকশন/লোকাল — যেকোনোটা):
# DATABASE_URL=mysql://<USER>:<PASSWORD>@gateway01.ap-southeast-1.prod.aws.tidbcloud.com:4000/tutor?sslaccept=strict

# ── অ্যাডমিন একাউন্ট (প্রথম লগইনে অটো-সিড হয়) ─────────────
ADMIN_EMAIL=admin@tutor.bd
ADMIN_PASSWORD=admin1234
```

| Variable | কীসের জন্য | উদাহরণ |
|---|---|---|
| `DATABASE_URL` | ডেটাবেস connection | `file:./db/custom.db` বা TiDB MySQL URL |
| `ADMIN_EMAIL` | অ্যাডমিন লগইন ইমেইল | `admin@tutor.bd` |
| `ADMIN_PASSWORD` | অ্যাডমিন পাসওয়ার্ড | `admin1234` (বদলাও!) |
| `ZAI_API_KEY` | ঐচ্ছিক — Vercel-এ z-ai ফলব্যাক চালু | নিজের Z.ai key ([z.ai](https://z.ai) Model API) |
| `ZAI_MODEL` | ঐচ্ছিক — Z.ai fallback মডেল | `glm-4.5-flash` (ডিফল্ট) |

> 💡 **Gemini API keys কোথায়?** `.env`-এ না! অ্যাডমিন প্যানেলের **"API Keys" ট্যাব** থেকে অ্যাড করতে হয় — DB-তে এনক্রিপ্টেড নয় কিন্তু শুধু অ্যাডমিন দেখতে পারে (masked)।

---

## 🗄️ ডেটাবেস গাইড (TiDB)

এই প্রজেক্ট **দুটো স্কিমা ফাইল** ব্যবহার করে — মডেল হুবহু এক, শুধু provider আলাদা:

| ফাইল | Provider | কখন |
|---|---|---|
| `prisma/schema.prisma` | SQLite | লোকাল ডেভ (sandbox) |
| `prisma/schema.production.prisma` | MySQL (TiDB) | **Vercel/প্রোডাকশন** |

`vercel.json`-এর buildCommand প্রোডাকশন স্কিমা থেকেই `prisma generate` + `prisma db push` চালায় — তাই Vercel-এ **কিছু করতে হয় না**, শুধু `DATABASE_URL` env দিলেই টেবিল অটো তৈরি হয়।

### আপনার TiDB cluster (ap-southeast-1)

- **Host**: `gateway01.ap-southeast-1.prod.aws.tidbcloud.com`
- **Port**: `4000`
- **Databases**: `tutor` ← এই অ্যাপের জন্য (৯টা টেবিল আগেই push করা হয়েছে ✅), `resturant` ← আপনার অন্য প্রজেক্ট (এই অ্যাপ ওটা **ছুঁয়ে দেখে না**)

**টেবিলগুলো**: `User` (ডিভাইস লক), `Session`, `DailyCredit` (দৈনিক কোটা), `ApiKey` (key pool), `Setting` (মডেল/কোটা), `Book`, `Chapter`, `Chunk` (RAG + embedding), `Question` (চ্যাট হিস্ট্রি)

**ম্যানুয়ালি push করতে চাইলে:**

```bash
DATABASE_URL="mysql://<USER>:<PASSWORD>@gateway01.ap-southeast-1.prod.aws.tidbcloud.com:4000/tutor?sslaccept=strict" \
  bunx prisma db push --schema prisma/schema.production.prisma
```

---

## 🛠️ অ্যাডমিন প্যানেল গাইড

অ্যাডমিন দিয়ে লগইন করলে ৪টা ট্যাব পাবে:

### ১️⃣ API Keys (প্রথমে এটা করো!)

**দুই ইঞ্জিনেরই কী-পুল আছে — যত খুশি key যোগ করো:**

1. **জেমিনাই**: [Google AI Studio](https://aistudio.google.com/apikey) → ফ্রি key বানাও
2. **Z.ai GLM**: [z.ai](https://z.ai) → Model API → Sign Up → ফ্রি key বানাও (GLM-4.7-Flash ফ্রি)
3. অ্যাডমিন প্যানেল → **API Keys** ট্যাব → **ইঞ্জিন বাছো** (জেমিনাই বা Z.ai) → key পেস্ট → যোগ করো
4. **যত পারো তত key যোগ করো** — প্রতিটি key-এর নিজস্ব ফ্রি কোটা, round-robin মিলিয়ে চলে
5. কোনো key মরে গেলে (৪২৯/৫xx) পরের key-তে অটো সুইচ; ৪০১/৪০৩ হলে key অটো-ডি অ্যাক্টিভ

### 🎛️ ইঞ্জিন নিয়ন্ত্রণ (সেটিংস ট্যাব)

| নিয়ন্ত্রণ | কী করে |
|---|---|
| **মূল চ্যাট ইঞ্জিন** | জেমিনাই বা Z.ai — কে আগে উত্তর দেবে |
| **জেমিনাই on/off** | বন্ধ করলে সব প্রশ্ন Z.ai-তে যায় |
| **Z.ai on/off** | বন্ধ করলে সব প্রশ্ন জেমিনাইতে যায় |
| **অটো-ফলব্যাক** | মূল ইঞ্জিন ফেইল/ব্যস্ত হলে অন্যটা অটো উত্তর দেয় |

> 🛡️ **নেভার-শো-এরর নীতি**: ইঞ্জিন ব্যস্ত হলে request লাইনে অপেক্ষা করে (queue), ব্রাউজার নিঃশব্দে আবার চেষ্টা করে —
> শিক্ষার্থী কোনো টেকনিক্যাল এরর দেখে না, শুধু "ইঞ্জিন একটু ব্যস্ত — লাইনে অপেক্ষা করছি…" লেখা দেখে।
> এমবেডিং (বই খোঁজা) সবসময় Gemini দিয়ে; Gemini কী না থাকলে TF-IDF লেক্সিকাল সার্চ চলে।

### ২️⃣ নলেজ বেস (বই আপলোড)

→ নিচে [PDF আপলোড গাইড](#-pdf-বই-আপলোড-গাইড) দেখো।

### ৩️⃣ স্ট্যাটস

মোট শিক্ষার্থী, আজকের/মোট প্রশ্ন, চাঙ্ক সংখ্যা, এমবেডেড চাঙ্ক, সক্রিয় key — ৩০ সেকেন্ডে অটো-রিফ্রেশ।

### ৪️⃣ সেটিংস

| সেটিং | ডিফল্ট | বর্ণনা |
|---|---|---|
| চ্যাট মডেল | `gemini-3.5-flash-lite` | উত্তর জেনারেট করার মডেল |
| এমবেডিং মডেল | `gemini-embedding-001` | ৩০৭২-dim ভেক্টর |
| দৈনিক প্রশ্ন কোটা | `৩০` | প্রতি শিক্ষার্থী প্রতিদিন (১–১০০০) |

---

## 📚 PDF বই আপলোড গাইড

**সবচেয়ে সহজ ওয়ার্কফ্লো — শুধু PDF আপলোড করো, বাকি সব অটোমেটিক:**

```
PDF ড্র্যাগ-ড্রপ → টেক্সট এক্সট্র্যাক্ট → অধ্যায় অটো-চেনা → চাঙ্ক (পৃষ্ঠা নম্বরসহ)
→ TiDB-তে সেভ → ব্যাকগ্রাউন্ডে অটো-এমবেড (progress দেখা যায়) → শিক্ষার্থী প্রশ্ন করতে পারে
```

**অ্যাডমিন প্যানেল → নলেজ বেস ট্যাব:**

1. মোড **"PDF আপলোড"** নির্বাচিত আছে কিনা দেখো (ডিফল্ট)
2. বিষয় বাছো (বিজ্ঞান/গণিত/...) — ডিফল্ট "সাধারণ"; বোর্ড (ডিফল্ট NCTB)
3. PDF ফাইল টেনে আনো (বা ক্লিক করে বাছো)
4. "আপলোড ও প্রসেস করো" → অপেক্ষা করো
5. ✅ সফল হলে দেখবে: *"X পৃষ্ঠা থেকে Yটি চাঙ্ক তৈরি, Zটি অধ্যায় পাওয়া গেছে"*
6. ⏳ এরপর প্রতিটি অধ্যায়ে progress bar চলবে — **"স্বয়ংক্রিয় এমবেড হচ্ছে…"** — শেষ না হওয়া পর্যন্ত ট্যাব বন্ধ করো না (অ্যাডমিন প্যানেল খোলা রাখলেই হবে)

**অটো যা যা হয়:**

- বাংলা অধ্যায় চেনা: অধ্যায় / অনুচ্ছেদ / পাঠ / ইউনিট / chapter / unit (+ বাংলা সংখ্যা ১২৩)
- পৃষ্ঠা-সচেতন চাঙ্কিং (~৮৫০ ক্যারেক্টার, পৃষ্ঠা সীমায় বিরতি → সঠিক পৃষ্ঠা রেফারেন্স)
- হেডার/ফুটার/পৃষ্ঠা-নম্বর লাইন অটো-বাদ
- ভিজ্যুয়াল-অর্ডার বাংলা ফিক্স (ি/ে/ৈ অক্ষর ঠিক জায়গায়)

**সীমা ও সতর্কতা:**

- সর্বোচ্চ **150 MB** প্রতি PDF (লোকাল/সেলফ-হোস্টে; Vercel-এ ৪.৫ MB — নিচে দেখো)
- স্ক্যান করা (ছবির) PDF-এ টেক্সট লেয়ার না থাকলে `NEEDS_OCR` error — আগে OCR করে টেক্সট-ভিত্তিক PDF বানাও
- ম্যানুয়াল মোডে চ্যাপ্টার টাইটেল + কনটেন্ট হাতে লিখেও বই যোগ করা যায়

---

## 🚀 Vercel-এ ডিপ্লয় — ধাপে ধাপে

> ✅ **হ্যাঁ, এই প্রজেক্ট Vercel-এ ডিপ্লয় করা যায়** — রেডি। নিচের ধাপগুলো ফলো করো।

### ধাপ ১ — কোড GitHub-এ push করা আছে ✅

`https://github.com/arlindglon/z-ai-free-tutor` (private) — আপডেট push করতে:

```bash
git add .
git commit -m "changes"
git push
```

### ধাপ ২ — Vercel একাউন্ট

1. [vercel.com](https://vercel.com) → **Sign Up with GitHub** (একই GitHub একাউন্ট দিয়ে)
2. ফ্রি **Hobby** প্ল্যানেই শুরু করা যায়

### ধাপ ৩ — প্রজেক্ট ইমপোর্ট

1. Vercel Dashboard → **Add New… → Project**
2. `z-ai-free-tutor` রিপো **Import** করো
3. Framework Preset অটো **Next.js** হবে — কিছু বদলাবে না

### ধাপ ৪ — Environment Variables সেট করো ⭐ সবচেয়ে গুরুত্বপূর্ণ

**Settings → Environment Variables**-এ যাও এবং ৩টা ভ্যারিয়েবল যোগ করো:

| Name | Value | নোট |
|---|---|---|
| `DATABASE_URL` | `mysql://USER:PASSWORD@gateway01.ap-southeast-1.prod.aws.tidbcloud.com:4000/tutor?sslaccept=strict` | আপনার TiDB `tutor` DB — আসল user/pass বসাও |
| `ADMIN_EMAIL` | আপনার পছন্দের ইমেইল | যেমন `admin@tutor.bd` |
| `ADMIN_PASSWORD` | **শক্তিশালী নতুন পাসওয়ার্ড** | `admin1234` প্রোডাকশনে ব্যবহার কোরো না! |

> 💡 TiDB Cloud কনসোলের **Connect** ডায়ালগ থেকে connection string কপি করতে পারো — শুধু ডেটাবেসের নাম `tutor` করো আর শেষে `?sslaccept=strict` যোগ করো।

### ধাপ ৫ — Deploy

**Deploy** চাপো। Build চলার সময় অটোমেটিক:

```
prisma generate (production schema)
   ↓
prisma db push  ← TiDB-তে টেবিল না থাকলে অটো তৈরি হবে
   ↓
next build
   ↓
🎉 লাইভ! https://your-project.vercel.app
```

### ধাপ ৬ — লাইভ সেটআপ শেষ করো

1. `https://your-project.vercel.app` খোলো
2. নতুন `ADMIN_EMAIL`/`ADMIN_PASSWORD` দিয়ে **অ্যাডমিন লগইন**
3. **API Keys ট্যাব** → Gemini key যোগ করো
4. **নলেজ বেস ট্যাব** → PDF বই আপলোড করো
5. ✅ শিক্ষার্থীরা সাইন-আপ করে প্রশ্ন করা শুরু করবে!

### 🌍 Vercel ডিপ্লয়ের সবচেয়ে বড় সুবিধা

Vercel সার্ভার **US/EU-তে** থাকে → sandbox-এর জিও-ব্লক সমস্যা চলে যায় → **আসল Gemini embedding + আসল ভেক্টর RAG** কাজ করবে (লোকালে TF-IDF ফলব্যাক চলছিল)।

### ঐচ্ছিক ধাপ ৭ — Vercel-এ z-ai ফলব্যাকও চালু করো (নিজের ফ্রি Z.ai key)

স্যান্ডবক্সের z-ai credential Vercel-এ কাজ করে না — **কিন্তু নিজের Z.ai API key নিলে fallback ইঞ্জিন Vercel-এও চলবে!**

1. [z.ai](https://z.ai) → **Model API** → Sign Up → **API Keys** থেকে নিজের key নাও (GLM Flash মডেলগুলোর **ফ্রি টিয়ার** আছে)
2. Vercel → Settings → Environment Variables-এ যোগ করো:

| Name | Value | নোট |
|---|---|---|
| `ZAI_API_KEY` | তোমার Z.ai key | fallback চালু হবে |
| `ZAI_MODEL` | `glm-4.7-flash` | ঐচ্ছিক — ফ্রি (GLM-4.5-Flash-ও ফ্রি) |
| `ZAI_BASE_URL` | `https://api.z.ai/api/paas/v4` | ঐচ্ছিক — ডিফল্ট এটাই |

3. এবার ইঞ্জিন চেইন: **Gemini key pool → Z.ai ফলব্যাক** — Gemini-র সব key মরে গেলেও শিক্ষার্থী উত্তর পাবে!

**📊 ফ্রি টিয়ারের মাপা লিমিট (বাস্তব টেস্টে):**

| মডেল | উত্তরের গতি | একসাথে request | টেস্ট করা |
|---|---|---|---|
| GLM-4.7-Flash | ~০.৭–১ সে | ~২টা (একাধিক হলে 429) | ✅ ৬/৬ সফল queue দিয়ে |
| GLM-4.5-Flash | ~০.৭ সে | ~৪টা | ✅ |

- অ্যাপে **অটো সেমাফোর + retry** বিল্ট-ইন — লিমিটের বেশি request লাইনে অপেক্ষা করে, 429 আসেই না
- লিমিট বাড়াতে env: `ZAI_CONCURRENCY` (ডিফল্ট `২`; GLM-4.5-Flash ব্যবহার করলে `৪` দাও)
- একে একে চালালে প্রতি মিনিটে ~৬০–১০০ প্রশ্ন সম্ভব — টিউটর অ্যাপের জন্য যথেষ্ট

> ⚠️ মনে রাখো: স্যান্ডবক্সের ভেতরের `.z-ai-config` credential কপি করে Vercel-এ দেওয়া যাবে না — ওটা এই প্ল্যাটফর্মের অভ্যন্তরীণ। নিজের key-ই সঠিক পথ।

---

## ⚠️ Vercel-এর সীমাবদ্ধতা ও সমাধান

| সীমাবদ্ধতা | সমস্যা | সমাধান |
|---|---|---|
| **Serverless body limit ~4.5 MB** | Vercel-এ 150 MB PDF সরাসরি আপলোড **অসম্ভব** — এমনকি ৫ MB-এর বেশি PDF-ও হবে না | ① ছোট PDF (<4 MB) আপলোড করো, ② PDF ভেঙে ছোট অংশ করে আপলোড, অথবা ③ বড় বইয়ের জন্য নিচের [বিকল্প ডিপ্লয়](#-বিকল্প-ডিপ্লয়-railway--render--vps) |
| **Function timeout** | Hobby প্ল্যানে API function max **60s** (Pro-তে 300s — `vercel.json`-এ সেট করা আছে) | Hobby-তেও চ্যাট/এমবেড ঠিক চলে; শুধু বিশাল PDF প্রসেসিং ধীর হতে পারে |
| **ব্যাকগ্রাউন্ড এমবেড জব** | আপলোডের পরের অটো-এমবেড `after()` দিয়ে চলে — serverless-এ response-এর পর ফাংশন বন্ধ হতে পারে | বেশিরভাগ ক্ষেত্রে ঠিক চলে; আটকে গেলে বই কার্ডে **"আরও এমবেড করুন"** বাটন দিয়ে ম্যানুয়ালি চালাও (প্রতি ক্লিকে ১০০ চাঙ্ক) |

### সহজ সিদ্ধান্ত গাইড

```
বইগুলো ছোট (PDF < 4 MB)  ──────────→  Vercel Hobby (ফ্রি) যথেষ্ট ✅
বড় NCTB বই (৩০–১৫০ MB)  ──────────→  Railway / Render / VPS (নিচে দেখো)
```

---

## 🖥️ বিকল্প ডিপ্লয় (Railway / Render / VPS)

**150 MB পর্যন্ত PDF আপলোড + ব্যাকগ্রাউন্ড জব নিশ্চিতভাবে চালাতে চাইলে** — long-running server লাগবে:

| প্ল্যাটফর্ম | ফ্রি টিয়ার | আপলোড সীমা | নোট |
|---|---|---|---|
| **Railway** | ট্রায়াল $5 | 100 MB (কনফিগ করা যায়) | GitHub connect → সবচেয়ে সহজ |
| **Render** | ✅ ফ্রি Web Service | 100 MB | ফ্রি টিয়ারে cold-start হয় |
| **নিজের VPS** (DigitalOcean ইত্যাদি) | ~$4/মাস | নিজের ইচ্ছামতো | `bun run build && bun run start` |

সব ক্ষেত্রেই env variables একই (DATABASE_URL = TiDB, ADMIN_EMAIL, ADMIN_PASSWORD) আর build command হিসেবে `prisma generate --schema prisma/schema.production.prisma && next build` দাও।

---

## 🧯 সমস্যা সমাধান (Troubleshooting)

| Error / সমস্যা | কারণ | সমাধান |
|---|---|---|
| `DEVICE_EXISTS` (সাইন-আপে) | এই ডিভাইসে আগেই একাউন্ট আছে (ডিভাইস লক) | আগের ইমেইল দিয়ে **লগইন** করো; অ্যাডমিন DB থেকে deviceHash মুছতে পারে |
| `DEVICE_MISMATCH` (লগইনে) | ভিন্ন ডিভাইস থেকে লগইন (ডিভাইস লক) | যে ডিভাইসে সাইন-আপ করেছিলে সেখানে লগইন করো |
| `NO_CREDITS` 🌙 | আজকের ৩০ প্রশ্ন শেষ | কাল রাত ১২টায় (Dhaka) অটো রিসেট; অ্যাডমিন সেটিংসে কোটা বাড়ানো যায় |
| `NO_KEYS` / `KEY_POOL_EXHAUSTED` | কোনো Gemini key যোগ করা নেই বা সব key মরে গেছে | অ্যাডমিন → API Keys → নতুন key যোগ/রি-অ্যাক্টিভেট করো |
| `GEO_BLOCKED` (৪৫১) | Gemini ফ্রি টিয়ার এই দেশ/আইপি সাপোর্ট করে না | **Vercel-এ ডিপ্লয় করলে সমাধান** (US/EU egress); ফলব্যাক ইঞ্জিন ততক্ষণে উত্তর দেয় |
| `NEEDS_OCR` | PDF-এ টেক্সট লেয়ার নেই (স্ক্যান করা ছবি) | আগে OCR করো (Google Drive-এ খুলে "Google Docs হিসেবে সেভ" সহজ উপায়) |
| `PDF_BROKEN` | ফাইল corrupted / আসল PDF না | আবার এক্সপোর্ট করে দেখো |
| এমবেড progress আটকে আছে | key নেই / জিও-ব্লক / ট্যাব বন্ধ | key ঠিক করে বই কার্ডে **"আরও এমবেড করুন"** চাপো |
| Vercel build fail: Prisma | `DATABASE_URL` env হয়তো ভুল/বাদ | Vercel → Settings → Environment Variables চেক করো; URL-এ `?sslaccept=strict` আছে কিনা দেখো |
| TiDB: `Access denied` | ভুল user/pass | TiDB Cloud → Connect → নতুন password কপি করো |
| উত্তরে গণিত রেন্ডার হচ্ছে না | মডেল `$` চিহ্ন দেয়নি | আবার প্রশ্ন করো; মডেল সেটিংসে নতুন Gemini মডেল বাছো |

---

## 🔒 সিকিউরিটি নোট

- ⚠️ **GitHub token কখনো চ্যাট/পাবলিক জায়গায় দিও না** — টোকেন ফাঁস হলে [github.com/settings/tokens](https://github.com/settings/tokens) → টোকেন **Revoke** করে নতুন বানাও
- ⚠️ `.env` ফাইল **কখনো git commit কোরো না** (`.gitignore`-এ আগেই আছে)
- প্রোডাকশনে `ADMIN_PASSWORD` অবশ্যই শক্তিশালী রাখো
- TiDB পাসওয়ার্ড রোটেট করতে: TiDB Cloud → Cluster → **Reset Password**
- অ্যাডমিন প্যানেলের key লিস্টে key masked থাকে — স্ক্রিনশটেও নিরাপদ

---

## 🧱 প্রযুক্তি স্ট্যাক

| স্তর | প্রযুক্তি |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript |
| UI | Tailwind CSS 4 + shadcn/ui + Framer Motion + Lucide |
| গণিত | KaTeX (remark-math + rehype-katex) |
| ডেটাবেস | Prisma ORM → TiDB Serverless (MySQL) / SQLite (local) |
| PDF | unpdf (pdf.js) — টেক্সট এক্সট্র্যাকশন |
| AI | Gemini API key pool (embed 3072-dim + Flash Lite chat) |
| ভয়েস | Web Speech API (bn-BD STT + TTS) |

---

*তৈরি ❤️ দিয়ে — বাংলাদেশের শিক্ষার্থীদের জন্য, সম্পূর্ণ ফ্রি।*
