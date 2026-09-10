# Review Apoteker — Tabel Interaksi (batch 1)

Tujuan: memverifikasi 15 pasangan interaksi terkurasi yang dipakai `/api/interactions`
sebelum statusnya dinaikkan ke `reviewed: true`.

Sumber acuan: label openFDA/DailyMed, Fornas/BPOM, dan referensi interaksi resmi (mis. basis interaksi rumah sakit).
Catat tingkat keparahan yang disetujui, mekanisme, anjuran, dan sumber.

## Aturan
1. `severity` wajib salah satu: **tinggi / sedang / rendah**.
2. `mechanism` harus singkat & tepat; `advice` harus actionable (mis. "Pantau INR").
3. Setelah diverifikasi: ubah `reviewed` menjadi `true` di `functions/_interactions.json` + catat tanggal di tabel ini.
4. Bila pasangan dihapus/ditambah, perbarui tabel dan jalankan `node scripts/validate_interactions.js`.

## Checklist per pasangan
| # | Pasangan | Severity disetujui | Mekanisme OK | Anjuran OK | Sumber diverifikasi | reviewed=true | Catatan |
|---|---|---|---|---|---|---|---|
| 1 | warfarin + ibuprofen | | | | | | |
| 2 | metronidazol + warfarin | | | | | | |
| 3 | kotrimoksazol + glibenklamid | | | | | | |
| 4 | siprofloksasin + glibenklamid | | | | | | |
| 5 | kaptopril + ibuprofen | | | | | | |
| 6 | furosemid + ibuprofen | | | | | | |
| 7 | simvastatin + amlodipin | | | | | | |
| 8 | rifampisin + warfarin | | | | | | |
| 9 | rifampisin + prednison | | | | | | |
| 10 | deksametason + ibuprofen | | | | | | |
| 11 | omeprazol + diazepam | | | | | | |
| 12 | omeprazol + clopidogrel | | | | | | |
| 13 | kotrimoksazol + kaptopril | | | | | | |
| 14 | metronidazol + diazepam | | | | | | |
| 15 | glibenklamid + ibuprofen | | | | | | |

## Kriteria penerimaan
- 0 temuan kritis terbuka (severity salah atau anjuran berbahaya).
- Semua penyesuaian diterapkan ke `_interactions.json`.
- Tanda tangan reviewer + tanggal.

## Tanda tangan
- Nama: … | STRA/STRTTK: … | Tanggal: … | Versi tabel: 15 pasangan
