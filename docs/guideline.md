# bioXip — Kontrak Data: Pedoman Klinis Lokal (Guideline)

Dokumen hidup. Turunan dari `docs/guideline-plan.md` (fase L0) dan pelengkap `docs/blueprint.md`. Menjadi acuan `supabase/migrations/023_guideline.sql`.

Prinsip: **hemat storage, ringan, akurat**. **Tanpa PDF/full-text** — hanya **ringkasan pendek + pointer + provenance**.

## 1. Tujuan
- Menyediakan **rekomendasi klinis lokal** (PNPK/Permenkes/profesi/regulator) sebagai lapisan prioritas untuk pertanyaan berbahasa Indonesia, tanpa menyimpan dokumen.

## 2. Skema (1 tabel inti)
`guideline_recs`:
| Kolom | Aturan |
|---|---|
| `source_id` | FK ke `fact_sources` (registri sumber yang sudah ada) |
| `tier` | `pnk` \| `permenkes` \| `profesi` \| `regulator` \| `epidemiologi` |
| `topik` | slug topik (mis. `tb`, `dbd`, `hipertensi`) |
| `ringkasan` | **kutipan ringkas ≤ 300 karakter** (bukan salinan penuh) |
| `kelas` | kelas/level bukti (opsional) |
| `locator` | **wajib** — halaman/section dokumen (mis. `hal. 12`) |
| `url` | **wajib** — tautan ke dokumen resmi |
| `keywords` | sinonim Indonesia untuk pencarian |
| `search_text` | gabungan ringkasan + keywords + topik (diisi importer) |
| `search_tsv` | generated `tsvector` (`simple`) |
| `valid_from` / `valid_to` | masa berlaku; edisi baru menutup baris lama |
| `verified_by` / `verified_at` | **opsional** (label internal, bukan gate) |
| `checksum` | deteksi perubahan saat ingest |

View publik: `guideline_recs_public` (join `fact_sources`, filter masih berlaku). RPC: `fn_guideline_search(p_query, p_topik, p_limit)`.

## 3. Aturan hemat & ringan
- **Tidak** menyimpan PDF, teks penuh, atau tabel dokumen.
- **Tidak** memakai pgvector/embedding; pencarian FTS + trigram.
- **Pakai ulang:** `fact_sources` (sumber/edisi), `formulary_staging` (kind `guideline_rec`), `formulary_meta` (`dataset_version`), `web/data/topics.json` (topik).
- Estimasi: ratusan baris × ±400 B ≈ **< 0,5 MB**.

## 4. Akurasi
- Provenance wajib: `source_id`, `locator`, `url`, edisi (di `fact_sources`), `valid_from`.
- Hierarki konflik: `pnk` > `permenkes` > `profesi` > `regulator`; bila >1 → tampilkan semua.
- Supersede edisi: set `valid_to` baris lama, sisip baris baru (jangan menimpa).
- "Tidak ditemukan di sumber" = status valid; jangan menebak.
- Guardrail: tanpa diagnosis/peresepan; red flag → arahan gawat darurat; setiap keluaran `sources[]` + disclaimer.

## 5. Akses
- `anon`/`authenticated`: **hanya SELECT lewat view**; tabel dasar dicabut.
- RPC `fn_guideline_search` boleh `anon` (read-only); tulis hanya `service_role`.

## 6. Ingest
- Ambil metadata (+ PDF sementara bila perlu) di runner; ekstraksi per-bagian → tulis `ringkasan` + `locator`; dokumen **dibuang**.
- Alur: `staging → checksum/diff → validasi → publish`; naikkan `dataset_version`.
