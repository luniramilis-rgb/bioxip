# Review Apoteker — Sampel Kartu Obat (30 obat generik)

Tujuan: memastikan setiap kartu obat akurat, aman, dan kontekstual Indonesia sebelum dipakai pengguna.
Status: menunggu review. Reviewer: (isi nama & nomor STRA/STRTTK bila ada).

> **Catatan provenance (2026-09-11):** 30 entri ini adalah **sampel kurasi manual** (commit `3073211`), **bukan** hasil ekstraksi resmi e-Fornas. Edisi `KMK HK.01.07/MENKES/1199/2025` dipakai sebagai **rujukan**, belum diverifikasi. Daftar Fornas penuh kini tersedia lewat API resmi `https://e-fornas.kemkes.go.id/api/daftar-obat` (1.254 baris, 663 nama obat) dan diimpor ke staging (`--from-fornas-api`) menunggu review.


## Sumber acuan resmi
1. **e-Fornas Kemenkes** — https://e-fornas.kemkes.go.id/guest/daftar-obat (edisi KMK HK.01.07/MENKES/1199/2025).
2. **Farmakope Indonesia** edisi terakhir (nama generik & sediaan).
3. **Label openFDA/DailyMed** (yang ditampilkan kartu) — catat `effective_time`.
4. **WHO ATC/DDD Index** — verifikasi kode ATC.
5. Guideline nasional terkait (mis. Perkeni untuk diabetes) bila ada perbedaan dosis.

## Mulai dari mana (urutan kerja yang disarankan)
1. **Identitas (cepat, wajib)**: nama generik sesuai Farmakope/INN, kode ATC, kelas terapi, rute. 30 entri diperkirakan <1 jam.
2. **Alias & risiko salah cocok (diskriminasi)**: daftar alias saat ini memuat istilah kelas yang **ambigu** (`obat tb`, `obat alergi`, `steroid`, `diuretik`, `obat gula`, `obat darah tinggi`, `obat kolesterol`, `obat demam`, `obat maag`). Tandai mana yang harus dihapus dari pencocokan persis dan diganti menjadi saran (suggestions).
3. **5 obat risiko tinggi (Batch A)** — periksa paling teliti: **parasetamol, metformin, glibenklamid, rifampisin, deksametason**.
4. **10 obat Batch B**: diazepam, prednison, furosemid, hidroklorotiazid, kaptopril, allopurinol, kotrimoksazol, siprofloksasin, seftriakson, salbutamol.
5. **Batch C (sisanya)**: sisanya + oralit, seng sulfat, ferro sulfat.
6. **Terjemahan & catatan lokal**: tandai field label yang perlu ringkasan Bahasa Indonesia dan bagian yang berbeda dari Fornas/Farmakope (tampilkan sebagai "catatan lokal").

## Checklist per obat
| # | Item | Kriterium lulus |
|---|---|---|
| 1 | Nama & INN | Sesuai Farmakope/INN; `us_name` benar bila beda (parasetamol↔acetaminophen, salbutamol↔albuterol, rifampisin↔rifampin) |
| 2 | Kode ATC | Format & level benar (oralit `A07CA` level 4) |
| 3 | Kelas & rute | Sesuai, tanpa klaim berlebih |
| 4 | Dosis umum | Rentang wajar; **catat bila label AS ≠ Fornas/Farmakope** |
| 5 | Kontraindikasi | Lengkap untuk kondisi umum Indonesia (ginjal/hati/kehamilan) |
| 6 | Peringatan/black box | Tidak terpotong makna; kalimat kritis utuh |
| 7 | Interaksi | Interaksi penting muncul (mis. rifampisin sebagai inducer CYP) |
| 8 | Populasi khusus | Pediatri/geriatri/kehamilan/menyusui tersedia atau jelas "tidak ada di sumber" |
| 9 | Konteks Indonesia | Status Fornas, ketersediaan bentuk sediaan umum |
| 10 | Bahasa & klaim | Tidak ada kalimat "resepkan/mendiagnosis"; disclaimer ada |

## Titik rawan khusus per obat (periksa ini)
| Obat | Yang harus dipastikan |
|---|---|
| Parasetamol | Dosis maksimum harian (label AS 4 g vs praktik ID); peringatan hepatotoksisitas; dosis anak berbasis BB |
| Metformin | Ambang eGFR/kontraindikasi gangguan ginjal; asidosis laktat; penundaan sebelum kontras |
| Glibenklamid | Hipoglikemia (lansia/ginjal); nama glyburide vs glibenklamid |
| Rifampisin | Induksi CYP (kontrasepsi, warfarin, ARV); hepatotoksisitas; cairan tubuh berwarna oranye |
| Deksametason / Prednison | Penurunan dosis bertahap; risiko infeksi/hiperglikemia; perbedaan label antar bentuk |
| Diazepam | Ketergantungan, depresi napas, kriteria Beers lansia |
| Furosemid / Hidroklorotiazid | Elektrolit (K/Na), fungsi ginjal, gout, alergi sulfa |
| Kaptopril | Batuk kering, hiperkalemia, kehamilan (kontraindikasi) |
| Allopurinol | **HLA-B\*58:01 relevan populasi Asia/Indonesia**; mulai dosis rendah saat serangan akut |
| Kotrimoksazol | Hiperkalemia, alergi sulfa, penyesuaian ginjal |
| Siprofloksasin / Seftriakson | Tendinopati & pediatri (sipro); inkompatibilitas kalsium (seftriakson); AMR |
| Salbutamol | Nama albuterol; efek kardiak; teknik inhalasi |
| Oralit | Komposisi sesuai WHO/Fornas (mis. Na 75 mmol/L) — bila label openFDA tidak ada, pakai Fornas/WHO |
| Seng sulfat | Dosis berbasis umur (mis. 10–20 mg/hari); hanya untuk diare anak |
| Ferro sulfat | **Besi elemental vs garam** (label menyebut garam, tetapi kebutuhan dihitung elemental) |

## Cara mencatat hasil
Isi verdict per item: `OK` / `KOREKSI` / `PERLU-FIX` + catatan singkat + tautan sumber. Bila label AS berbeda dengan Fornas, tandai `CATATAN-LOKAL` agar ditampilkan di kartu (bukan diubah diam-diam).

## Kriteria penerimaan batch
- ≥95% field akurat; **0 temuan kritis terbuka** (dosis/ kontraindikasi/ black box).
- Semua temuan `KOREKSI` sudah diterapkan ke `functions/_drugs.json`/logika.
- Alias ambigu sudah diklasifikasi (hapus dari exact-match atau alihkan ke saran).
- Tanda tangan + tanggal reviewer tercatat.

## Tabel pelacakan
| # | Slug | Obat | Identitas | Dosis | Kontra | Peringatan | Interaksi | Populasi | Verdict | Catatan |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | parasetamol | Parasetamol | | | | | | | | |
| 2 | ibuprofen | Ibuprofen | | | | | | | | |
| 3 | amoksisilin | Amoksisilin | | | | | | | | |
| 4 | ampisilin | Ampisilin | | | | | | | | |
| 5 | kotrimoksazol | Kotrimoksazol | | | | | | | | |
| 6 | metronidazol | Metronidazol | | | | | | | | |
| 7 | siprofloksasin | Siprofloksasin | | | | | | | | |
| 8 | seftriakson | Seftriakson | | | | | | | | |
| 9 | rifampisin | Rifampisin | | | | | | | | |
| 10 | isoniazid | Isoniazid | | | | | | | | |
| 11 | pirazinamid | Pirazinamid | | | | | | | | |
| 12 | etambutol | Etambutol | | | | | | | | |
| 13 | metformin | Metformin | | | | | | | | |
| 14 | glibenklamid | Glibenklamid | | | | | | | | |
| 15 | amlodipin | Amlodipin | | | | | | | | |
| 16 | kaptopril | Kaptopril | | | | | | | | |
| 17 | hidroklorotiazid | Hidroklorotiazid | | | | | | | | |
| 18 | furosemid | Furosemid | | | | | | | | |
| 19 | simvastatin | Simvastatin | | | | | | | | |
| 20 | omeprazol | Omeprazol | | | | | | | | |
| 21 | setirizin | Setirizin | | | | | | | | |
| 22 | klorfeniramin | Klorfeniramin | | | | | | | | |
| 23 | salbutamol | Salbutamol | | | | | | | | |
| 24 | deksametason | Deksametason | | | | | | | | |
| 25 | prednison | Prednison | | | | | | | | |
| 26 | diazepam | Diazepam | | | | | | | | |
| 27 | alopurinol | Alopurinol | | | | | | | | |
| 28 | oralit | Oralit | | | | | | | | |
| 29 | seng-sulfat | Seng sulfat | | | | | | | | |
| 30 | ferro-sulfat | Ferro sulfat | | | | | | | | |

## Tanda tangan reviewer
- Nama: …  | STRA/STRTTK: … | Tanggal: … | Versi katalog: 30 obat (KMK 1199/2025)
