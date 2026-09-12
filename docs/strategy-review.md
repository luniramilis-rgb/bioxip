# bioXip — Review Strategi (Prompt Patterns, Local-First, Upgrade Roadmap)

Dokumen hidup. Turunan dari `docs/blueprint.md` (arsitektur) dan rekonsiliasi terhadap `docs/plan.md`, `docs/formulary-plan.md`, `docs/guideline-plan.md`, `docs/onboarding.md`, `docs/knowledge.md`. Setiap perubahan dicatat di `docs/blueprint.md`.

Tujuan: memisahkan **yang sudah selesai**, **yang parsial**, dan **roadmap** dalam materi strategi (prompt patterns, local-first, daftar upgrade, unifikasi medis–farmasi), lalu menetapkan **rencana eksekusi tervalidasi** berikutnya.

**Progres (2026-09-12):** N0 selesai. **N1 sebagian** (`minInterval` diekspor + `tests/pubmed_unit.js`; `NCBI_EMAIL` diset; `NCBI_API_KEY` menunggu kunci NCBI). **N2 selesai** (patterns.js 5 pola + chips + precache v6). **N3 selesai** (chip Bukti klinis, ekspor Vancouver/APA, bullet klaim kunci + salin daftar sumber). **N4 selesai** — reranking local-first via `source_tier`/sumber (`_rank.js`), 2 uji baru. N5 belum.

---

## 1. Status matrix (verifikasi terhadap repo, 2026-09-12)

| Item strategi | Status | Bukti |
|---|---|---|
| Throttle PubMed (350ms/100ms + API key) | ✅ **Selesai** | `functions/_pubmed.js:4-22` |
| Edge cache `/api/search` + `Cache-Control` | ✅ **Selesai** | `functions/_cache.js`, `functions/_middleware.js`, `search:v8` |
| Ketersediaan Fornas / status obat | ✅ **Selesai** | Fornas API → `drug_products` (`FORMULARY_DB=on`), `status_fornas` |
| ATC/RxNorm & crosswalk obat | ✅ **Sebagian besar** | `drug_crosswalk`, ATC 421/652 via `enrich_atc.py` |
| Local research links | ⚠️ **Parsial** | Neliti OAI (harvest), OneSearch link-out; Garuda menunggu URL terverifikasi |
| Guideline nasional (PNPK/PPK) | 🟡 **Roadmap** | `docs/guideline-plan.md` (belum ada kode) |
| Query patterns / template | 🟡 **Spec, belum UI** | `docs/onboarding.md:77-95` (Kartu 4) |
| Key claims bullet points | ⚠️ **Parsial** | `claims[]` + penandaan klaim tanpa sitasi inline; tampilan bullet belum |
| Study design filter | ⚠️ **Parsial** | `types`/`clinical` di API + `studyTypeWeight` (`_rank.js:42`); chip UI belum |
| Citation export (APA/Vancouver) | 🟡 **Roadmap** | `sources[]`/`claims[]` tersedia |
| Related questions (PICO) | 🟡 **Roadmap** | — |
| 5 topik baru (Interaksi, Herbal, SR, Fornas, AMR) | 🟡 **Roadmap** | Topik saat ini 10 (`web/topik/*`) |
| Unifikasi medis–farmasi | ✅ **Sudah** | Satu `/api/search`, satu katalog, satu pipeline AI; peran di onboarding |
| Lensa peran (presentation) | 🟡 **Roadmap** | — |
| Free tier 3–5 query AI/hari | ❌ **Kontradiksi** | Keputusan final "tanpa trial"; `docs/onboarding.md:95` |
| Domain `bioxip.id` | ❌ **Belum** | Produksi `bioxip.pages.dev` |
| Tagline "Tanpa Halusinasi" | ⚠️ **Dikoreksi** | Diganti "dirancang anti-halusinasi" |
| Simpan PDF/teks guideline sebagai Tier 1 | ❌ **Kontradiksi** | Kebijakan fetch-first + pointer + snippet |

## 2. Item yang harus dikoreksi (agar tidak jadi backlog menyesatkan)

1. **Jangan kerjakan ulang** throttle PubMed & edge cache — sudah ada. Untuk throttling tersisa, cukup **pasang `NCBI_API_KEY` + `NCBI_EMAIL`** di produksi dan pantau `notes`/`degraded`.
2. **Free tier 3–5/hari dihapus** — tetap **tanpa trial** (sesuai keputusan final). Hook gratis = search & data (tanpa login), bukan kuota AI.
3. **Domain**: tulis `bioxip.pages.dev` (produksi) + "rencana `bioxip.id`".
4. **Tagline** pakai versi lunak ("dirancang anti-halusinasi"), bukan klaim absolut.
5. **Guideline**: **pointer + snippet + atribusi**, bukan salinan PDF/teks penuh (lihat `docs/guideline-plan.md`).
6. **Consensus Meter harus didefinisikan ulang** (lihat §5): `support_rate` saat ini = klaim bersitasi ÷ klaim yang dikeluarkan (0 klaim → 100%), sehingga menjadikannya USP adalah menjual angka yang menyesatkan.
7. **Template bukan moat** — ia UX yang mudah ditiru. Moat = data lokal ter-provenance + pipeline sitasi/akurasi + biaya.

## 3. Kritik struktural

1. **Status drift** — materi strategi mencampur done/parsial/roadmap; wajib pakai kolom status (§1) saat dijadikan backlog.
2. **Guardrail vs template klinis** — pola "dosis", "PICO therapy", dan terutama "Red Flag Check" yang mengeluarkan **daftar diagnosis (STEMI/PE/dissection)** bertabrakan dengan guardrail 422 (tolak diagnosis) dan disclaimer "bukan nasihat medis". Red flag harus menghasilkan **arahan eskalasi (IGD)**, bukan diagnosis diferensial.
3. **Klaim tanpa bukti** — angka seperti "latensi 2.6×" dan skenario "studi lokal menunjukkan interaksi CYP" untuk produk herbal bermerek adalah **contoh halusinasi**; jangan dijadikan pola.
4. **PICO hardcoding** berisiko menurunkan recall pertanyaan Indonesia; lebih baik pola → **parameter retrieval** (`types`, `clinical`, `indonesia`, topik) dan biarkan ekspansi terminologi bekerja.
5. **Framing "silo medis/farmasi"** tidak akurat untuk arsitektur kita; yang kurang hanya **presentation layer per peran**.
6. **Over-promise ke Puskesmas** — daftar kasus bagus untuk konten, tetapi tanpa sumber lokal yang bisa diambil hasilnya kembali ke jawaban global.

## 4. Yang dipertahankan (sudah benar)

- **Local-First, Global-Fallback** (Tier 1–3) — sejalan dengan `source_tier` dan `docs/guideline-plan.md` §A.1.
- **Unified knowledge base** + lensa peran (presentation), bukan dua backend.
- **Fokus kasus Puskesmas** untuk konten/SEO.
- **Library pola pertanyaan** sebagai pengurang friksi onboarding.
- Urutan "stabilkan fondasi sebelum fitur UI" — kebetulan fondasi itu **sudah** dibangun.

## 5. Guardrail & metrik (wajib sebelum build fitur)

**Guardrail**
- Setiap keluaran wajib `sources[]` + disclaimer "bukan nasihat medis / bukan perintah peresepan".
- Red flag → **arahan gawat darurat**, tanpa daftar diagnosis.
- Tolak diagnosis/peresepan (422) tetap berlaku untuk AI.
- Klaim tanpa sitasi ditandai (sudah) dan tidak dihitung sebagai bukti.

**Metrik**
- **Indikator kekuatan bukti (pengganti "Consensus Meter")**: jumlah sumber unik + keragaman jenis studi (`studyTypeWeight`) + proporsi klaim terverifikasi; abstain → "bukti belum cukup".
- Operasional: citation rate, latency p95 `/api/search` & `/api/ai`, `errors`, rasio `notes`/`degraded`.
- Produk: task success, klik template → top-up, retensi 7 hari.

## 6. Rencana eksekusi berikutnya (tervalidasi)

Struktur mengikuti pola aman repo: perubahan kecil, aditif, **flag default OFF**, uji unit + CI, gate per fase.

### N0 — Rekonsiliasi dokumen & guardrail (tanpa kode runtime)
- **Baru:** `docs/strategy-review.md` (dokumen ini).
- **Ubah:** `docs/blueprint.md` (entri keputusan), `AGENTS.md` (catatan guardrail red flag = eskalasi).
- **Gate:** tidak ada kontradiksi tersisa (grep `trial|bioxip.id|PDF guideline` di dokumen aktif).
- **Rollback:** hapus/perbaiki dokumen.

### N1 — Stabilkan PubMed (env + uji, bukan bangun ulang)
- **Langkah:** set `NCBI_API_KEY` + `NCBI_EMAIL` di Cloudflare Pages; pastikan interval `_pubmed.js` diekspor untuk uji.
- **Baru:** `tests/pubmed_unit.js` (interval tanpa/dengan key, urutan antre).
- **Validasi:** `node tests/pubmed_unit.js`; `node scripts/validate_cache.js`.
- **Gate:** uji hijau; rasio `notes`/`degraded` di `/api/search` turun (pantau manual).
- **Rollback:** hapus env (kembali 350ms).

### N2 — Query Patterns sebagai preset front-end (tanpa backend baru)
- **Baru:** `web/js/patterns.js` (data pola: `id, label, peran, template`, serta **parameter** `{types, clinical, indonesia, topic}` + disclaimer), `tests/patterns_unit.js`.
- **Ubah:** `web/js/search.js` / `web/js/app.js` (render chip pola → isi `q` & parameter), `tests/ui_harness.js`.
- **Aturan:** pola red-flag → query eskalasi (bukan diagnosis); pola dosis → sertakan disclaimer.
- **Validasi:** `node tests/patterns_unit.js`; `node tests/ui_harness.js`; `node tests/rank_unit.js`.
- **Gate:** 3–5 pola awal berfungsi; tidak ada pola yang meminta diagnosis/peresepan.
- **Rollback:** sembunyikan chip pola (konstanta fitur).

### N3 — Study-design chips + Citation Export + Key-claims bullets
- **Baru:** formatter sitasi (APA/Vancouver) + `tests/format_unit.js`.
- **Ubah:** UI filter (`types`/`clinical`/`oa`), `web/js/ai.js` (bullet dari `claims[]`, tombol ekspor dari `sources[]`), `tests/ui_harness.js`.
- **Validasi:** `node tests/format_unit.js`; `node tests/ui_harness.js`; `node scripts/validate_ai.js`.
- **Gate:** ekspor sitasi akurat untuk 3 format; bullet menandai klaim tanpa sitasi.
- **Rollback:** sembunyikan komponen UI.

### N4 — Local-first reranking via `source_tier`
- **Ubah:** `functions/_rank.js` (bonus berbasis `source_tier`/jenis sumber, bukan hardcode nama), `functions/api/search.js` (propagasi `source_tier` dari guideline/DB).
- **Validasi:** `node tests/rank_unit.js`; `node tests/functions_smoke.js`; sampel live.
- **Gate:** dokumen lokal (guideline) naik peringkat untuk pertanyaan klinis ID; perilaku flag OFF aman.
- **Rollback:** matikan bonus via konstanta.

### N5 — Indikator kekuatan bukti + 5 topik baru (fetch-first)
- **Ubah:** `functions/_grounded.js` + `web/js/ai.js` (ganti `support_rate` mentah dengan indikator komposit: sumber unik + jenis studi + proporsi terverifikasi; label "kekuatan bukti").
- **Baru (kondisional):** 5 topik (Fornas, AMR, Interaksi Obat, Herbal, Metodologi) **hanya jika** sumbernya bisa diambil (`docs/guideline-plan.md` §A.1); `node scripts/build_topics.js`.
- **Validasi:** `node tests/grounded_unit.js`; `node tests/ui_harness.js`; `node scripts/build_topics.js --check`; `node scripts/validate_ai.js`.
- **Gate:** indikator tidak menampilkan 100% untuk jawaban abstain; topik baru lolos validator.
- **Rollback:** kembalikan label lama; hapus topik baru.

## 7. Risiko

| Risiko | Mitigasi |
|---|---|
| Roadmap mengerjakan ulang fitur yang ada | status matrix §1 wajib diperbarui |
| Template melanggar guardrail | red flag = eskalasi; no diagnosis/peresepan; disclaimer |
| Metrik bukti menyesatkan | definisi komposit (§5), abstain tidak dihitung "didukung" |
| Overclaim ke pengguna lokal | hanya janjikan yang bisa diambil (fetch-first) |
| Regresi perilaku | flag default OFF + uji + gate per fase |

## 8. Definition of Done

- `docs/strategy-review.md` sinkron dengan blueprint; kontradiksi (free tier, domain, tagline, PDF guideline) tuntas.
- N1 hijau (uji + cache); N2–N3 tervalidasi (patterns, chips, ekspor, bullets).
- N4 lokal-prioritas terbukti via uji ranking; N5 indikator komposit tidak menyesatkan.
- Semua validator + unit test + CI hijau; produksi terverifikasi.
