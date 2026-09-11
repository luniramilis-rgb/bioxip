# bioXip — Rencana Integrasi Data Obat Nasional & Literatur Indonesia

Dokumen hidup. Rencana ini **turunan** dari `docs/blueprint.md` (arsitektur), `docs/knowledge.md` (basis pengetahuan K4), dan `docs/strategy.md` (S4 lapisan lokal). Setiap perubahan dicatat di `docs/blueprint.md`.

Prinsip arsitektur: **Postgres = satu sumber kebenaran untuk data terstruktur; edge tipis; retrieval literatur live bercache; batch hanya untuk ingest & validasi.** Parquet/R2 **belum** dipakai (lihat §F).

**Status (2026-09-11):** Fase 0–2 selesai; **gate review manusia DIHAPUS** (keputusan produk) → publikasi dipandu validasi otomatis + provenance (migrasi `020`, runner `--validate` internal saat `--publish`, kolom `source_tier`/`retrieved_at`). Sumber resmi penuh dari **API e-Fornas** (`/api/daftar-obat`, 1.254 baris → 663 obat unik) diimpor via `--from-fornas-api` dan **dipublikasikan otomatis**. Prinsip aman-tervalidasi tetap: migrasi aditif, validasi `validate_records` sebelum publish, provenance/`source_tier`, versioning `dataset_version`, fallback `_drugs.json`, dry-run. Fase 3+ (API baca DB) belum dikerjakan. Catatan: ATC belum tersedia dari API Fornas.

---

## A. Prinsip keamanan implementasi (berlaku semua fase)

1. **Migrasi aditif saja** — tidak ada `DROP`/ubah tipe pada file lama; koreksi = migrasi baru.
2. **Feature flag default OFF** (`FORMULARY_DB`, `LIT_SOURCES`) — produksi tetap jalur lama sampai terbukti.
3. **Fallback wajib** — `_drugs.json` dipertahankan; DB opsional.
4. **Two-phase publish** — `staging → reviewed → published`; data mentah tidak pernah tersaji.
5. **Cache versioning** — naikkan namespace saat sumber berubah (`formulary:v1`, `search:v8`).
6. **Rahasia & izin** — `service_role` hanya server/CI; kunci API hanya di header `apikey`; `anon` read-only.
7. **Dry-run sebelum produksi**; rollback = matikan flag / revert commit.
8. **Setiap fase punya gate** yang wajib hijau sebelum lanjut.

## B. Struktur file

| Fase | Baru | Diubah |
|---|---|---|
| 0 | `docs/formulary-plan.md`, `docs/formulary.md`, `docs/literature.md` | — |
| 1 | `supabase/migrations/017_formulary.sql` | — |
| 2 | `harvester/providers/formulary.py`, `harvester/runners/ingest_formulary.py`, `tests/test_formulary.py` | `harvester/normalize.py`, `harvester/store.py` |
| 3 | `functions/_formulary.js`, `tests/formulary_unit.js` | `functions/api/drug.js`, `functions/api/suggest.js`, `tests/functions_smoke.js` |
| 4 | `supabase/migrations/018_drug_search.sql` | `functions/api/suggest.js` |
| 5 | `functions/_literature/{crossref,doaj,neliti_oai,linkout}.js`, `tests/literature_unit.js` | `functions/api/search.js`, `functions/_cache.js` |
| 6 | `scripts/validate_formulary.js`, `scripts/validate_formulary_live.mjs` | `.github/workflows/validate.yml`, `AGENTS.md`, `docs/blueprint.md` |
| 7 | — | deploy + verifikasi |

## C. Fase implementasi

### Fase 0 — Kontrak data & dokumentasi
- **Tujuan:** kesepakatan skema, provenance, kebijakan konflik sebelum kode.
- **Langkah:** tulis `docs/formulary.md` (field, sumber, `effective_from`, aturan review, semantik "tidak ditemukan") dan `docs/literature.md` (adapter, lisensi, link-out).
- **Gate:** review manual; tidak ada perubahan runtime.
- **Rollback:** hapus file.

### Fase 1 — Migrasi skema fakta (`017_formulary.sql`)
- **Tujuan:** tabel + view + FTS tanpa mengubah tabel lama.
- **Isi:** `fact_sources`, `drug_products`, `drug_doses`, `drug_interactions`, `drug_monitoring`, `drug_crosswalk`, `formulary_staging`; ekstensi `pg_trgm` + `unaccent`; kolom `search_tsv` (generated `tsvector`) + index **GIN**; index **GIN trigram** pada nama; view `drug_products_public`; **RLS** (`anon`/`authenticated` hanya `SELECT` via view, `service_role` penuh) mengikuti pola `014/015`.
- **Validasi:**
  ```bash
  supabase db push --dry-run
  supabase db push
  node scripts/validate_security.js
  ```
- **Gate:** dry-run bersih; `validate_security.js` hijau; ukuran tabel < 20 MB.
- **Rollback:** aditif → aman dibiarkan; bila perlu, migrasi baru untuk drop.

### Fase 2 — Importer & seeding (harvester Python)
- **Tujuan:** impor Fornas penuh dengan diff + review.
- **Langkah:** `harvester/providers/formulary.py` (baca snapshot berizin) → `harvester/normalize.py` (nama, INN, kekuatan, sediaan, satuan, ATC) → `harvester/runners/ingest_formulary.py` (tulis `formulary_staging` → `checksum` → tandai perubahan → publikasi hanya `reviewed`). Seed 30 obat yang ada lebih dulu untuk uji parity.
- **Validasi:**
  ```bash
  python -m pytest tests/test_formulary.py
  python -m compileall harvester
  ```
  + uji parity 30 item (JSON vs DB identik).
- **Gate:** tes hijau; parity lulus; coverage terukur.
- **Rollback:** `truncate formulary_staging`; `drug_products` tetap versi terakhir yang baik.

### Fase 3 — API baca DB + fallback (flag OFF)
- **Tujuan:** `/api/drug` & `/api/suggest` baca Postgres, fallback JSON bila flag off.
- **Langkah:** `functions/_formulary.js` (helper `select` via `api/_db.js` + cache); `api/drug.js` coba DB → fallback; `api/suggest.js` sama.
- **Validasi:**
  ```bash
  node --check functions/_formulary.js
  node tests/formulary_unit.js
  node tests/functions_smoke.js
  node scripts/validate_imports.js
  ```
- **Gate:** DB hit & fallback terbukti; 0 error 5xx.
- **Rollback:** `FORMULARY_DB=off` → jalur lama.

### Fase 4 — Pencarian FTS/trigram (`018_drug_search.sql`)
- **Tujuan:** pencarian nama/INN/nama dagang/alias/ATC berbobot.
- **Langkah:** RPC read-only `fn_drug_search(q, limit)` (SECURITY INVOKER, grant ke `anon`) atas view; ranking exact > alias > prefix > kelas.
- **Validasi:**
  ```bash
  node tests/formulary_unit.js
  node scripts/validate_formulary_live.mjs
  ```
- **Gate:** ranking & fuzzy benar (mis. `parasetamol`/`paracetamol`).
- **Rollback:** `suggest` kembali ke pencarian JSON.

### Fase 5 — Adapter literatur + link-out (flag OFF)
- **Tujuan:** Crossref, DOAJ, Neliti OAI masuk fan-out; Garuda/OneSearch hanya link-out.
- **Langkah:** `functions/_literature/crossref.js` (REST + `mailto` polite), `doaj.js` (REST v4/OAI), `neliti_oai.js` (OAI-PMH `oai_dc`, resumption token), `linkout.js` (Garuda/OneSearch/PIONAS tanpa menyimpan); `api/search.js` menambah sumber, dedupe DOI, tandai `source` + `license`; `_cache.js` namespace `search:v8`.
- **Aturan:** metadata-only; abstrak disimpan **hanya bila `license` jelas**; tanpa full-text.
- **Validasi:**
  ```bash
  node tests/literature_unit.js
  node tests/rank_unit.js
  node scripts/validate_api.js
  ```
- **Gate:** dedupe DOI benar; lisensi dihormati; rate limit aman.
- **Rollback:** matikan per-sumber via flag.

### Fase 6 — Validator & CI
- **Baru:** `scripts/validate_formulary.js` (skema wajib, provenance 100%, ATC valid, slug unik, coverage ≥ target, status HTTP tautan sumber) dan `scripts/validate_formulary_live.mjs` (anon read + search live).
- **Langkah:** daftarkan validator + unit test baru di `.github/workflows/validate.yml`; perbarui `AGENTS.md` + `docs/blueprint.md`.
- **Gate:** seluruh CI hijau.

### Fase 7 — Deploy & verifikasi produksi
```bash
supabase db push --dry-run
supabase db push
git push origin main
```
- **Verifikasi:** `node scripts/validate_security_live.mjs`; `node scripts/validate_formulary_live.mjs`; `node scripts/validate_api.js`.
- Lalu nyalakan `FORMULARY_DB=on`, `LIT_SOURCES=crossref,doaj,neliti`.
- **Gate:** `/api/health` ok; `/api/drug` & `/api/suggest` benar; pencarian literatur menampilkan sumber lokal.
- **Rollback:** matikan flag → jalur lama; revert commit bila perlu.

## D. Matriks validasi

| Lapisan | Alat | Ambang |
|---|---|---|
| Skema DB | `validate_security.js` + dry-run | anon read-only; 0 grant tulis |
| Data fakta | `validate_formulary.js`, `pytest test_formulary.py` | provenance 100%, coverage ≥ target |
| API | `tests/formulary_unit.js`, `functions_smoke.js` | DB hit + fallback; 0 error 5xx |
| Pencarian | `formulary_unit`, `rank_unit` | ranking & fuzzy benar |
| Literatur | `literature_unit`, `validate_api.js` | dedupe DOI; lisensi dihormati |
| Keamanan | `validate_security_live.mjs` | anon ditolak di tabel sensitif |
| Produksi | `validate_formulary_live.mjs` | live ALL PASS |

## E. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Migrasi mengganggu produksi | aditif, dry-run, staging |
| Data mentah tersaji | two-phase + RLS view |
| DB down | fallback JSON + flag |
| Hak cipta literatur | metadata-only + link-out + `license` |
| Rate limit OA | queue + cache + `mailto` |
| Cache basi | `dataset_version` + namespace bump |
| Over-engineering | Parquet tidak dipakai sampai pemicu muncul |

## F. Ditunda — Parquet/R2 cold layer

Ditunda. Dibuka hanya bila salah satu pemicu muncul:
1. Indeks literatur Indonesia lokal skala besar (ratusan ribu–jutaan metadata).
2. Log/analitik melewati kuota Supabase atau butuh query analitik berat.
3. Kebutuhan arsip reproduktif snapshot sumber per edisi.
4. Ekspor data / API B2B bervolume besar.

Catatan teknis bila saatnya tiba: Parquet di R2 (egress $0) + DuckDB batch untuk validasi/transformasi; opsional R2 SQL (Iceberg) atau DuckDB WASM Worker (butuh Workers Paid, ~9,7 MB) — **hanya untuk analitik non-kritis**, bukan hot path.

## G. Definition of Done

- Fornas penuh terimpor dengan provenance & review; coverage terukur.
- `/api/drug` & `/api/suggest` baca DB dengan fallback; pencarian FTS/trigram hijau.
- Sumber literatur (Crossref/DOAJ/Neliti) aktif; Garuda/OneSearch link-out.
- Semua validator + unit test + CI hijau; produksi terverifikasi.
- `docs/blueprint.md` diperbarui.
