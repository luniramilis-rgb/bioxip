# bioXip — Blueprint

Dokumen hidup. Setiap perubahan arsitektur wajib dicatat di sini.

## 1. Vision & positioning

- Target: peneliti, mahasiswa FK/kesmas/farmasi, klinisi, nakes Indonesia.
- Masalah: literatur biomedis global (~30 jt) tersembunyi di balik bahasa Inggris dan paywall; Garuda/OneSearch/Neliti hanya mengindex konten Indonesia.
- Solusi: search engine literatur internasional yang bisa dicari dengan Bahasa Indonesia, menampilkan status open-access, dan menautkan ke versi lokal Indonesia.
- Gap yang diisi: Garuda (konten Indonesia), OneSearch (katalog perpustakaan), Neliti (platform hosting konten lokal) — tidak ada yang membawa literatur dunia ke peneliti Indonesia.
- **Prinsip produk mengikat ada di `docs/principles.md`**: pasar Indonesia, mobile-first (95%), sign in Google + Apple + magic link, share-first (WhatsApp/Instagram/Threads/X), halaman share publik, pembayaran lokal, tanpa PII.

## 2. Brand

- Nama: bioXip. Ejaan konsisten `bioXip` (bukan BioZip).
- Tagline ID: "Literatur medis dunia, untuk peneliti Indonesia."
- Tagline EN: "The world's medical literature, for Indonesian researchers."
- Nama hanya di `web/js/brand.js`.

## 3. Sumber data & keputusan lisensi

| Provider | Peran | Akses |
|---|---|---|
| Europe PMC | Korpus: paper + preprint (PubMed, bioRxiv, medRxiv, PMC full-text), citasi | Bebas, delta harian |
| ClinicalTrials.gov v2 | Korpus: trial (core dulu; results fase 2) | Bebas, delta harian |
| OpenAlex | Enrichment: OA location + citation + konsep per DOI | Bebas (CC0), mingguan |
| ChEMBL / PubChem / Open Targets | Live lookup query-time + cache 24 jam (fase 3) | Bebas |
| Neliti (OAI-PMH) | Lapisan lokal: metadata konten unik Indonesia, link ke full-text | Bebas (set=unique) |

Keputusan: JANGAN bergantung pada API berbayar/tutup (Valyu pernah dipakai di proyek lama — ditinggalkan karena index tertutup, biaya per-query, dan key bocor di riwayat git). Hanya metadata+abstrak yang disimpan; full-text OA dapat diindeks sesuai lisensi artikel; tautkan, jangan re-host.

## 4. Arsitektur

- Statis-first di Cloudflare Pages CDN; edge logic di Pages Functions; Postgres terkelola di Supabase; pipeline Python hanya berjalan offline di GitHub Actions.
- 3 jalur data: (a) korpus di-harvest ke `documents`, (b) enrichment offline, (c) live lookup yang di-cache.
- Query-time = 1 pencarian di index sendiri (Postgres FTS) + <3 panggilan live.

```mermaid
flowchart LR
    H[GitHub Actions] --> E[Europe PMC] & C[ClinicalTrials.gov v2] & A[OpenAlex]
    E & C & A --> N[Normalize + dedupe] --> P[(Postgres)]
    U[Browser] --> F[Pages Functions /api/*] --> P
    P --> R[Rerank + facets] --> U
```

## 5. Skema database

File `supabase/migrations/001_documents.sql` sd `004_ops.sql`.
Inti: tabel `documents` (doc_type, identity_key unik, work_group utk dedupe preprint↔published, search_vector gin) + `term_map` (jembatan query ID→EN) + tabel ops (`harvest_runs`, `provider_cursor`, `live_cache`, `search_cache`, `search_logs`, `usage_quota`). RLS: publik read aktif; tulis hanya service_role.

## 6. Harvester & ops

- `harvest_full.py` backfill bertahap per tahun; `harvest_delta.py` harian per watermark.
- Dedupe: identity_key = doi/pmid/nct; preprint & published digabung ke `work_group`.
- Observability: `harvest_runs` mencatat counts/status/log; alert bila gagal 2x berturut.

## 7. Search API & ranking

`GET /api/search` → `fn_bioxip_search`. Query ID diekspansi lewat `term_map`.
Score = 0.36 text + 0.20 recency + 0.16 kualitas sumber + 0.12 coverage + 0.10 authority + 0.06 OA.
Satu hasil per work_group (published menang). Facet: type/source/tahun/OA/desain studi/"penelitian Indonesia".

## 8. Frontend

SPA vanilla hash-route: `#/`, `#/search`, drawer detail, `#/topic/{slug}`, `#/sources`, legal. ID default.

## 9. Keamanan & kepatuhan

Secrets: SUPABASE_URL, SUPABASE_ANON_KEY (edge), SUPABASE_SERVICE_ROLE (CI only), Turnstile. Turnstile + kuota anon di `_middleware`. Atribusi sumber + halaman kebijakan wajib. Tidak ada key di frontend.

## 10. Monetisasi

Search dasar gratis permanen. Jalur: (1) langganan institusi FK/perguruan tinggi, (2) API-as-product, (3) premium perorangan murah (terjemahan, alert, export), (4) laporan B2G, (5) sponsor/donasi. Iklan tidak direkomendasikan.

## 11. Roadmap

- F1 Fondasi: repo + migrations + harvester Europe PMC + fn search + landing search. Exit: search <800 ms; run harian tercatat.
- F2 Trial & lokal: CT.gov core + facet + filter "penelitian Indonesia" + term_map 10 topik + tombol "Cek versi lokal".
- F3 Enrichment & kimia: OpenAlex OA/citasi + live ChEMBL/PubChem/OT.
- F4 Produk masal: Turnstile, kuota, legal, admin, observability.
- F5 Monetisasi & lapisan lokal (Neliti OAI-PMH set=unique).

## 12. Decision log

- 2026-09-09 — Nama dipilih: bioXip.
- 2026-09-09 — Pasar: lokal Indonesia dulu (bilingual), data internasional.
- 2026-09-09 — Tidak memakai Valyu sebagai sumber inti (index tertutup, biaya, key bocor). Sumber = API publik yang bisa direplikasi mandiri.
- 2026-09-09 — Korpus literatur via Europe PMC tunggal (cakup PubMed+bioRxiv+medRxiv+PMC); trial via CT.gov v2; enrichment OpenAlex.
- 2026-09-09 — Neliti layak di-harvest via OAI-PMH `set=unique` (lapisan lokal) — keputusan ditunda ke fase 5.
- 2026-09-09 — Stack: Cloudflare Pages + Functions + Supabase Postgres + Python (GitHub Actions). Streamlit tidak dipakai (khusus MVP lokal).
- 2026-09-09 — Repo dibuat baru `D:\bioxip` (bukan clone eclipta: riwayat lama membawa key bocor & venv Windows).
- 2026-09-09 — Supabase: BUAT PROYEK BARU `bioxip` (region Singapore). Proyek lama `eclipta.bio` (paused) TIDAK dipakai/dilanjutkan — hanya arsip; jangan dihapus sebelum dipastikan tidak dipakai produk lain.
- 2026-09-09 — Arah (belum implementasi): harvester Neliti OAI-PMH `set=unique` → simpan metadata sendiri → hasil menautkan balik ke Neliti (fase 5).
- 2026-09-09 — Monetisasi: akses data tetap free; iklan dipertimbangkan ala Neliti dengan pagar: tanpa iklan obat/klaim kesehatan, direct-sales, transparan.
- 2026-09-09 — Opsi penyimpanan: index **metadata-only** (gaya Google Scholar). `STORE_ABSTRACTS=false`; abstrak tidak disimpan permanen; user dibuka ke sumber asli. Hasil: 20.226 dokumen = ±37 MB (kapasitas free ±270 rb dokumen). Abstrak saat detail bisa diambil live + cache pendek (fitur lanjutan).
- 2026-09-09 — Runtime: Cloudflare Pages `bioxip.pages.dev` live; Supabase project `nxlcosnksgbuvtiggjpw`; backfill manual bertahap 10k/batch (2025 & 2024 terpasang). GitHub secrets masih menunggu konfirmasi email GitHub.
- 2026-09-10 — Arah USP: "dari keputusan klinis sampai keamanan obat"; dua suite (Klinis + Farmasi), satu mesin. Strategi & validasi berlapis ada di `docs/strategy.md`. Urutan: S1 Drug Card → S2 Interaction/Monitoring → S3 Jembatan klinis↔farmasi → S4 Lapisan lokal → S5 API/intelijen.
- 2026-09-10 — CI: workflow **Validate** (katalog obat, monitoring, tabel interaksi, harness UI, cek sintaks JS) dijalankan tiap push/PR. Workflow **Validate API** harian 22:00 UTC menguji kontrak produksi. Workflow `deploy.yml` **dihapus** — deploy dilakukan otomatis oleh integrasi Git Cloudflare Pages (tanpa perlu secret Cloudflare di GitHub).
- 2026-09-10 — Validasi kontrak API: 22 cek hijau di produksi (search, answer + integritas sitasi, drug card termasuk agregasi label & monitoring, interaction checker, penolakan input tak valid).
- 2026-09-10 — Model bisnis AI: prepaid kredit (bayar → saldo → pakai AI → margin). Rancangan teknis (skema ledger, alur debit/refund, kontrak endpoint, guardrail) ada di `docs/credits.md`. Prinsip: ledger append-only + idempotent top-up + grounded-only (wajib retrieval & sitasi) + tanpa data pasien.
- 2026-09-10 — Keputusan monetisasi (lihat `docs/credits.md`): top-up via **Xendit**; **DeepSeek V4.1 Flash** sebagai provider AI tunggal (dengan abstraksi provider); **percakapan disimpan untuk evaluasi** (retensi 90 hari, boleh dihapus, tanpa data pasien); pembeda gratis vs berbayar = **mode eksplisit** (segmented: `Cari bukti · gratis` vs `Tanya AI · saldo`), search-first, estimasi Rp tampil sebelum eksekusi; endpoint search/data tidak pernah menyentuh ledger.
- 2026-09-10 — Model akses FINAL: **tanpa trial**. **Sign in wajib sejak versi gratis** (search & data gratis untuk pengguna login); **AI terkunci bila saldo Rp0**. Saldo dibeli bertingkat (Rp50rb/100rb/150rb/500rb), dalam **Rp**, **tanpa kedaluwarsa**, **tanpa bonus**, markup **12×** biaya asli DeepSeek V4.1 Flash (cache hit $0,006 / miss $0,30 / output $1,20 per 1 juta token). Top-up Xendit (QRIS + VA + e-wallet). Optimasi **prompt cache** (prefix stabil) jadi pengungkit margin utama.
- 2026-09-10 — Arsitektur basis pengetahuan AI (anti-halusinasi) ada di `docs/knowledge.md`: grounded-only + abstain + verifikasi sitasi, retrieval paralel, section-aware chunking, reranker, lapisan fakta terstruktur, golden set per domain, regresi CI. **PubMed masuk dua jalur**: via Europe PMC (`SRC:MED`, sudah terpasang) + **NCBI E-utilities langsung** (MeSH presisi, Clinical Queries, cross-check kelengkapan).
- 2026-09-10 — Rencana implementasi bertahap ada di `docs/plan.md`: Sprint 1 **Auth (Google OAuth + magic link) + gating + SEO publik** → Sprint 2 PubMed E-utilities → Sprint 3 Ledger → Sprint 4 Grounded internal + golden 30 → Sprint 5 AI proxy + debit DeepSeek → Sprint 6 UI gratis vs AI → Sprint 7 Xendit → Sprint 8 kualitas retrieval & data. Review apoteker/dokter dan lapisan lokal berjalan paralel.
- 2026-09-10 — Keputusan akses: **sign in wajib sejak versi gratis** (untuk data pengguna), metode **Google OAuth + magic link email**. Konten di balik login dikompensasi dengan halaman publik untuk SEO (`/topik/*`, drug card ringkas, `/sumber`, `/harga`, `/legal`) + **preview 3 hasil**. Onboarding mengumpulkan peran/institusi/kebutuhan + consent (UU PDP).
- 2026-09-10 — Rancangan onboarding & segmentasi ada di `docs/onboarding.md`: 3 kartu (peran dua tingkat dengan **Apoteker/Farmasi** sebagai segmen utama → institusi opsional → tujuan + consent), lalu **3 template pertanyaan AI per peran** ala Consensus (contoh hasil mock bertanda "contoh" bila saldo Rp0). Termasuk tabel `profiles`, event analitik, funnel, dan aturan pemakaian data (agregat n≥10, tanpa PII di analitik, hak hapus).
- 2026-09-10 — **Prinsip produk mengikat**: `docs/principles.md`. Pasar Indonesia; **mobile-first** (95%+, PWA, target 360px, LCP <2,5 dtk); **sign in Google OAuth + magic link/OTP** (Apple Sign In dibatalkan); in-app browser & keterkiriman email wajib ditangani; **fondasi berbagi sekarang** (halaman publik + OG tags + salin tautan), **integrasi kanal share ditunda ke backlog**; loop rujukan `?ref=` + K-factor juga di backlog; pembayaran lokal; checklist rilis mobile wajib lulus.
- 2026-09-10 — Pembatalan **Apple Sign In** (hemat biaya Apple Developer Program, hindari kerumitan Service ID/key & masalah "Hide My Email"); email sama via Google & magic link harus di-*link* agar tidak jadi akun ganda; tambah **OTP 6 digit** sebagai cadangan magic link.
- 2026-09-10 — **Sprint 2 selesai**: PubMed E-utilities (`functions/_pubmed.js`: esearch/esummary, filter Clinical Queries, throttle 150ms, `tool=bioxip`+email+opsi API key) terintegrasi ke `/api/search` sebagai fan-out ketiga; dedupe DOI/PMID dengan prioritas Europe PMC > PubMed > ClinicalTrials.gov; PubMed tidak dihitung ke `total` (karena Europe PMC sudah mencakup MEDLINE) untuk mencegah hitungan dobel; badge sumber di UI. Validasi produksi: sumber `pubmed` + `europepmc` muncul, 0 duplikat pada 4 query uji. Sprint 1 dipisah menjadi **1A (fondasi publik/SEO + salin tautan, tanpa kredensial)** dan **1B (auth+gating, menunggu Google OAuth client + SMTP)**.
- 2026-09-10 — **Sprint 1A selesai**: 11 halaman statis publik (`/topik/` + 10 topik Indonesia) dari satu sumber `web/data/topics.json`, lengkap dengan OG tags + 11 gambar 1200×630, JSON-LD (MedicalWebPage/BreadcrumbList), canonical, sitemap 12 URL, robots dengan Sitemap, cache `/topik/*` & `/og/*`. Tombol **Salin tautan** di hasil pencarian, drug card, dan halaman topik. Validasi: `validate_topics.js`, `build_topics.js --check`, `ui_harness`, `validate_api` — semua hijau. Ini melindungi trafik organik sebelum gating auth (Sprint 1B) dinyalakan.
- 2026-09-10 — **Sprint 3 (Ledger) selesai**: migrasi 008+009 (append-only ledger + operasi hold/settle/refund + RLS + view rekonsiliasi), RPC `fn_credit_*` (grant hanya service_role), endpoint `/api/credits/me` & `/ledger` (401 tanpa JWT di produksi), harga µIDR markup 12×. Dua bug penting diperbaiki: (1) `INSERT ... ON CONFLICT` memvalidasi CHECK baris kandidat sehingga upsert delta negatif selalu gagal → trigger memakai `UPDATE` + `row_count`; (2) **path impor relatif salah** membuat bundel Functions gagal sehingga deploy tertahan (rute baru menyamar sebagai 200 index.html) → diperbaiki dan ditambah `scripts/validate_imports.js` + halaman `404.html` agar rute tak dikenal tidak lagi menyamar sukses. Validasi live hold→settle→refund: **12/12 PASS**.
- 2026-09-10 — **Sprint 4 (Grounded pipeline) selesai**: `_safety.js` (blokir data pasien/diagnosis/peresepan + deteksi red flag), `_grounded.js` (retrieval → prompt grounded statis cache-friendly → skema JSON claims/citations/abstain → verifikasi sitasi + `support_rate` → fallback ekstraktif tanpa provider), `_provider.js` (DeepSeek JSON mode + pembacaan token cache), endpoint `api/dev/answer` bergerbang `DEV_ADMIN_TOKEN` (**404 bila tidak diset**; terverifikasi produksi). Golden set **40 item** (25 berjawab, 5 abstain, 5 tidak aman, 5 red flag) + `scripts/validate_grounded.js` (struktur selalu; uji live bila token tersedia).
- 2026-09-10 — **Sprint 5 (AI proxy + debit) selesai, mode mock**: `POST /api/ai/chat` SSE dengan alur hold → stream → settle/refund (tagihan dijamin ≤ hold), guardrail 422, 402 tanpa saldo, 401 tanpa JWT; `GET /api/ai/estimate`; migrasi `010_ai_logging.sql` (`fn_ai_log_usage`/`fn_ai_log_chat` SECURITY DEFINER) sehingga edge dapat mencatat log tanpa service_role. **Mock ekstraktif aktif otomatis bila `DEEPSEEK_API_KEY` belum diset** (tetap memotong saldo, minimum Rp100) → aman untuk demo/uji tanpa biaya token. Validasi live end-to-end: 402 → grant Rp50.000 → 422 → estimasi Rp267 → SSE lengkap → tagihan Rp100 → saldo 49.900 → log margin tercatat (**ALL PASS**). Review lanjutan menambahkan **rate limit 429 per-user** (`usage_limits`/env), **margin keamanan estimasi 1,3×** saat provider aktif, verifikasi status log, dan pemisahan `_estimate.js`.
- 2026-09-10 — **Sprint 6 (UI mode gratis vs AI) selesai**: segmented `Cari bukti · gratis` ↔ `Tanya AI · saldo`, estimasi Rp di tombol, badge saldo header (4 status), AI terkunci tanpa akun/saldo, halaman `#/saldo` (kartu + riwayat 25 transaksi), halaman `#/harga` (paket + rumus biaya). Bottom nav: Cari · Jawaban · Obat · Saldo · Sumber. Temuan review: service worker belum mem-precache modul baru → diperbaiki (SW **v4**) + `validate_imports` kini memeriksa **parity precache SW vs modul JS**.
- 2026-09-10 — **Review Sprint 6 (perbaikan)**: (1) submit form dari mode AI sebelumnya **menghilangkan `mode` dan filter** (tipe/sort/per_page) → kini dipertahankan; (2) badge saldo di-*throttle* 10 dtk dan di-refresh tiap perubahan rute; (3) bila saldo gagal dimuat (non-401) panel AI menampilkan pesan jelas alih-alih mengaktifkan tombol; (4) harness kini **benar-benar memicu handler submit** (stub elemen menyimpan listener) sehingga bug semacam ini tertangkap otomatis.
- 2026-09-10 — **Sprint 7 (top-up Xendit, mode mock) selesai**: migrasi 011 + 012 (`channel/external_id/payment_url/expires_at/raw`; RPC create/get/attach + `fn_topup_mark_paid` idempotent khusus service_role), edge `POST/GET /api/credits/topup` + `POST /api/payments/webhook` (verifikasi `x-callback-token`), `_xendit.js` (mock otomatis tanpa kunci; live memakai Xendit Payment Requests), UI isi saldo dengan polling status. Dua bug ditemukan & diperbaiki: OUT parameter `status` **bentrok dengan kolom `topups.status`** (ambiguous) dan `create or replace` tak bisa mengubah return type → `drop function` + `topup_status` + kualifikasi kolom + `notify pgrst reload schema`. Validasi live **ALL PASS 12/12** termasuk webhook dobel tidak menggandakan saldo.
- 2026-09-10 — **Sprint 8 (kualitas retrieval, adaptasi Live murni) selesai**: `_terminology.js` (ekspansi ID→EN+MeSH ±50 konsep, klasifikasi jenis pertanyaan, Clinical Queries EPMC/PubMed, klausa **AND antar-konsep**), `_rank.js` (reranker heuristik + guard "jangan reorder bila skor nol" + `sectionSnippet` Results/Conclusion), `search.js` (abstrak untuk skoring lalu disembunyikan bila tak diminta; judul dibersihkan — decode entitas sebelum strip tag; ekspansi nama obat Indonesia; pelonggaran bertahap; `clinical=1`), `_grounded.js` (bukti memakai `sectionSnippet` + clinical). Golden set **205 item** (40 kurasi + 165 draft berlabel) + `build_golden --check`. Unit test baru: `rank_unit`, `drugs_unit`, `functions_smoke` (eksekusi `onRequestGet` dengan fetch tiruan → menangkap ReferenceError yang lolos dari `node --check`). Bug diperbaiki: abstrak tak sampai ke grounded, judul bocor HTML, ekspansi OR terlalu lebar, dan `drugTerm/drugTerms` yang menyebabkan **500**. Catatan: keputusan **tanpa index lokal** dipertahankan — kualitas ditingkatkan di lapisan live, bukan dengan membangun korpus.
- 2026-09-11 - **Sprint 9 (cache edge & throttle)**: throttle NCBI diperbaiki ke 350 ms tanpa key / 100 ms dengan key (sebelumnya 150 ms melanggar batas 3 rps). Edge cache /api/search via Cloudflare Cache API (functions/_cache.js) dengan kunci berisi query+filter+versi namespace, TTL dari env SEARCH_CACHE_TTL_SECONDS (default 900s), param no_cache=1, penanda cache hit/miss/bypass, dan guard anti-cache-cacat (tidak menyimpan bila ada notes / hasil <3 / korpus Europe PMC <3). Cache jawaban AI di /api/ai/chat (kunci = pertanyaan+max_tokens+model+fingerprint bukti; hit maka provider dilewati, usage 0, tagihan minimum Rp100, TTL 7 hari). Middleware: /api/search tidak lagi no-store. Validator baru validate_cache.js + uji cache di functions_smoke.js. Bukti produksi: 0,92s dingin menjadi 0,32-0,41s cache (sekitar 2,6x).
- 2026-09-10 — **Sprint 8 (kualitas retrieval, adaptasi Live murni) selesai**: `_terminology.js` (ekspansi ID→EN+MeSH ±50 konsep, klasifikasi jenis pertanyaan, Clinical Queries EPMC/PubMed, klausa **AND antar-konsep**), `_rank.js` (reranker heuristik + guard "jangan reorder bila skor nol" + `sectionSnippet` Results/Conclusion), `search.js` (abstrak untuk skoring lalu disembunyikan bila tak diminta; judul dibersihkan — decode entitas sebelum strip tag; ekspansi nama obat Indonesia; pelonggaran bertahap; `clinical=1`), `_grounded.js` (bukti memakai `sectionSnippet` + clinical). Golden set **205 item** (40 kurasi + 165 draft berlabel) + `build_golden --check`. Unit test baru: `rank_unit`, `drugs_unit`, `functions_smoke` (eksekusi `onRequestGet` dengan fetch tiruan → menangkap ReferenceError yang lolos dari `node --check`). Bug diperbaiki: abstrak tak sampai ke grounded, judul bocor HTML, ekspansi OR terlalu lebar, dan `drugTerm/drugTerms` yang menyebabkan **500**. Catatan: keputusan **tanpa index lokal** dipertahankan — kualitas ditingkatkan di lapisan live, bukan dengan membangun korpus.
- 2026-09-11 - Review Sprint 9 (4 bug diperbaiki): (1) kunci cache kini memuat epmc_cursor/ct_token agar halaman 2+ tidak menyajikan hasil halaman 1; (2) middleware hanya menandai /api/search cacheable bila bukan no_cache=1 dan status 200; (3) log ai_usage_log.provider untuk cache-hit dicatat deepseek (bukan mock); (4) cacheKey memakai origin asli request - host sintetis membuat cache.put gagal sehingga cache tidak tersimpan. Bukti: kueri hangat 0,07-0,16s, paginasi nyata page1 != page2, page2 cursor asli miss->hit, cursor palsu tidak di-cache (degraded).
- 2026-09-11 - Blocker auth ditemukan: template email tidak dapat diedit pada free tier + SMTP bawaan (pesan API: 'Email template modification is not available for free tier projects using the default email provider'). Karena template default hanya memuat ConfirmationURL tanpa .Token, OTP 6 digit tidak akan terlihat pengguna sampai custom SMTP dikonfigurasi atau upgrade Pro. Via Management API, mailer_otp_length berhasil diubah 8 -> 6 (mailer_otp_exp 3600). Custom SMTP (Resend/Postmark/Brevo) menjadi prasyarat Sprint 1B, bukan opsional.
- 2026-09-11 - Auth unblocked: custom SMTP Resend aktif (smtp.resend.com:465, sender onboarding@resend.dev, name bioXip); template magic link + konfirmasi di-patch via Management API ke Bahasa Indonesia dan memuat .Token; mailer_otp_length=6, exp=3600. Sisa: Resend belum punya domain terverifikasi sehingga pengirim masih onboarding@resend.dev (hanya bisa kirim ke email pemilik akun Resend); untuk skala massal wajib domain sendiri + SPF/DKIM. Catatan keamanan: Resend API key sempat dibagikan lewat chat, disarankan rotasi setelah konfigurasi selesai.
- 2026-09-11 - Audit Google OAuth: Bagian A-B selesai (google enabled, client id/secret terisi, authorize 302 ke Google dengan redirect_uri callback Supabase yang benar). Bagian C diperbaiki: site_url localhost:3000 -> https://bioxip.pages.dev; uri_allow_list dibersihkan dengan menghapus https://bioxip.id/** karena domain belum dibeli (risiko pihak lain mengklaim domain itu lalu masuk allow-list redirect). Sisa: uji login Google end-to-end di browser dan domain Resend untuk pengiriman massal.
- 2026-09-11 - BUKTI END-TO-END: email OTP diterima di lunira.milis@gmail.com (subjek 'Kode masuk bioXip: 110590', template bioXip ter-render). Verifikasi POST /auth/v1/verify (type=email) HTTP 200, sesi terbentuk, email_confirmed=true, role=authenticated, provider=email, kode sekali-pakai. Sesi: jwt_exp=3600 (1 jam), refresh_token_rotation_enabled=true, reuse interval 10 dtk. Jalur email (magic link + OTP) SELESAI dan terverifikasi.
