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
**Tujuan:** data pengguna & kontrol akses; sekaligus menyelamatkan trafik organik.

Deliverable:
- Supabase Auth: **Google OAuth** + **magic link email**; halaman `/masuk`, callback, logout.
- Trigger `handle_new_user` → `profiles` + `credit_accounts` (`plan='free'`).
- **Onboarding data** (peran, institusi, kebutuhan, consent) — lihat `docs/credits.md` §15.
- **Middleware gating**: JWT wajib untuk `/api/*` kecuali `/api/auth/*`, webhook, dan prefiks publik.
- **Halaman publik untuk SEO**: `/topik/*`, `/obat/{slug}` ringkas, `/sumber`, `/legal`, `/harga`.
- **Preview 3 hasil** + CTA "Masuk untuk melihat semua" pada halaman hasil.
- Rate limit magic link per email/IP + Turnstile pada form masuk.

Env baru: `SUPABASE_JWT_SECRET` (verifikasi), `GOOGLE_OAUTH_*` (di Supabase), `TURNSTILE_*`.
Validasi: `scripts/validate_auth.js` (401 tanpa token, 200 dengan token uji; onboarding tersimpan), `ui_harness.js` diperluas (halaman masuk, gate hasil, preview 3).
DoD: pengunjung bisa melihat halaman topik & 3 hasil; setelah login mendapat hasil penuh + profil tersimpan.

## Sprint 2 — PubMed E-utilities (gratis, dampak besar)
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

## Sprint 3 — Ledger + Saldo (tanpa AI)
**Tujuan:** pondasi penagihan; belum menyentuh DeepSeek.

Deliverable:
- Migrasi `008_credits.sql`: `credit_accounts`, `credit_ledger` (append-only + idempotency), `topups`, `ai_usage_log`, `ai_chat_log`, `usage_limits` + trigger saldo + RLS (sesuai `docs/credits.md`).
- Endpoint: `GET /api/credits/me` (saldo, plan, `ai_locked`), `GET /api/credits/ledger`.
- Utilitas server: `functions/_credits.js` (hold/settle/refund, konversi µIDR, pembulatan, minimum Rp100).

Validasi: `scripts/validate_credits.js` (unit: konversi & pembulatan; integrasi: hold→settle, hold→fail→refund, saldo tak negatif, idempotency ganda) + job rekonsiliasi `SUM(ledger) == balance`.
DoD: saldo dapat diisi manual (admin) lalu terpotong lewat uji simulasi; 0 saldo negatif.

## Sprint 4 — Pipeline Grounded internal (K1, tanpa biaya ke pengguna)
**Tujuan:** membuktikan "tidak halu" sebelum dijual.

Deliverable:
- `functions/_grounded.js`: retrieval (search + drug card + interactions) → prompt grounded + **skema JSON** (claims/citations/abstain/red_flags) → verifikasi sitasi pasca-generate.
- Endpoint internal `POST /api/dev/answer` (khusus admin/dev, tanpa ledger, rate-limited ketat).
- **Golden set awal 30** (`tests/golden/`) + `scripts/validate_grounded.js`: citation support, ketepatan abstain, akurasi fakta vs gold.
- Guardrail input (422 untuk data pasien/permintaan diagnosis-resep) + red-flag routing.

Validasi: citation support ≥98% pada 30 kasus; abstain benar pada ≥5 kasus bukti tipis.
DoD: laporan hasil golden set tersimpan di `docs/` + CI menjalankan validasi grounded (mode mock bila tanpa key).

## Sprint 5 — AI Proxy + Debit (P2)
**Tujuan:** monetisasi berjalan.

Deliverable:
- `POST /api/ai/chat` (SSE): auth wajib → estimasi → cek saldo (402) → hold → DeepSeek → settle/refund → `ai_usage_log` + `ai_chat_log`.
- Lapisan provider `functions/_provider.js` (DeepSeek V4.1 Flash; cache-friendly prompt: prefix statis di awal).
- `GET /api/ai/estimate`.

Validasi: `validate_api.js` bertambah (402 tanpa saldo, 422 input terlarang, 429 rate limit); uji hold/settle dengan provider mock.
DoD: jawaban AI berjalan di produksi dengan saldo uji; saldo berkurang sesuai `ai_usage_log`.

## Sprint 6 — UI Mode Gratis vs AI (P4)
**Tujuan:** tidak ada kejutan biaya.

Deliverable:
- Segmented `[Cari bukti · gratis]` ↔ `[Tanya AI · saldo]`; tombol menampilkan **estimasi Rp**; badge saldo di header; status **AI terkunci** saat Rp0 + CTA isi saldo.
- Search-first upsell ("Buat sintesis AI dari N studi — ±Rp…").
- Halaman saldo & riwayat (`/api/credits/ledger`).

Validasi: `tests/ui_harness.js` diperluas (mode switch, estimasi tampil, tombol terkunci, halaman saldo).
DoD: pengguna tanpa saldo tetap bisa seluruh search & drug card; AI terblokir rapi.

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
| # | Keputusan | Dibutuhkan di |
|---|---|---|
| 1 | Google OAuth (buat OAuth client di Google Cloud) + konfigurasi Supabase Auth | Sprint 1 |
| 2 | NCBI API key (gratis) untuk PubMed E-utilities | Sprint 2 |
| 3 | Simpan chunk korpus atau retrieval live untuk AI | Sprint 8 (dapat ditunda) |
| 4 | Kanal Xendit mana yang diaktifkan lebih dulu (QRIS/VA/e-wallet) | Sprint 7 |
| 5 | Batas rate limit AI per user (`RATE_LIMIT_RPM`) | Sprint 5 |

## Checklist validasi per sprint (ringkas)
| Sprint | Validasi otomatis | Validasi manual |
|---|---|---|
| 1 Auth+gating | `validate_auth.js` + `ui_harness.js` (gate & preview) | uji login Google + magic link di HP |
| 2 PubMed | `validate_pubmed.js` + `validate_api.js` | spot-check 10 query oleh Anda |
| 3 Ledger | `validate_credits.js` + rekonsiliasi | simulasi admin top-up |
| 4 Grounded | `validate_grounded.js` (golden 30) | review apoteker/dokter |
| 5 AI proxy | `validate_api.js` (402/422/429) + provider mock | uji 10 pertanyaan nyata |
| 6 UI | `ui_harness.js` | uji mobile |
| 7 Xendit | webhook ganda + rekonsiliasi | transaksi sandbox Xendit |
| 8 Kualitas | regresi golden 150+ di CI | review ahli per domain |
