# bioXip — Kontrak Data: Fakta Obat (Formulary)

Dokumen hidup. Turunan dari `docs/formulary-plan.md` (Fase 0) dan pelengkap `docs/blueprint.md`. Menjadi acuan skema `supabase/migrations/017_formulary.sql`.

## 1. Tujuan & prinsip
- Menyimpan **fakta obat ringkas** (bukan dokumen penuh) + **provenance**, agar akurat dan hemat storage.
- Satu sumber kebenaran: Postgres. Teks panjang (label/monografi) diambil live dan **tidak disimpan**.
- **Two-phase**: `formulary_staging` (mentah) → review apoteker → tabel published → view publik.
- Semantik "tidak ditemukan di sumber" adalah jawaban valid; jangan menebak.

## 2. Skema tabel (017)
| Tabel | Isi | Kunci |
|---|---|---|
| `fact_sources` | Registri sumber + edisi + lisensi | `id` |
| `drug_products` | Identitas & status obat | `slug` |
| `drug_doses` | Dosis per populasi/indikasi | `id` (FK `drug_slug`) |
| `drug_interactions` | Pasangan interaksi | `id`, unik `(a_slug,b_slug)` |
| `drug_monitoring` | Parameter pemantauan | `id` (FK `drug_slug`) |
| `drug_crosswalk` | Pemetaan ATC/RxNorm/MeSH/INN | `id`, unik `inn` |
| `formulary_staging` | Antrean ingest + review | `id` |
| `formulary_meta` | Metadata dataset (mis. `dataset_version`) | `key` |

## 3. Field wajib & provenance
- Setiap fakta menyimpan: `source_id` (FK `fact_sources`), `valid_from`, `valid_to` (nullable), `reviewed`, `reviewed_by`, `reviewed_at`, `checksum`.
- `fact_sources` menyimpan metadata edisi **sekali**: `edisi`, `berlaku_dari`, `berlaku_sampai`, `url`, `lisensi`, `retrieved_at`.
- Baris hanya tersaji bila `reviewed = true` **dan** (`valid_to` null atau ≥ hari ini).

## 4. Normalisasi
- Nama: `nama` (Indonesia), `inn`, `us_name` (opsional), `aliases[]`.
- `search_text` = gabungan nama + INN + us_name + alias + kelas + ATC (diisi importer) → diturunkan ke `search_tsv` (generated, `to_tsvector('simple', …)`).
- Kekuatan & sediaan disimpan sebagai teks terstruktur ringkas (`kekuatan`, `bentuk_sediaan`, `rute`); jangan menyimpan tabel konversi.
- Satuan mengikuti sumber; konversi khusus (mis. besi elemental vs garam) ditulis di `catatan`.

## 5. Kebijakan konflik & kelengkapan
- Prioritas: **Fornas/BPOM > label asing (openFDA/DailyMed)**.
- Bila sumber berbeda, catat perbedaan (di `catatan`/`sumber`), jangan pilih diam-diam.
- Bila data tidak ada: tandai eksplisit, jangan diisi nilai default.

## 6. Tata kelola review
- Hanya baris `reviewed = true` (dengan `reviewed_by` + `reviewed_at`) yang tersaji publik.
- Reviewer: 1 apoteker (+ 1 dokter bila menyangkut keputusan klinis).
- Perubahan edisi: tutup baris lama (`valid_to`) dan sisip baris baru — jangan menimpa riwayat.

## 7. Akses & keamanan
- `anon`/`authenticated`: **hanya SELECT lewat view publik** (`drug_products_public`, dst.).
- Tabel dasar: RLS aktif, akses dicabut dari anon/authenticated.
- Penulisan hanya via `service_role` (harvester/CI).

## 8. Versi & cache
- `formulary_meta.dataset_version` dinaikkan setiap publish → kunci cache edge (`formulary:v<N>`).
- Perubahan skema sumber = migrasi baru (`NNN_*.sql`), bukan edit migrasi lama.
