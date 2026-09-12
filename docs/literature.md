# bioXip — Kontrak Data: Literatur Indonesia

Dokumen hidup. Turunan dari `docs/formulary-plan.md` (Fase 0) dan pelengkap `docs/blueprint.md`. Menjadi acuan adapter di `functions/_literature/*` (Fase 5).

## 1. Prinsip
- **Metadata-only**: simpan metadata + tautan; **jangan** menyalin full-text.
- Abstrak disimpan **hanya bila lisensi jelas** (mis. CC dari DOAJ); jika tidak → judul + URL saja.
- Hormati ToS/robots/rate limit; atribusi sumber wajib.
- Sumber tanpa API publik (Garuda/OneSearch) → **link-out**, bukan scraping.

## 2. Tingkat integrasi
| Tier | Sumber | Jalur | Simpan |
|---|---|---|---|
| T1 | **Crossref** | REST `api.crossref.org` (+ `mailto` polite) | metadata, DOI, lisensi |
| T1 | **DOAJ** | REST v4 + OAI-PMH (`oai_dc`) | metadata, `rights`/CC |
| T1 | **Neliti** | OAI-PMH `https://www.neliti.com/oai` (`oai_dc`, set jurnal, resumption) | metadata |
| T1 | Repositori kampus/OJS | OAI-PMH per jurnal (`/oai`) | metadata |
| T2 | **Garuda** | Tidak ada API publik → link-out | — |
| T2 | **Indonesia OneSearch** | Agregator → link-out | — |
| T3 | Sumber berbayar/berhak cipta | Perlu izin/MoU | — |

## 3. Kontrak adapter
Setiap adapter mengekspor:
- `id` — nama sumber (`crossref`, `doaj`, `neliti`, `linkout`).
- `search(query, opts) -> Promise<Result[]>` — tahan error (kembalikan `[]`, jangan melempar ke fan-out).
- `normalize(raw) -> Result` dengan field minimum:
  `title, authors[], year, journal, issn, doi, url, abstract?, language, license?, source`.
- **Dedupe** berdasarkan `doi` → jika kosong, fallback `oai_id`/`title+year`.

## 4. Perilaku fan-out (`functions/api/search.js`)
- Sumber T1 berjalan paralel dengan EPMC/PubMed/CT.gov; T2 menambah entri **link-out**.
- Filter Clinical Queries **tidak** diterapkan ke sumber literatur umum.
- Tandai setiap hasil dengan `source` + `license`; tampilkan badge "Sumber lokal" untuk T2.
- Batas waktu per adapter; kegagalan satu sumber tidak menggagalkan seluruh pencarian.

## 5. Rate limit & cache
- Queue + jeda sopan; `mailto` untuk Crossref; resumption token OAI untuk paginasi.
- Cache edge dengan namespace `search:v<N>`; naikkan versi bila daftar sumber berubah.
- Retry terbatas (mis. 2× dengan backoff).

## 6. Lisensi & kepatuhan
- Simpan `license` bila tersedia; bila tidak jelas → jangan simpan abstrak.
- Atribusi sumber + tautan asli; sediakan kanal koreksi/takedown.
- Tidak ada full-text, tidak ada redistribusi dokumen berhak cipta.

## 7. Definisi selesai (Fase 5)
- Crossref + DOAJ + Neliti aktif; Garuda/OneSearch link-out.
- Dedupe DOI terbukti; lisensi dihormati; unit test + `validate_api.js` hijau.

## 8. Status implementasi (2026-09-11)
- **Aktif** (opt-in via env `LIT_SOURCES`, default **kosong/OFF** → perilaku produksi tidak berubah): adapter `functions/_literature/crossref.js` (REST, `query.bibliographic`; `query.affiliation=Indonesia` bila `indonesia=true`; `mailto` polite) dan `doaj.js` (REST `/api/search/articles`; filter `bibjson.journal.country:"Indonesia"`), plus `linkout.js`.
- **Link-out**: OneSearch (`https://onesearch.id/Search/Results?lookfor=`, terverifikasi 200) **aktif di produksi** (`LIT_SOURCES=crossref,doaj,linkout`) dan ditampilkan lewat reservasi slot (selalu tampil walau halaman penuh). **Garuda tidak disertakan default** karena URL pencariannya belum terverifikasi — aktifkan hanya bila `GARUDA_SEARCH_URL` (prefix) sudah dipastikan.
- **Neliti OAI** (`neliti_oai.js`): **harvest metadata** (`ListRecords`, `oai_dc`, resumption token) — OAI tidak mendukung pencarian per-kata-kunci, jadi **bukan** bagian fan-out live; dipakai untuk batch harvest ke indeks lokal di masa depan.
- Cache pencarian dinaikkan ke `search:v8`; sumber baru diberi prioritas dedupe di bawah Europe PMC/PubMed/ClinicalTrials.
- Diuji: `tests/literature_unit.js` (pemetaan, URL permintaan, link-out, parsing OAI) + 2 kasus smoke (linkout OFF/ON).
