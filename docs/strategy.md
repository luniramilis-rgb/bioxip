# bioXip — Strategi Implementasi USP (Klinis + Farmasi) & Validasi

Dokumen hidup. Setiap perubahan strategi dicatat di sini dan di `docs/blueprint.md` (decision log).

## 1. USP yang dibangun
> "Bukti terbaik, bahasa Indonesia, tersitasi — dari keputusan klinis sampai keamanan obat, untuk dokter dan apoteker."

Pilar: (1) bahasa & konteks Indonesia, (2) jembatan diagnosis→obat→verifikasi, (3) grounded & tersitasi, (4) mobile-first cepat & hemat data, (5) intelijen untuk industri (B2B).

Dua suite, satu mesin:
- **Suite Klinis** (mahasiswa kedokteran, koas, dokter umum/spesialis): PICO → opsi terapi + bukti.
- **Suite Farmasi** (apoteker, IFRS, apotek jaringan, pendidik, mahasiswa farmasi): drug card (dosis label, kontraindikasi, interaksi, monitoring, deprescribing).
- **Industri farmasi** (B2B): pipeline/intelijen trial & molekul.

## 2. Prinsip & guardrail (wajib)
1. Tanpa input data pasien (cegah peresepan personal & pelanggaran UU PDP).
2. Tanpa klaim diagnosis/peresepan; wording: "opsi terapi menurut bukti", "dosis umum (referensi label)".
3. Setiap klaim tersitasi; jika sumber tidak memuat → tampilkan "tidak ditemukan di sumber", jangan menebak.
4. Kutip label/guideline apa adanya; jangan memparafrase makna klinis.
5. Free: pencarian & ringkasan dasar. Premium: drug card lengkap, interaction checker, monitoring, API.

## 3. Peta fase, deliverable, kriteria keluar, validasi

### S0 — Fondasi (SELESAI)
- Deliverable: live search (Europe PMC + ClinicalTrials.gov), PICO answer ekstraktif, PWA mobile-first.
- Exit: search & PICO live, skor sitasi terbentuk. ✅
- Validasi: harness UI (ALL PASS), API contract, deploy hijau.

### S1 — Drug Card (label + mekanisme)
- Deliverable:
  - `GET /api/drug?q=<nama obat>` → field: indikasi, dosis umum dewasa/anak (rentang), kontraindikasi, peringatan/black box, interaksi, penyesuaian ginjal/hati, monitoring, kehamilan/laktasi.
  - Sumber: DailyMed/openFDA (label), PubChem (identitas/CID), ChEMBL (mekanisme/target), Open Targets.
  - Tab **Obat** di UI + kartu terapi pada halaman `#/answer`.
  - `functions/_drugs.js` (normalisasi nama obat + peta istilah ID).
- Deliverable tambahan (P1): katalog Fornas 30 obat (`functions/_drugs.json`) + validator + panduan review apoteker (`docs/review-drugs.md`).
- Exit: 20 obat umum (ID) menampilkan kartu lengkap dengan tautan sumber di setiap field.
- Validasi:
  - Otomatis: setiap field wajib punya `source_url`; field kosong → "tidak ditemukan". `scripts/validate_drugs.js` + `scripts/validate_api.js` (ALL PASS).
  - Manual: 1 apoteker (reviewer) memverifikasi 30 kartu vs label/Fornas (checklist di `docs/review-drugs.md`; catat tanggal & reviewer).
  - Ambang: ≥95% field akurat; 0 klaim tanpa sumber; 0 temuan kritis terbuka.

### S2 — Interaction & Monitoring (fitur pembeda farmasi)
- Deliverable:
  - Interaction checker: pasangan obat → tingkat keparahan + mekanisme + sumber.
  - Monitoring & penyesuaian ginjal/hati (rentang, dari label) + checklist deprescribing (Beers/STOPP/START).
  - Export ringkas (PDF/gambar) + salin sitasi.
- Catatan teknis (2026-09-10): **RxNav Interaction API (NLM) telah dihentikan (404)** → diganti dua lapis: (1) **tabel interaksi terkurasi** (`functions/_interactions.json`, 15 pasangan, `reviewed:false` sampai diverifikasi apoteker — lihat `docs/review-interactions.md`); (2) **kutipan bagian interaksi label** openFDA/DailyMed sebagai bukti grounded (`mentions`). RxNorm tetap dipakai untuk normalisasi nama.
- Exit: 50 pasangan interaksi umum terverifikasi; deprescribing untuk 10 kondisi geriatri.
- Validasi: apoteker reviewer (≥95% akurasi tingkat keparahan), uji regresi otomatis (`validate_interactions.js` + `validate_api.js`) terhadap pasangan acuan.

### S3 — Jembatan Klinis ↔ Farmasi (moat)
- Deliverable: "Bagikan kartu terapi ke apoteker" + status "diverifikasi apoteker"; koleksi kolaboratif (tanpa data pasien).
- Exit: alur 2 arah berjalan end-to-end pada 1 pilot RS/klinik.
- Validasi: uji usability 5 dokter + 5 apoteker; metrik: waktu verifikasi turun, % kartu dibagikan.

### S4 — Lapisan lokal (konteks Indonesia)
- Deliverable: Fornas/BPOM (ketersediaan & status), guideline nasional (Perkeni, PDPI, IDAI, PB IDI), tautan penelitian Indonesia, "versi lokal" (Garuda/OneSearch/Neliti).
- Exit: 10 topik prioritas menampilkan lapisan lokal.
- Validasi: tinjauan oleh 1 dokter + 1 apoteker; tautan lokal harus valid (uji otomatis HTTP status).

### S5 — API & Intelijen (monetisasi B2B)
- Deliverable: API retrieval tersitasi (key + kuota), alert pipeline/trial, laporan intelijen bulanan.
- Exit: 1 kontrak pilot (institusi/industri).
- Validasi: SLA latensi & uptime, audit sitasi, kontrak penggunaan data.

## 4. Perubahan teknis (peta file)
| Area | Perubahan |
|---|---|
| Functions | `api/search.js` (ada), `api/answer.js` (ada), **baru**: `api/drug.js`, `_drugs.js`, `api/interactions.js` |
| Web | **baru**: `js/drug.js`; update `js/answer.js` (tab Obat), `css/app.css` (drug card), `index.html` (script) |
| Sumber | DailyMed/openFDA, PubChem, ChEMBL, Open Targets (live, cache) |
| Cache | Cloudflare KV (kuota & cache label) saat trafik naik |
| Analitik | log query anonim, akurasi field, error rate |

## 5. Validasi berlapis (wajib di setiap fase)
| Lapisan | Cara | Ambang lulus |
|---|---|---|
| Unit & sintaks | `node --check`, harness UI (`ui_harness.js`), `pytest` harvester | 100% lulus |
| Kontrak API | Uji skema respons tiap endpoint | Field wajib ada; 0 error 5xx |
| Integritas sitasi | Otomatis: setiap `[n]`/`source_url` valid dalam payload | ≥98% klaim tersupport |
| Golden set | 30 pertanyaan/obat dengan jawaban acuan | ≥95% akurasi field |
| Tinjauan klinis | 1 dokter + 1 apoteker (checklist + tanggal) | 0 temuan kritis terbuka |
| Performa mobile | Lighthouse mobile + uji 4G | LCP <2,5 dtk; JS <100 KB |
| Pilot | 1 institusi (RS/kampus/apotek) | ≥80% responden menyatakan menghemat waktu |

## 6. Metrik produk
- Waktu menjawab pertanyaan klinis/obat (target <60 dtk).
- % pertanyaan terjawab tanpa eskalasi.
- % kartu terapi dibagikan/ diverifikasi (indikator moat Rantai).
- Retensi mingguan apoteker & dokter; konversi free→premium.

## 7. Risiko & mitigasi
| Risiko | Mitigasi |
|---|---|
| Regulator menganggap decision support | wording & output "informasi bukti"; tanpa input pasien; tanpa klaim diagnosis |
| Halusinasi | ekstraktif dulu, LLM hanya dengan validasi sitasi; field wajib ber-sumber |
| Label berubah | cache TTL + tanggal akses ditampilkan |
| Ketergantungan API upstream | timeout + degradasi + cache; dokumentasikan sumber alternatif |
| Privasi | tidak ada data pasien; log anonim |

## 8. Definition of Done (per fitur)
1. Kode + uji lulus (sintaks, kontrak, harness).
2. Setiap field/klaim punya tautan sumber.
3. Tinjauan apoteker/dokter tercatat (nama/tanggal) untuk konten klinis.
4. Deploy produksi & diverifikasi endpoint.
5. Entri decision log di `docs/blueprint.md`.

## 9. Urutan eksekusi berikutnya
**S1 (Drug Card)** → S2 (Interaction) → S3 (Jembatan) → S4 (Lokal) → S5 (API).

Alasan: S1 memberi nilai instan ke apoteker & memperkuat halaman PICO; S2 menciptakan pembeda yang sulit ditiru; S3 menciptakan moat rantai; S4 memperkuat legalitas konteks lokal; S5 memonetisasi.
