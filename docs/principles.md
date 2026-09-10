# bioXip — Prinsip Produk (mengikat semua sprint)

Dokumen ini adalah **mindset & non-negotiable**. Setiap keputusan desain, sprint, dan fitur harus lulus uji di sini.
Terkait: `docs/blueprint.md`, `docs/strategy.md`, `docs/onboarding.md`, `docs/plan.md`, `docs/credits.md`.

## 1. Pasar utama: Indonesia (bukan global-dulu)
- Bahwa pengguna adalah **peneliti, dokter, apoteker, mahasiswa & nakes Indonesia** — bukan peneliti global.
- Bahasa Indonesia sebagai **bahasa default** jawaban & antarmuka; istilah lokal dikenali (koas, IFRS, puskesmas, TTD, Fornas, BPJS).
- Konteks lokal = pembeda: Fornas/BPOM, guideline nasional (Perkeni, PDPI, IDAI, PB IDI), penelitian Indonesia (Garuda/OneSearch/Neliti), topik prioritas nasional (TB, DBD, stunting, malaria, kesehatan ibu, diabetes).
- Harga, kanal pembayaran, dan komunikasi disesuaikan daya beli & kebiasaan Indonesia (QRIS/VA/e-wallet, bukan kartu kredit).
- Riset pasar & prioritas fitur dari **log pengguna Indonesia**, bukan asumsi pasar global.

## 2. Mobile-first (95%+ pengguna)
- **Desain dimulai dari layar 360px**; desktop hanya progressive enhancement.
- **PWA installable**, offline shell, mode hemat data, dark mode, font ≥16px, target sentuh ≥44px.
- Anggaran performa: **LCP <2,5 dtk di 4G**, JS kecil, tanpa framework berat.
- Alur 1 tangan: navigasi bawah, aksi utama di jempol, bottom sheet (bukan modal penuh).
- Uji wajib di perangkat nyata (Android kelas menengah + iPhone) sebelum rilis fitur.

## 3. Sign in: Google + Apple (dan magic link sebagai cadangan)
- **Google OAuth** = kanal utama (paling dominan di Indonesia).
- **Apple Sign In** = wajib disediakan (permintaan produk; juga syarat App Store bila kelak ada app iOS).
- **Magic link email** = cadangan bila OAuth gagal/diblokir (mis. di browser dalam aplikasi).
- ⚠️ **Risiko yang wajib ditangani**:
  1. **Apple "Hide My Email"** memberi alamat relay → email marketing bisa gagal. Solusi: jangan bergantung pada email Apple untuk komunikasi; minta email kontak terpisah (opsional) atau gunakan notifikasi in-app.
  2. **Google memblokir OAuth di in-app browser** (Instagram/Facebook/TikTok/Line). Harus dideteksi → tampilkan layar "Buka di browser" (lihat §5).
  3. Biaya & kompleksitas Apple: butuh **Apple Developer Program** ($99/thn), Service ID, private key, verifikasi domain. Masukkan sebagai pekerjaan Sprint 1.5 (setelah Google stabil), jangan menahan rilis Google.
- Sesi harus tahan lama (refresh token) — pengguna mobile jarang login ulang.

## 4. Share-first: distribusi adalah fitur, bukan tambahan
Kanal prioritas: **WhatsApp** (utama) → **Instagram (DM/Story)** → **Threads/X** → media sosial lain.
- Gunakan **Web Share API** (`navigator.share`) di mobile: satu ketukan membuka *share sheet* ke semua aplikasi; tombol eksplisit (WhatsApp/IG/X) sebagai fallback desktop.
- **Tombol bagikan di mana-mana**: hasil pencarian, jawaban AI, drug card, halaman topik.
- **Teks siap-kirim** yang sudah disusun (judul + 1 poin utama + tautan), bukan tautan mentah.
- **OG/meta tags benar** agar preview WhatsApp rapi (judul, deskripsi, gambar 1200×630).
- **Gambar share** (untuk IG/Story yang tidak punya tautan yang bisa diklik): kartu ringkas (judul + 1 temuan + sitasi + logo) — dirender **di klien** (canvas/SVG) agar tidak membebani server.
- **Instagram tidak mengizinkan tautan di caption** → sediakan "salin tautan" + arahan "tautan di bio" / story sticker.
- **`share_target` di manifest PWA**: pengguna bisa **membagikan tautan dari aplikasi lain ke bioXip** → langsung masuk kotak pencarian (loop masuk).
- **Tanpa PII di tautan share**; peringatkan pengguna bila konten yang dibagikan sensitif (query medis bisa bersifat pribadi).

## 5. In-app browser adalah kasus utama (jangan diabaikan)
Mayoritas trafik sosial di Indonesia datang dari browser dalam aplikasi.
- Deteksi UA: `Instagram`, `FBAN/FBAV`, `TikTok`, `Line`, `Twitter`, `WebView`.
- Bila terdeteksi dan pengguna akan login/berbagi: **tampilkan layar perantara** "Buka di Chrome/Safari" (deep link + tombol salin tautan).
- Jangan biarkan pengguna menabrak error OAuth tanpa penjelasan.

## 6. Halaman share wajib **publik** (menghindari tembok login)
Karena sign in diwajibkan sejak versi gratis, tautan yang dibagikan tidak boleh langsung menabrak login:
1. **Halaman topik publik** (TB, DBD, stunting, …) — terindeks & aman dibagikan.
2. **Drug card publik ringkas** (identitas, ATC, kelas, rute, Fornas, tautan sumber) + CTA masuk untuk detail.
3. **Snapshot jawaban publik read-only** (opsional, hanya bila pengguna memilih "bagikan publik"): menampilkan jawaban + sitasi + tanda "dibuat dengan bioXip", tanpa data akun. Ini mesin viral sekaligus menghormati gate.
4. **Preview 3 hasil** untuk pengunjung belum login + CTA "Masuk untuk melihat semua".
Aturan: apa pun yang dibagikan tetap membawa atribusi sumber asli dan tidak memuat data pasien.

## 7. Loop pertumbuhan yang diukur
- Setiap tautan share membawa **`?ref=<user_id_hash>&utm_source=`**.
- Event: `share_clicked` (kanal), `share_page_viewed`, `ref_signup`, `ref_first_search`, `ref_first_topup`.
- Metrik: **K-factor** (undangan → pendaftaran), share per pengguna aktif, konversi per kanal.
- Target awal: ≥20% pengguna aktif membagikan sesuatu; K-factor ≥0,15.

## 8. Prinsip yang tidak boleh dilanggar
1. **Mobile-first dulu**, desktop menyusul.
2. **Bahasa Indonesia default**; Inggris sebagai opsi.
3. **Google + Apple + magic link** tersedia untuk masuk.
4. **Setiap fitur punya tombol bagikan** dan halaman tujuannya publik/snapshot.
5. **Tidak ada PII di tautan share, log analitik, atau laporan institusi** (agregat n≥10).
6. **Tanpa data pasien** — input semacam itu ditolak.
7. **Tanpa kejutan biaya** — estimasi Rp tampil sebelum eksekusi AI.
8. **Pembayaran lokal** (QRIS/VA/e-wallet) — bukan kartu kredit sebagai kanal utama.
9. Uji di **in-app browser** & perangkat kelas menengah sebelum rilis.
10. Semua keputusan baru harus **dicatat** di `docs/blueprint.md` (decision log).

## 9. Checklist rilis fitur (wajib lulus)
- [ ] Tampilan 360px tanpa scroll horizontal.
- [ ] Target sentuh ≥44px; navigasi jempol.
- [ ] LCP <2,5 dtk di 4G; payload JS kecil.
- [ ] Berfungsi di in-app browser (atau ada layar "buka di browser").
- [ ] Tombol bagikan (Web Share API + fallback) dan halaman tujuan publik.
- [ ] OG tags & gambar preview benar.
- [ ] Teks & istilah Indonesia; bukan terjemahan kaku.
- [ ] Tidak ada PII di tautan/log.
- [ ] Uji di Android kelas menengah + iPhone.
