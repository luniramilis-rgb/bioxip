# bioXip — Rencana Integrasi Sumber Kedokteran Lokal (Pedoman & Kebijakan)

Dokumen hidup. Rencana ini **turunan** dari `docs/blueprint.md` (arsitektur), `docs/knowledge.md` (basis pengetahuan **K4** — "lapisan fakta terstruktur + snapshot guideline nasional"), dan `docs/strategy.md` (**S4** — lapisan lokal: Fornas/BPOM + guideline Perkeni/PDPI/IDAI/PB IDI + tautan lokal). Setiap perubahan dicatat di `docs/blueprint.md`.

Prinsip arsitektur: **pakai ulang pola formulary** (`sources → staging → validate → publish → view publik → RPC pencarian`) di Postgres. Simpan **rekomendasi tingkat-fakta + pointer** (halaman/section/URL), **bukan PDF penuh**. FTS/trigram + cache edge; **tanpa stack baru**. Parquet/R2 ditunda (lihat §F).

**Status (2026-09-12):** **rencana disusun, belum diimplementasikan.** Prasyarat wajib sebelum L1: (a) kesepakatan lisensi/atribusi per sumber, (b) **dokter penanggung jawab klinis** untuk sign-off rekomendasi. Berbeda dari Fornas (fakta salinan pemerintah), **rekomendasi klinis tidak boleh auto-publish tanpa verifikasi klinis** (lihat §A.3).

---

## A. Prinsip keamanan implementasi (berlaku semua fase)

1. **Migrasi aditif saja** — tidak ada `DROP`/ubah tipe pada file lama; koreksi = migrasi baru.
2. **Feature flag default OFF** (`GUIDELINE_DB`) — produksi tetap jalur lama sampai terbukti.
3. **Tata kelola berjenjang (BEDA dari Fornas):**
   - metadata & **link-out** → boleh otomatis;
   - **rekomendasi klinis terstruktur → wajib `verified_by` dokter** (atau berlabel "draf, belum diverifikasi"). Gate ini **tidak** boleh dihapus.
4. **Two-phase publish** — `staging → validated → published`; data mentah tidak pernah tersaji.
5. **Provenance wajib** — `source_id`, edisi, `effective_from/to`, **locator** (halaman/section), `checksum`.
6. **Lisensi & batasan salin** — dokumen pemerintah (atribusi); pedoman profesi/buku → **MoU** atau **link-out saja**; jangan memparafrase makna klinis (`strategy.md:21`).
7. **Cache versioning** — naikkan namespace saat sumber berubah (`guideline:v1`).
8. **Rahasia & izin** — `service_role` hanya server/CI; kunci API hanya header `apikey`; `anon` read-only.
9. **Dry-run sebelum produksi**; rollback = matikan flag / revert commit.
10. **Setiap fase punya gate** yang wajib hijau sebelum lanjut.

## B. Struktur file

| Fase | Baru | Diubah |
|---|---|---|
| L0 | `docs/guideline-plan.md`, `docs/guideline.md`, `supabase/migrations/023_guideline.sql`, `scripts/validate_guideline.js` | `docs/blueprint.md`, `AGENTS.md` |
| L1 | `harvester/providers/guideline.py`, `harvester/runners/ingest_guideline.py`, `tests/test_guideline.py` | `harvester/store.py` |
| L2 | `supabase/migrations/024_guideline_search.sql`, `functions/_guideline.js`, `tests/guideline_unit.js` | `functions/api/search.js`, `tests/functions_smoke.js` |
| L3 | `harvester/providers/regulator.py` (BPOM/PIONAS/epidemiologi) | `functions/api/search.js` |
| L4 | — (konten berizin) | `harvester/providers/guideline.py`, docs |
| L5 | `scripts/validate_guideline_live.mjs` | `.github/workflows/validate.yml`, `AGENTS.md`, `docs/blueprint.md` |

## C. Fase implementasi

### L0 — Kontrak data + skema (`023_guideline.sql`)
- **Tujuan:** kesepakatan skema, provenance, hierarki konflik, dan tata kelola sebelum kode.
- **Langkah:** tulis `docs/guideline.md` (field, sumber, edisi, aturan verifikasi, semantik "tidak ditemukan"); migrasi `023_guideline.sql` (**aditif**) dengan:
  - `guideline_sources` (id, organisasi, judul, edisi, `effective_from/to`, url, `license`, `tier` ∈ `pnk/permenkes/profesi/regulator/buku/epidemiologi`, checksum, retrieved_at);
  - `guideline_recs` (id, source_id, topik, judul, rekomendasi, kelas/level bukti, **locator**, `keywords`, `search_text`, `search_tsv` generated `tsvector`, `verified`/`verified_by`/`verified_at`, `valid_from/to`, checksum, unik `(source_id, topik, locator)`);
  - `guideline_topics` (slug, nama, deskripsi) + `guideline_topic_map` (topic_slug, rec_id);
  - `guideline_links` (link-out: title, url, source, license, note);
  - `guideline_staging` (kind, key, payload jsonb, checksum, status `pending|validated|rejected`, `verified_by/at`) + `guideline_meta` (`dataset_version`);
  - index **GIN** `search_tsv` + **GIN trigram** pada judul/topik; view publik `guideline_recs_public` (**hanya `verified` + masih berlaku**) & `guideline_links_public`; **RLS** (anon/authenticated `SELECT` via view saja, `service_role` penuh) mengikuti pola `014/015`.
- **Validasi:**
  ```bash
  supabase db push --dry-run
  supabase db push
  node scripts/validate_security.js
  node scripts/validate_guideline.js
  ```
- **Gate:** dry-run bersih; `validate_security.js` hijau; view publik **tidak** mengekspos baris `verified=false`; ukuran < 20 MB.
- **Rollback:** aditif → aman dibiarkan; bila perlu, migrasi baru untuk drop.

### L1 — Ingest 3 topik program nasional (mulai dari yang dokumennya publik)
- **Topik awal:** **TB, DBD, HIV/ART** (dokumen pemerintah; legal & bernilai tinggi).
- **Langkah:** `harvester/providers/guideline.py` (ekstraksi **per-bagian**, bukan full-text; simpan pointer halaman) → `harvester/runners/ingest_guideline.py` (tulis `guideline_staging` → `checksum` → diff → **publish hanya setelah `verified`**). Seed 1–2 rekomendasi lebih dulu untuk uji parity ekstraksi.
- **Validasi:**
  ```bash
  python -m pytest tests/test_guideline.py
  python -m compileall harvester
  ```
  + uji locator (halaman/section menunjuk bagian yang benar).
- **Gate:** ekstraksi lolos verifikasi dokter; coverage topik terukur; 0 rekomendasi tanpa locator.
- **Rollback:** `truncate guideline_staging`; `guideline_recs` tetap versi terakhir yang baik.

### L2 — Pencarian + routing (`024_guideline_search.sql`, flag OFF)
- **Tujuan:** pertanyaan klinis Indonesia memakai **lapisan guideline lebih dulu**, literatur global kedua.
- **Langkah:** RPC read-only `fn_guideline_search(q, limit)` (peringkat keyakinan: exact topik > FTS > trigram) atas view publik, grant `anon`; `functions/_guideline.js` (baca RPC + cache `guideline:v1` + fallback kosong); integrasi `api/search.js` di balik env `GUIDELINE_DB` (default OFF), tampilkan `source`, edisi, dan **locator**.
- **Validasi:**
  ```bash
  node tests/guideline_unit.js
  node tests/functions_smoke.js
  node tests/rank_unit.js
  ```
- **Gate:** guideline muncul untuk pertanyaan ID terkait; flag OFF → perilaku identik; 0 error 5xx.
- **Rollback:** `GUIDELINE_DB=off`.

### L3 — Regulator & epidemiologi (link-out + ringkasan)
- **Langkah:** `harvester/providers/regulator.py` untuk BPOM/PIONAS (izin edar, alerts), SKI/Riskesdas/Profil Kesehatan (`data.go.id`) → **ringkasan + tautan**, simpan ke `guideline_links` (bukan salinan penuh). Uji status HTTP tautan.
- **Validasi:** `node scripts/validate_guideline.js` (tautan HTTP-valid) + uji manual.
- **Gate:** 0 tautan mati; tidak ada salinan penuh dokumen berhak cipta.
- **Rollback:** hapus baris `guideline_links` per sumber.

### L4 — Pedoman profesi berizin (Perkeni/PDPI/IDAI dst.)
- **Prasyarat:** **MoU/lisensi** tertulis; tanpa itu → hanya link-out.
- **Langkah:** tambah sumber `tier=profesi` + rekomendasi terstruktur; hierarki konflik (PNPK/Permenkes > profesi > buku) & penandaan supersede edisi lama.
- **Gate:** lisensi tersimpan; konflik antar-sumber ditampilkan, bukan dipilih diam-diam.
- **Rollback:** tahan sumber di staging.

### L5 — Buku ajar/komersial (link-out saja) + validator live & CI
- **Langkah:** `guideline_links` untuk buku ajar (judul + tautan, tanpa isi); `scripts/validate_guideline_live.mjs` (anon baca view `guideline_recs_public` 200, tolak tabel dasar, RPC search, 0 rekomendasi tanpa `verified_by`); daftarkan validator statis + unit test baru di `.github/workflows/validate.yml`; perbarui `AGENTS.md` + `docs/blueprint.md`.
- **Gate:** CI hijau; live ALL PASS; legal review lulus.

## D. Matriks validasi

| Lapisan | Alat | Ambang |
|---|---|---|
| Skema DB | `validate_security.js` + dry-run | anon read-only; view hanya `verified` |
| Data guideline | `validate_guideline.js`, `pytest test_guideline.py` | provenance + locator 100%; coverage ≥ target |
| Tata kelola klinis | query live | **0 rekomendasi tanpa `verified_by`** |
| API/routing | `guideline_unit.js`, `functions_smoke.js` | guideline diprioritaskan untuk pertanyaan ID; flag OFF aman |
| Pencarian | `fn_guideline_search` + `rank_unit` | hasil relevan; fuzzy benar |
| Tautan | `validate_guideline_live.mjs` | 0 tautan mati |
| Keamanan | `validate_security_live.mjs` | anon ditolak di tabel sensitif |

## E. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| **Hak cipta pedoman/buku** | MoU atau link-out saja; jangan salin penuh |
| **Rekomendasi klinis salah/ketinggalan** | `verified_by` dokter + edisi `effective_from/to` + penandaan supersede |
| **Konflik antar-pedoman** | Hierarki PNPK > profesi > buku; tampilkan perbedaan |
| Ekstraksi PDF tidak akurat | ekstraksi per-bagian + locator + tolak publish bila gagal parse |
| Migrasi mengganggu produksi | aditif, dry-run, staging |
| Data mentah tersaji | two-phase + RLS view (`verified`) |
| Over-engineering | reuse Postgres/FTS; Parquet ditunda sampai pemicu |
| Cache basi | `dataset_version` + namespace bump |

## F. Ditunda — Parquet/R2 cold layer

Ditunda. Dibuka hanya bila salah satu pemicu muncul:
1. Snapshot pedoman per edisi dalam jumlah besar untuk arsip reproduktif.
2. Log/analitik melewati kuota Supabase atau butuh query analitik berat.
3. Indeks literatur/pedoman lokal skala besar (ratusan ribu+ baris).
4. Ekspor data / API B2B bervolume besar.

Catatan teknis bila saatnya tiba: Parquet di R2 (egress $0) + DuckDB batch; opsional R2 SQL (Iceberg) atau DuckDB WASM Worker (butuh Workers Paid) — **hanya analitik non-kritis**, bukan hot path.

## G. Definition of Done

- Skema `023`/`024` aditif, RLS benar; anon hanya membaca view `verified`.
- 3 topik program nasional terimpor dengan **locator + `verified_by`**; hierarki konflik & supersede berjalan.
- Routing pertanyaan ID memakai guideline lebih dulu; literatur global kedua; flag OFF → perilaku lama.
- BPOM/PIONAS/epidemiologi & buku ajar hanya **link-out/ringkasan** (legal).
- Semua validator + unit test + CI hijau; produksi terverifikasi; `docs/blueprint.md` diperbarui.
