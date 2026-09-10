# bioXip — Rencana Implementasi (Sprint Plan)

Dokumen hidup. Acuan: `docs/knowledge.md` (kualitas AI) dan `docs/credits.md` (monetisasi).
Urutan disusun berdasarkan **dependensi** (auth → ledger → AI) dan **risiko/biaya** (fitur gratis & murah dulu).

## Status saat ini (selesai)
- Live search: Europe PMC (PubMed + preprint + PMC) + ClinicalTrials.gov, PWA mobile-first.
- Jawaban PICO ekstraktif (tanpa LLM) + integritas sitasi.
- Drug card 30 obat Fornas (label openFDA teragregasi, PubChem, ChEMBL, RxNorm, banner keselamatan, monitoring kurasi).
- Interaction checker (tabel terkurasi 15 pasangan + kutipan label).
- CI: `Validate` tiap push (katalog/monitoring/interaksi/harness/sintaks) + `Validate API` harian.
- Dokumen: blueprint, strategy, credits, knowledge, review-drugs, review-interactions, review-monitoring.

## Prinsip pengurutan
1. **Auth lebih dulu** — karena gate diberlakukan sejak versi gratis, auth adalah prasyarat produk (dan sumber data pengguna).
2. Fitur **gratis & tanpa biaya token** dikerjakan sebelum penagihan.
3. **Auth → ledger → AI**: AI tidak mungkin ditagih sebelum ledger ada.
4. Setiap sprint punya **DoD + validasi otomatis** (lanjut pola `scripts/validate_*.js` + `tests/ui_harness.js`).
5. Review klinis berjalan **paralel**, bukan di akhir.

---

## Sprint 1 — Auth (Google OAuth + magic link) + gating + SEO publik
**Status:** menunggu prasyarat dari Anda (Google OAuth client + SMTP). Rincian prasyarat di bagian bawah.
**Tujuan:** data pengguna & kontrol akses; sekaligus menyelamatkan trafik organik.

Deliverable:
- Supabase Auth: **Google OAuth** + **magic link email**; halaman `/masuk`, callback, logout.
- Trigger `handle_new_user` → `profiles` + `credit_accounts` (`plan='free'`).
- **Onboarding 3 kartu + consent** (peran, institusi, tujuan) sesuai `docs/onboarding.md`.
- **Langkah akhir: 3 template pertanyaan AI per peran** + contoh hasil (mock bertanda "contoh" bila saldo Rp0, nyata bila ada saldo).
- **Middleware gating**: JWT wajib untuk `/api/*` kecuali `/api/auth/*`, webhook, dan prefiks publik.
- **Halaman publik untuk SEO**: `/topik/*`, `/obat/{slug}` ringkas, `/sumber`, `/legal`, `/harga`.
- **Preview 3 hasil** + CTA "Masuk untuk melihat semua" pada halaman hasil.
- Rate limit magic link per email/IP + Turnstile pada form masuk.
- **Layar "buka di browser"** untuk in-app browser (Instagram/FB/TikTok/Line) — sesuai `docs/principles.md` §5.
- **Fondasi berbagi (murah, wajib sekarang)**: halaman publik sebagai tujuan tautan, **OG tags + gambar 1200×630**, dan tombol **Salin tautan**. (Integrasi kanal share ditunda ke backlog.)

Env baru: `SUPABASE_JWT_SECRET` (verifikasi), `GOOGLE_OAUTH_*` (di Supabase), `SMTP_*` untuk magic link/OTP, `TURNSTILE_*`.
Validasi: `scripts/validate_auth.js` (401 tanpa token, 200 dengan token uji; onboarding tersimpan), `ui_harness.js` diperluas (halaman masuk, gate hasil, preview 3, salin tautan).
DoD: pengunjung bisa melihat halaman topik & 3 hasil; setelah login mendapat hasil penuh + profil tersimpan; tautan yang disalin mengarah ke halaman publik.

## Backlog Pertumbuhan (DITUNDA — setelah sistem dasar stabil)
Dipindahkan dari Sprint 1.5 sesuai keputusan 2026-09-10. Isi:
- **Web Share API** + tombol eksplisit WhatsApp/Instagram/Threads/X.
- **Kartu gambar share** (canvas/SVG) untuk Instagram/Story.
- **`share_target` PWA**: membagikan tautan dari aplikasi lain → masuk ke bioXip.
- **Snapshot jawaban publik** (opt-in, dengan atribusi) — menunggu AI stabil & review klinis.
- **Pelacakan rujukan** `?ref=&utm_source=` + perhitungan **K-factor**.
Syarat mulai: Sprint 1–5 stabil (auth, search, ledger, AI, UI) dan ada trafik nyata untuk diukur.

## Sprint 1A — Fondasi publik (SEO + salin tautan, tanpa auth) — SELESAI (2026-09-10)
**Tujuan:** bagian Sprint 1 yang **tidak butuh kredensial**, dan wajib ada sebelum gating diberlakukan. Penting agar saat auth diaktifkan, trafik organik tidak hilang.
Hasil (terverifikasi di produksi `bioxip.pages.dev`):
- **11 halaman statis**: hub `/topik/` + 10 topik (`tb`, `dbd`, `stunting`, `malaria`, `kesehatan-ibu`, `diabetes`, `hipertensi`, `hiv`, `imunisasi`, `mental`) dengan intro, poin bukti, contoh pertanyaan, dan sumber resmi (WHO/Kemenkes/Fornas).
- **OG tags + 11 gambar 1200×630** (`/og/*.png`, 32 KB/gambar) + Twitter card.
- **JSON-LD** (`MedicalWebPage` + `BreadcrumbList`), canonical, meta description.
- **Sitemap 12 URL** + `robots.txt` dengan `Sitemap:`; cache `/topik/*` 1 jam, `/og/*` 24 jam.
- **Tombol "Salin tautan"** (hasil pencarian: tautan artikel; drug card: tautan label; halaman topik: URL halaman) + toast.
- Konten topik dari satu sumber `web/data/topics.json`; frontend memuatnya dengan fallback bawaan.
- Validasi: `validate_topics.js` (data + meta/JSON-LD/disclaimer/salin tautan + 11 gambar OG) dan `build_topics.js --check` di CI; `ui_harness` + `validate_api` **ALL PASS**.

## Sprint 1 — (lanjutan) Auth + gating — blokir kredensial
Setelah Sprint 1A selesai dan kredensial tersedia: Google OAuth client, SMTP + domain pengirim (SPF/DKIM), Turnstile. Lanjut ke deliverable auth/gating di atas.

## Sprint 2 — PubMed E-utilities — SELESAI (2026-09-10)
Terverifikasi di produksi: hasil memuat sumber **pubmed** + **europepmc**, **0 duplikat DOI/PMID** pada 4 query uji (tuberculosis, dengue, stunting, hypertension), NCBI E-utilities dapat diakses (total >300 rb untuk "tuberculosis").
Tersisa opsional: NCBI API key (naikkan batas 3→10 req/detik), dan perbaikan peringkat (PubMed saat ini muncul setelah Europe PMC).

## Sprint 2 (arsip rencana) — PubMed E-utilities (gratis, dampak besar)
**Tujuan:** literatur kedokteran lebih presisi & terverifikasi; tanpa biaya AI.

Deliverable:
- `functions/_pubmed.js`: `esearch`/`esummary`/`efetch` (db=pubmed, `tool`, `email`, `api_key`), queue 10 req/dtk, retry.
- Integrasi ke `functions/api/search.js`: fan-out **Europe PMC + PubMed + ClinicalTrials.gov**, dedupe DOI/PMID.
- **MeSH-aware**: ekspansi istilah dari kamus + MeSH terms.
- **Clinical Queries**: filter kategori (therapy/diagnosis/prognosis/etiology) via parameter `category`.
- Cross-check: log `hitCount` EPMC `SRC:MED` vs PubMed untuk strategi sama.

Env baru: `NCBI_API_KEY`, `NCBI_EMAIL`, `NCBI_TOOL=bioxip`.
Validasi: `scripts/validate_pubmed.js` (10 query emas: TB, DBD, stunting, hipertensi, dll) memastikan hasil punya PMID & sumber `pubmed`.
DoD: search menampilkan badge sumber `pubmed`; dedupe tidak menggandakan DOI sama; CI hijau.

## Sprint 3 — Ledger + Saldo (tanpa AI) — SELESAI (2026-09-10)
**Tujuan:** pondasi penagihan; belum menyentuh DeepSeek.
Hasil:
- Migrasi `008_credits.sql` + `009_credit_trigger_fix.sql`: `credit_accounts`, `credit_ledger` (append-only + idempotency), `credit_operations` (hold/settle/refund), `topups`, `ai_usage_log` (margin generated), `ai_chat_log` (retensi 90 hari), `usage_limits`, RLS baca-milik-sendiri, dan view `v_credit_reconciliation`.
- RPC `fn_credit_ensure_account`, `fn_credit_hold`, `fn_credit_settle`, `fn_credit_refund` (untuk `authenticated`), serta `fn_credit_grant` (khusus service_role/admin).
- Endpoint `GET /api/credits/me` dan `GET /api/credits/ledger` (wajib JWT → 401 tanpa token; sudah diverifikasi produksi).
- Harga: `functions/_pricing.json` (markup **12×**, tarif cache hit/miss/output) + `functions/_pricing.js` (cost/charge/estimate µIDR).
- **Temuan & perbaikan penting**: `INSERT ... ON CONFLICT` memvalidasi CHECK pada baris kandidat → upsert delta negatif selalu gagal; trigger diganti memakai `UPDATE` + `row_count` (migration 009). Juga ditemukan **path impor relatif salah** yang membuat bundel Functions gagal (deploy tertahan) → diperbaiki + ditambah `scripts/validate_imports.js` di CI.
- Validasi: `validate_credits.js` (statis) + `validate_credits_live.py` (live: hold→settle→refund, idempotency, penolakan saldo kurang, constraint, rekonsiliasi) → **ALL PASS**; `validate_api` termasuk 401 endpoint kredit.

## Sprint 4 — Pipeline Grounded internal (K1) — SELESAI (2026-09-10)
**Tujuan:** membuktikan "tidak halu" sebelum dijual; belum ada biaya token ke pengguna.
Hasil:
- `functions/_safety.js` — klasifikasi input: data pasien (NIK/telepon/MRN), permintaan diagnosis, permintaan peresepan → blokir; deteksi **red flag** (nyeri dada, sesak, perdarahan, penurunan kesadaran, kejang, stroke) → arahan gawat darurat.
- `functions/_grounded.js` — retrieval bukti (search + drug card Fornas) → prompt grounded (`SYSTEM_PROMPT` statis untuk cache) + skema JSON (`answer/claims/citations/uncertainty/abstain/red_flags`) → **verifikasi sitasi** (`verifyClaims`: setiap klaim wajib menunjuk evidence valid, dihitung `support_rate`) → fallback **extractive** bila provider tidak dikonfigurasi/gagal.
- `functions/_provider.js` — DeepSeek chat completions (JSON mode, timeout 60 dtk, membaca `prompt_cache_hit_tokens` untuk perhitungan biaya).
- `functions/api/dev/answer.js` — endpoint internal; **404 bila `DEV_ADMIN_TOKEN` tidak diset** (tidak pernah terekspos), 401 bila token salah; tanpa debit ledger.
- `tests/golden/grounded_set.json` — **40 item**: 25 pertanyaan berjawab (klinis/farmasi/akademik), 5 abstain, 5 input tidak aman, 5 red flag.
- `scripts/validate_grounded.js` — validasi struktur & penanda sumber (selalu) + **uji live** bila `BIOXIP_DEV_TOKEN` diset (sitasi, support_rate, abstain, 422, red flag).
- Terverifikasi produksi: `/api/dev/answer` → **404** (aman). Aktifkan dengan menyetel `DEV_ADMIN_TOKEN` (+ `DEEPSEEK_API_KEY` untuk mode LLM) di Cloudflare Pages.

## Sprint 4 (arsip) — Pipeline Grounded internal (K1, tanpa biaya ke pengguna)
**Tujuan:** membuktikan "tidak halu" sebelum dijual.

Deliverable:
- `functions/_grounded.js`: retrieval (search + drug card + interactions) → prompt grounded + **skema JSON** (claims/citations/abstain/red_flags) → verifikasi sitasi pasca-generate.
- Endpoint internal `POST /api/dev/answer` (khusus admin/dev, tanpa ledger, rate-limited ketat).
- **Golden set awal 30** (`tests/golden/`) + `scripts/validate_grounded.js`: citation support, ketepatan abstain, akurasi fakta vs gold.
- Guardrail input (422 untuk data pasien/permintaan diagnosis-resep) + red-flag routing.

Validasi: citation support ≥98% pada 30 kasus; abstain benar pada ≥5 kasus bukti tipis.
DoD: laporan hasil golden set tersimpan di `docs/` + CI menjalankan validasi grounded (mode mock bila tanpa key).

## Sprint 5 — AI Proxy + Debit (P2) — SELESAI (2026-09-10, mode mock)
**Tujuan:** monetisasi berjalan.
Hasil:
- `POST /api/ai/chat` (SSE): JWT wajib (401) → guardrail input (422) → cek saldo & estimasi → **402** bila kurang → `fn_credit_hold` → retrieval bukti → provider (**DeepSeek** bila `DEEPSEEK_API_KEY` ada; **mock ekstraktif** bila tidak) → stream `meta` / `delta` / `citation` / `citation_summary` / `red_flag` / `done` → `fn_credit_settle` (tagihan nyata, refund selisih; **dijamin tidak melebihi hold**) → `fn_ai_log_usage` + `fn_ai_log_chat` → bila gagal: refund penuh + log `refunded`.
- `GET /api/ai/estimate` (401 tanpa token) → estimasi Rp berbasis `_pricing.json`.
- Migrasi `010_ai_logging.sql`: `fn_ai_log_usage`, `fn_ai_log_chat`, `fn_usage_limit_for` (SECURITY DEFINER, hanya `authenticated`) — menulis log tanpa service_role di edge.
- **Mock mode**: aktif otomatis ketika `DEEPSEEK_API_KEY` belum diset → jawaban ekstraktif bersitasi + usage sintetis (tetap dipotong saldo, minimum Rp100). Aman untuk uji & demo tanpa biaya token.
- **Rate limit 429** per pengguna: `recentRequestCount` (jumlah `credit_operations` 60 detik terakhir) dibanding `rpm`; `rpm` diambil dari env `RATE_LIMIT_RPM` bila ada, jika tidak dari tabel `usage_limits` (default 6).
- **Margin keamanan estimasi**: saat provider aktif, estimasi dikalikan **1,3×** agar pemakaian nyata tidak melebihi hold (mencegah tagihan ter-*clamp* dan margin tergerus); mode mock memakai estimasi eksak.
- Validasi live (`scripts/validate_ai.js`): 402 tanpa saldo · grant · **422** input tidak aman · estimasi · SSE lengkap · tagihan **Rp100** · saldo sesuai · `ai_usage_log` dengan **margin** · **429** setelah `usage_limits.rpm=1` → **ALL PASS**.

## Sprint 6 — UI Mode Gratis vs AI (P4) — SELESAI (2026-09-10)
**Tujuan:** tidak ada kejutan biaya; pembeda gratis vs AI terlihat jelas.
Hasil:
- **Segmented** di halaman hasil: `Cari bukti · gratis` ↔ `Tanya AI · saldo` (mode disimpan di hash `?mode=ai`); tombol berubah "Cari" ↔ "Siapkan AI".
- **Estimasi Rp tampil sebelum eksekusi**: panel AI memanggil `/api/ai/estimate`, menampilkan `Tanya AI ≈ Rp X` + saldo; tombol baru menjalankan stream saat ditekan.
- **AI terkunci**: tanpa sesi → "memerlukan akun"; saldo < estimasi → CTA **Isi saldo**; 401/402/422/429 ditangani dengan pesan spesifik.
- **Stream SSE di UI**: delta teks bertahap, daftar sumber bernomor, **dukungan sitasi (%)**, peringatan red flag, dan baris akhir "Terpakai Rp X · sisa Rp Y" (menandai **mode demo** bila tanpa LLM).
- **Badge saldo** di header (empat status: anonymous/empty/ready/expired) diperbarui tiap rute & setelah pemakaian.
- **Halaman `#/saldo`**: kartu saldo + tabel riwayat 25 transaksi (warna +/−) + CTA; menangani sesi belum ada.
- **Halaman `#/harga`**: paket Rp50rb/100rb/150rb/500rb + penjelasan rumus biaya (markup 12×, minimum Rp100).
- Navigasi: bottom nav kini `Cari · Jawaban · Obat · Saldo · Sumber` (Kebijakan di footer), top nav menambah **Saldo**.
- Validasi: `ui_harness` diperluas (segmented, panel AI, terkunci tanpa akun, halaman saldo, paket harga) → **ALL PASS**; `validate_imports` juga memeriksa **parity precache service worker** (SW v4 memuat credits/ai/saldo) → bug precache tertangkap & diperbaiki.

## Sprint 7 — Xendit Top-up (P5)
**Tujuan:** pembelian saldo end-to-end.

Deliverable:
- `POST /api/credits/topup` (QRIS, VA, e-wallet) + `POST /api/payments/webhook` (verifikasi signature/callback token, idempotent via `provider_ref`).
- Halaman/instruksi pembayaran (QR string, nomor VA, expiry) + status.

Validasi: webhook ganda → saldo bertambah sekali; status `expired` tidak menambah saldo; rekonsiliasi Xendit vs ledger.
DoD: 1 transaksi uji sukses di sandbox Xendit.

## Sprint 8 — Kualitas Retrieval & Data (K2–K4)
- Retrieval hibrida (FTS + `pgvector`) + section-aware chunking + reranker.
- Lapisan fakta terstruktur (label, ATC, CT.gov, UniProt/GO) sebagai konteks AI.
- Golden set diperluas 150–300 + review ahli + regresi CI.

**Keputusan yang harus dikunci sebelum sprint ini:** apakah chunk korpus disimpan (butuh storage) atau diambil live tiap request (latensi/token lebih tinggi).

## Paralel (tanpa sprint khusus)
- **Review apoteker**: `review-drugs.md`, `review-interactions.md`, `review-monitoring.md` → ubah `reviewed:true` bertahap.
- **Review dokter**: golden set medis + validasi jawaban PICO.
- **Lapisan lokal (S4)**: Fornas/BPOM/guideline nasional + tautan Garuda/OneSearch/Neliti.
- **Jembatan S3**: bagikan kartu terapi dokter↔apoteker + status verifikasi.

---

## Keputusan yang perlu dikunci (dengan sprint terkat)
| # | Keputusan | Dibutuhkan di | Status |
|---|---|---|---|
| 1 | Google OAuth client (Google Cloud) + konfigurasi Supabase Auth | Sprint 1B | ⏳ menunggu |
| 2 | SMTP pengirim (domain + SPF/DKIM) untuk magic link/OTP | Sprint 1B | ⏳ menunggu |
| 3 | NCBI API key (gratis; opsional, menaikkan limit 3→10 rps) | Sprint 2 | opsional |
| 4 | `DEV_ADMIN_TOKEN` + `DEEPSEEK_API_KEY` (untuk mengaktifkan uji live grounded & mode LLM) | Sprint 4/5 | ⏳ menunggu |
| 5 | Simpan chunk korpus atau retrieval live untuk AI | Sprint 8 | ditunda |
| 6 | Kanal Xendit yang diaktifkan lebih dulu | Sprint 7 | belum |
| 7 | Batas rate limit AI per user (`RATE_LIMIT_RPM`) | Sprint 5 | belum |

## Checklist validasi per sprint (ringkas)
| Sprint | Validasi otomatis | Validasi manual |
|---|---|---|
| 1A Fondasi publik ✅ | `validate_topics.js` + `build_topics.js --check` + `ui_harness.js` — **ALL PASS** | cek preview OG (WhatsApp) & indeks |
| 1 Auth+gating | `validate_auth.js` + `ui_harness.js` (gate, preview, salin tautan) | uji login Google + magic link/OTP di HP (termasuk in-app browser) |
| 2 PubMed ✅ | `validate_pubmed.js` + `validate_api.js` — **ALL PASS** | spot-check 10 query oleh Anda |
| 3 Ledger ✅ | `validate_credits.js` + `validate_credits_live.py` (live) + `validate_imports.js` — **ALL PASS** | simulasi admin top-up |
| 4 Grounded ✅ | `validate_grounded.js` (struktur + live opsional) — **ALL PASS** | review apoteker/dokter |
| 5 AI proxy ✅ | `validate_ai.js` (statis + live mock) — **ALL PASS** | uji 10 pertanyaan nyata (setelah `DEEPSEEK_API_KEY`) |
| 6 UI ✅ | `ui_harness.js` (segmented, estimasi, terkunci, saldo, harga) — **ALL PASS** | uji mobile |
| 7 Xendit | webhook ganda + rekonsiliasi | transaksi sandbox Xendit |
| 8 Kualitas | regresi golden 150+ di CI | review ahli per domain |
