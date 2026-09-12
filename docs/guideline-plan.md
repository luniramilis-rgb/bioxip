# bioXip — Rencana Integrasi Sumber Kedokteran Lokal (Pedoman & Kebijakan)

Dokumen hidup. Rencana ini **turunan** dari `docs/blueprint.md` (arsitektur), `docs/knowledge.md` (**K4** — "lapisan fakta terstruktur + snapshot guideline nasional"), dan `docs/strategy.md` (**S4** — lapisan lokal). Setiap perubahan dicatat di `docs/blueprint.md`.

Prinsip arsitektur: **pakai ulang pola formulary** (`sources → staging → validate → publish → view publik → RPC pencarian`) di Postgres. Simpan **metadata + pointer + kutipan ringkas**, **bukan dokumen penuh**. FTS/trigram + cache edge; **tanpa stack baru**. Parquet/R2 ditunda (lihat §F).

**Keputusan kebijakan (2026-09-12):** **fetch-first** — fokus pada data yang **bisa di-fetch** dari endpoint publik. **Gate lisensi/MoU/kesepakatan DIHAPUS** sebagai penghambat; kebijakan penggantinya: ambil dari endpoint publik, simpan pointer + snippet + **atribusi sumber**, jangan menyalin dokumen penuh, dan sediakan kanal koreksi/takedown.

**Status (2026-09-12):** rencana disusun & direvisi (fetch-first); **belum ada kode/migrasi**. Kandidat sumber sudah **diuji jangkauan** (§A.1) — mulai dari yang ber-API JSON agar hemat & cepat.

---

## A. Prinsip keamanan implementasi (berlaku semua fase)

1. **Migrasi aditif saja** — tidak ada `DROP`/ubah tipe pada file lama; koreksi = migrasi baru.
2. **Feature flag default OFF** (`GUIDELINE_DB`) — produksi tetap jalur lama sampai terbukti.
3. **Fetch-first & tanpa gate lisensi** — ambil dari endpoint publik/formal; simpan **metadata + pointer + kutipan ringkas** + atribusi, bukan salinan penuh; sumber yang tidak bisa di-fetch wajar -> cukup **link-out**.
4. **Tata kelola:** `verified_by` **opsional (label internal, bukan gate)**. Yang **wajib**: provenance (`source`, edisi, `url`, `fetched_at`, `locator`) + disclaimer + tautan ke sumber resmi.
5. **Two-phase publish** — `staging -> validated -> published`; data mentah tidak pernah tersaji.
6. **Cache versioning** — naikkan namespace saat sumber berubah (`guideline:v1`).
7. **Rahasia & izin** — `service_role` hanya server/CI; kunci API hanya header `apikey`; `anon` read-only.
8. **Dry-run sebelum produksi**; rollback = matikan flag / revert commit.
9. **Setiap fase punya gate** yang wajib hijau sebelum lanjut.

## A.1 Source Registry (hasil probe 2026-09-12, fetch-first)

| Tier | Sumber | Endpoint | Format | Hasil probe | Nilai |
|---|---|---|---|---|---|
| **T1** | **e-Fornas (Kemenkes)** | `e-fornas.kemkes.go.id/api/daftar-obat` | JSON | 200 ✅ | Obat nasional (sudah dipakai) |
| **T1** | **Farmalkes (Kemenkes)** | `farmalkes.kemkes.go.id/wp-json/wp/v2/posts` | JSON (WP REST) | 200 ✅ | Berita/regulasi farmasi |
| **T1** | **WHO GHO** | `ghoapi.azureedge.net/api/...` | JSON | 200 ✅ | Statistik kesehatan |
| **T1** | **DOAJ / Crossref** | `/api/search/articles`, `api.crossref.org/works` | JSON | 200 ✅ | Metadata jurnal OA (sudah) |
| **T2** | **Neliti** | `neliti.com/oai` | OAI-PMH XML | 200 ✅ | Metadata jurnal (harvest) |
| **T3** | **peraturan.bpk.go.id** | `/Search?keywords=...` | HTML (+PDF) | 200 ✅ | Regulasi nasional |
| **T3** | **JDIH Kemenkes** | `jdih.kemkes.go.id` | HTML/PDF | 200 ✅ | Regulasi/pedoman |
| **T3** | **pom.go.id / cekbpom** | berita/izin edar | HTML/XHR | 200 ✅ | Pengawasan obat |
| **T3** | **infeksiemerging / P2PTM** | `*.kemkes.go.id` | HTML | 200 ✅ | Program & panduan |
| **T3** | **WHO Indonesia** | `who.int/indonesia` | HTML | 200 ✅ | Ringkasan kebijakan |
| **T4** | PNPK/Permenkes PDF | via JDIH/peraturan.bpk | PDF | tautan ✅ | Pedoman resmi (ekstraksi per-bagian) |
| **T5** | sehatnegeriku, litbang, PIONAS, yankes, Garuda, jdihn | — | — | ❌ gagal/timeout | Retry berkala / link-out |

**Prinsip pemilihan:** utamakan **T1 JSON** (tanpa parsing berat), lalu **T3 HTML** dengan mencari **endpoint JSON internal** lebih dulu (pola `/wp-json/`, `/api/...`), lalu T4 PDF (ekstraksi per-bagian + pointer halaman).

## B. Struktur file

| Fase | Baru | Diubah |
|---|---|---|
| L0 | `docs/guideline-plan.md`, `docs/guideline.md`, `supabase/migrations/023_guideline.sql`, `scripts/validate_guideline.js` | `docs/blueprint.md`, `AGENTS.md` |
| L1 | `harvester/providers/guideline.py`, `harvester/providers/farmalkes.py`, `harvester/providers/whogho.py`, `harvester/runners/ingest_guideline.py`, `tests/test_guideline.py` | `harvester/store.py` |
| L2 | `supabase/migrations/024_guideline_search.sql`, `functions/_guideline.js`, `tests/guideline_unit.js` | `functions/api/search.js`, `tests/functions_smoke.js` |
| L3 | `harvester/providers/regulator.py` (BPOM/PIONAS/SKI) | `functions/api/search.js` |
| L4 | — (sumber profesi, fetch-first) | `harvester/providers/guideline.py`, docs |
| L5 | `scripts/validate_guideline_live.mjs` | `.github/workflows/validate.yml`, `AGENTS.md`, `docs/blueprint.md` |

## C. Fase implementasi

### L0 — Kontrak data + skema (`023_guideline.sql`)
- **Tujuan:** kesepakatan skema, provenance, hierarki konflik sebelum kode.
- **Langkah:** tulis `docs/guideline.md` (field, sumber, edisi, aturan "tidak ditemukan"); migrasi `023_guideline.sql` (**aditif**) dengan:
  - `guideline_sources` (id, organisasi, judul, edisi, `effective_from/to`, url, `tier`, checksum, retrieved_at);
  - `guideline_recs` (id, source_id, topik, judul, rekomendasi, kelas/level bukti, **locator**, `keywords`, `search_text`, `search_tsv` generated `tsvector`, `verified`/`verified_by`/`verified_at` **opsional**, `valid_from/to`, checksum);
  - `guideline_topics` (slug, nama, deskripsi) + `guideline_topic_map` (topic_slug, rec_id);
  - `guideline_links` (link-out: title, url, source, note);
  - `guideline_staging` (kind, key, payload jsonb, checksum, status `pending|validated|rejected`) + `guideline_meta` (`dataset_version`);
  - index **GIN** `search_tsv` + **GIN trigram** pada judul/topik; view publik `guideline_recs_public` & `guideline_links_public`; **RLS** (anon/authenticated `SELECT` via view saja, `service_role` penuh) mengikuti pola `014/015`.
- **Validasi:**
  ```bash
  supabase db push --dry-run
  supabase db push
  node scripts/validate_security.js
  node scripts/validate_guideline.js
  ```
- **Gate:** dry-run bersih; `validate_security.js` hijau; ukuran < 20 MB.
- **Rollback:** aditif -> aman dibiarkan; bila perlu, migrasi baru untuk drop.

### L1 — Ingest sumber T1 + regulasi (fetch-first)
- **Tujuan:** mulai dari data yang **paling mudah di-fetch** (JSON), bukan menunggu kesepakatan.
- **Sumber awal:** **Farmalkes WP REST** (berita/regulasi farmasi) dan **WHO GHO** (statistik) sebagai T1; plus **metadata regulasi** dari `peraturan.bpk.go.id`/JDIH (T3, tautan PDF) untuk topik prioritas (**TB, DBD, HIV/ART**).
- **Langkah:** `harvester/providers/guideline.py` (registry + normalize), `farmalkes.py`, `whogho.py`; `harvester/runners/ingest_guideline.py` (tulis `guideline_staging` -> `checksum` -> diff -> publish). Simpan **snippet + pointer** (url/locator), bukan full-text.
- **Validasi:**
  ```bash
  python -m pytest tests/test_guideline.py
  python -m compileall harvester
  ```
  + uji locator/tautan (halaman/section benar; HTTP status tautan).
- **Gate:** provenance 100% (source/edition/url/locator); coverage topik terukur; 0 tautan mati.
- **Rollback:** `truncate guideline_staging`; `guideline_recs` tetap versi terakhir yang baik.

### L2 — Pencarian + routing (`024_guideline_search.sql`, flag OFF)
- **Tujuan:** pertanyaan klinis Indonesia memakai **lapisan guideline lebih dulu**, literatur global kedua.
- **Langkah:** RPC read-only `fn_guideline_search(q, limit)` (peringkat: exact topik > FTS > trigram) atas view publik, grant `anon`; `functions/_guideline.js` (RPC + cache `guideline:v1` + fallback kosong); integrasi `api/search.js` di balik env `GUIDELINE_DB` (default OFF), tampilkan `source`, edisi, **locator**, tautan.
- **Validasi:**
  ```bash
  node tests/guideline_unit.js
  node tests/functions_smoke.js
  node tests/rank_unit.js
  ```
- **Gate:** guideline muncul untuk pertanyaan ID terkait; flag OFF -> perilaku identik; 0 error 5xx.
- **Rollback:** `GUIDELINE_DB=off`.

### L3 — Regulator & epidemiologi
- **Langkah:** `harvester/providers/regulator.py` untuk BPOM/`pom.go.id`/cekbpom (izin edar, alerts) dan WHO GHO/WHO Indonesia; cari **endpoint JSON internal** lebih dulu, jika tidak -> parsing HTML + `guideline_links`. Uji status HTTP tautan.
- **Validasi:** `node scripts/validate_guideline.js` + uji manual.
- **Gate:** 0 tautan mati; tidak menyimpan dokumen penuh.
- **Rollback:** hapus baris `guideline_links` per sumber.

### L4 — Sumber profesi (fetch-first)
- **Langkah:** tambah sumber `tier=profesi` (Perkeni/PDPI/IDAI dst.) bila **bisa di-fetch**; jika tidak -> **link-out**. Hierarki konflik (PNPK/Permenkes > profesi > buku) & penandaan supersede edisi.
- **Gate:** provenance 100%; konflik antar-sumber ditampilkan, bukan dipilih diam-diam.
- **Rollback:** tahan sumber di staging.

### L5 — Link-out, validator live & CI
- **Langkah:** `guideline_links` untuk sumber tak-ter-fetch (buku ajar, dokumen berbayar); `scripts/validate_guideline_live.mjs` (anon baca view `guideline_recs_public` 200, tolak tabel dasar, RPC search, provenance 100%); daftarkan validator statis + unit test baru di `.github/workflows/validate.yml`; perbarui `AGENTS.md` + `docs/blueprint.md`.
- **Gate:** CI hijau; live ALL PASS.

## D. Matriks validasi

| Lapisan | Alat | Ambang |
|---|---|---|
| Skema DB | `validate_security.js` + dry-run | anon read-only; view publik benar |
| Data guideline | `validate_guideline.js`, `pytest test_guideline.py` | provenance + locator **100%**; coverage ≥ target |
| Tautan | `validate_guideline_live.mjs` | 0 tautan mati |
| API/routing | `guideline_unit.js`, `functions_smoke.js` | guideline diprioritaskan untuk pertanyaan ID; flag OFF aman |
| Pencarian | `fn_guideline_search` + `rank_unit` | hasil relevan; fuzzy benar |
| Keamanan | `validate_security_live.mjs` | anon ditolak di tabel sensitif |

## E. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Menyalin dokumen berhak cipta | simpan **pointer + snippet + atribusi**, bukan salinan penuh |
| Rekomendasi klinis salah/ketinggalan | provenance + `effective_from/to` + penandaan supersede; `verified_by` **disarankan** (label), bukan gate |
| Konflik antar-pedoman | hierarki PNPK > profesi > buku; tampilkan perbedaan |
| Ekstraksi PDF tidak akurat | ekstraksi per-bagian + locator; tahan publish bila gagal parse |
| Sumber tiba-tiba mati/blokir | registry T5 -> retry berkala + link-out |
| Migrasi mengganggu produksi | aditif, dry-run, staging |
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

- Skema `023`/`024` aditif; anon hanya membaca view publik.
- Sumber T1 (Farmalkes/WHO GHO) + regulasi T3 terimpor dengan **provenance + locator + tautan**; T5 -> link-out.
- Routing pertanyaan ID memakai guideline lebih dulu; literatur global kedua; flag OFF -> perilaku lama.
- Semua validator + unit test + CI hijau; produksi terverifikasi; `docs/blueprint.md` diperbarui.
