# Review Apoteker — Monitoring & Penyesuaian (batch 1, 30 obat)

Tujuan: memverifikasi isi `functions/_monitoring.json` (monitoring, penyesuaian ginjal/hati, lansia, deprescribing)
sebelum status `reviewed` dinaikkan ke `true`.

Sumber acuan: label openFDA/DailyMed, Fornas/BPOM, Farmakope Indonesia, panduan Beers/STOPP bila relevan.

## Aturan
1. Setiap obat wajib punya: `monitoring` (≥1), `renal`, `hepatic`, `geriatric`.
2. `deprescribing` hanya diisi bila relevan (mis. benzodiazepin, PPI jangka panjang, sulfonilurea pada lansia).
3. Setelah diverifikasi: ubah `reviewed` di `functions/_monitoring.json` menjadi `true` + catat tanggal di tabel ini.
4. Jalankan `node scripts/validate_monitoring.js` setiap kali mengubah berkas.

## Checklist (30 obat)
| # | Obat | Monitoring OK | Ginjal OK | Hati OK | Lansia OK | Deprescribing benar | Catatan |
|---|---|---|---|---|---|---|---|
| 1 | Parasetamol | | | | | n/a | |
| 2 | Ibuprofen | | | | | | |
| 3 | Amoksisilin | | | | | n/a | |
| 4 | Ampisilin | | | | | n/a | |
| 5 | Kotrimoksazol | | | | | n/a | |
| 6 | Metronidazol | | | | | n/a | |
| 7 | Siprofloksasin | | | | | n/a | |
| 8 | Seftriakson | | | | | n/a | |
| 9 | Rifampisin | | | | | | |
| 10 | Isoniazid | | | | | n/a | |
| 11 | Pirazinamid | | | | | n/a | |
| 12 | Etambutol | | | | | n/a | |
| 13 | Metformin | | | | | n/a | |
| 14 | Glibenklamid | | | | | | |
| 15 | Amlodipin | | | | | n/a | |
| 16 | Kaptopril | | | | | n/a | |
| 17 | Hidroklorotiazid | | | | | n/a | |
| 18 | Furosemid | | | | | n/a | |
| 19 | Simvastatin | | | | | n/a | |
| 20 | Omeprazol | | | | | | |
| 21 | Setirizin | | | | | n/a | |
| 22 | Klorfeniramin | | | | | | |
| 23 | Salbutamol | | | | | n/a | |
| 24 | Deksametason | | | | | | |
| 25 | Prednison | | | | | | |
| 26 | Diazepam | | | | | | |
| 27 | Alopurinol | | | | | n/a | |
| 28 | Oralit | | | | | n/a | |
| 29 | Seng sulfat | | | | | n/a | |
| 30 | Ferro sulfat | | | | | n/a | |

## Kriteria penerimaan
- Semua penyesuaian diterapkan ke `_monitoring.json`; validator lulus.
- 0 temuan kritis terbuka (penyesuaian ginjal/hati yang berbahaya bila salah).
- Tanda tangan reviewer + tanggal.

## Tanda tangan
- Nama: … | STRA/STRTTK: … | Tanggal: … | Versi: 30 entri (batch 1)
