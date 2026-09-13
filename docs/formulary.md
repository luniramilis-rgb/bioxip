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
| `drug_products` | Identitas & status obat + katalog Fornas (flag, restriksi, `variants`) | `slug` |
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

## 4b. Katalog Fornas diperluas (025)
- Sumber resmi: `GET https://e-fornas.kemkes.go.id/api/daftar-obat` (JSON publik, **1.254 baris SKU → 663 obat unik**). Halaman `guest/daftar-obat` adalah SPA Next.js yang membaca endpoint yang sama, jadi integrasi memakai API (bukan parse HTML) — setara "scraping" tanpa rapuh.
- Importer `map_fornas_catalog` mengelompokkan baris per `id_obat` dan menyimpan **seluruh atribut publik**: `fornas_id_obat`, `komposisi`, `satuan`, flag `status_fpktp/fpktl/prb/pp/oen/program/kanker`, `peresepan_maksimal`, `restriksi_obat`/`restriksi_sediaan`/`restriksi_kelas[]`, dan **`variants`** (daftar sediaan × kekuatan × satuan per SKU).
- `variants` hanya menyimpan kunci yang terisi (tanpa nilai `null`/`N/A`), diurut deterministik `(sediaan, kekuatan, kode_sediaan)`, duplikat dibuang agar `checksum` stabil.
- Sumber ATC/NIE/harga **tidak** ada di API ini; ATC tetap via RxClass (`enrich_atc.py`), NIE/harga dibiarkan kosong (semantik "tidak ditemukan" = valid).
- **Publish aman**: upsert `on_conflict=slug` menimpa semua kolom payload, jadi `ingest_formulary` memanggil `preserve_existing_drug_fields` untuk membawa `atc` lama dan mempertahankan provenance `curated` pada slug yang beririsan — API Fornas tidak boleh menghapus fakta yang tidak disediakannya.

## 5. Kebijakan konflik & kelengkapan
- Prioritas: **Fornas/BPOM > label asing (openFDA/DailyMed)**.
- Bila sumber berbeda, catat perbedaan (di `catatan`/`sumber`), jangan pilih diam-diam.
- Bila data tidak ada: tandai eksplisit, jangan diisi nilai default.

## 6. Validasi otomatis & provenance (menggantikan review manusia)
- **Keputusan 2026-09-11:** gate review manusia dihapus. Publikasi dipandu **validasi otomatis** + provenance.
- `source_tier`: `official` (API/label resmi) · `curated` (kurasi internal) · `derived`.
- Validasi sebelum publish: field wajib, slug unik, severitas valid, pasangan interaksi tidak diri sendiri, kelengkapan monitoring (`formulary.validate_records`). Gagal → publish dibatalkan (`--allow-invalid` untuk memaksa).
- Setiap baris menyimpan `source_id`, `source_tier`, `retrieved_at`, `checksum`, `valid_from/valid_to`.
- Perubahan edisi: tutup baris lama (`valid_to`) dan sisip baris baru — jangan menimpa riwayat.
- Disclaimer wajib di UI: data referensi, bukan pengganti penilaian klinis. Label sumber ditampilkan (mis. "Fornas (API resmi)" vs "Kurasi internal").

## 7. Akses & keamanan
- `anon`/`authenticated`: **hanya SELECT lewat view publik** (`drug_products_public`, dst.).
- Tabel dasar: RLS aktif, akses dicabut dari anon/authenticated.
- Penulisan hanya via `service_role` (harvester/CI).

## 8. Versi & cache
- `formulary_meta.dataset_version` dinaikkan setiap publish → kunci cache edge (`formulary:v<N>`).
- Perubahan skema sumber = migrasi baru (`NNN_*.sql`), bukan edit migrasi lama.
