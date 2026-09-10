# bioXip — Prinsip Produk (mengikat semua sprint)

Dokumen ini adalah **mindset & non-negotiable**. Setiap keputusan desain, sprint, dan fitur harus lulus uji di sini.
Terkait: `docs/blueprint.md`, `docs/strategy.md`, `docs/onboarding.md`, `docs/plan.md`, `docs/credits.md`.

## 1. Pasar utama: Indonesia (bukan global-dulu)
- Pengguna adalah **peneliti, dokter, apoteker, mahasiswa & nakes Indonesia** — bukan peneliti global.
- Bahasa Indonesia sebagai **bahasa default** jawaban & antarmuka; istilah lokal dikenali (koas, IFRS, puskesmas, TTD, Fornas, BPJS).
- Konteks lokal = pembeda: Fornas/BPOM, guideline nasional (Perkeni, PDPI, IDAI, PB IDI), penelitian Indonesia (Garuda/OneSearch/Neliti), topik prioritas nasional (TB, DBD, stunting, malaria, kesehatan ibu, diabetes).
- Harga, kanal pembayaran, dan komunikasi disesuaikan daya beli & kebiasaan Indonesia (QRIS/VA/e-wallet, bukan kartu kredit).
- Prioritas fitur dari **log pengguna Indonesia**, bukan asumsi pasar global.

## 2. Mobile-first (95%+ pengguna)
- **Desain dimulai dari layar 360px**; desktop hanya progressive enhancement.
- **PWA installable**, offline shell, mode hemat data, dark mode, font ≥16px, target sentuh ≥44px.
- Anggaran performa: **LCP <2,5 dtk di 4G**, JS kecil, tanpa framework berat.
- Alur 1 tangan: navigasi bawah, aksi utama di jempol, bottom sheet (bukan modal penuh).
- Uji wajib di perangkat nyata (Android kelas menengah + iPhone) sebelum rilis fitur.

## 3. Sign in: Google OAuth + magic link/OTP email
- **Google OAuth** = kanal utama (paling dominan di Indonesia, berfungsi juga di iPhone).
- **Magic link email + OTP 6 digit** = kanal kedua. OTP penting karena sebagian browser dalam aplikasi/klien email gagal membuka tautan magic link — kode OTP masih bisa diketik manual.
- **Apple Sign In tidak dipakai** (keputusan 2026-09-10): menghindari biaya Apple Developer Program, kompleksitas Service ID/key, dan masalah "Hide My Email" yang merusak komunikasi email.
- Sesi harus tahan lama (refresh token) — pengguna mobile jarang login ulang.
- **Risiko wajib ditangani:**
  1. **In-app browser** (Instagram/Facebook/TikTok/Line) memblokir OAuth Google → deteksi UA & tampilkan layar "Buka di Chrome/Safari" + tombol salin tautan.
  2. **Keterkiriman email** — magic link/OTP hanya sebaik SMTP. Wajib: domain pengirim sendiri + SPF/DKIM (mis. `no-reply@bioxip.id`), uji ke Gmail/Yahoo, dan fallback OTP bila tautan gagal.
  3. **Email sama via Google & magic link** → aktifkan *identity linking* di Supabase agar tidak terbentuk akun ganda.
  4. **Rate limit** pengiriman magic link/OTP per email & per IP + Turnstile pada form masuk.

## 4. Berbagi (share): fondasi sekarang, integrasi kanal NANTI
Keputusan 2026-09-10: **integrasi WhatsApp/Instagram/Threads/X ditunda** sampai sistem dasar stabil. Yang tetap dikerjakan sekarang hanya **fondasi murah** yang sulit ditambal belakangan:

**Wajib sekarang (murah, sekaligus kebutuhan SEO):**
1. **Halaman publik** yang bisa dibagikan tanpa login: `/topik/*`, drug card ringkas, `/sumber`, `/legal`, `/harga`, + preview 3 hasil.
2. **OG/meta tags + gambar 1200×630** agar preview tautan rapi bila pengguna menyalin tautan.
3. **Tombol "Salin tautan"** pada hasil & drug card.

**Ditunda ke backlog (setelah sistem dasar stabil):**
- Web Share API (`navigator.share`), tombol eksplisit WhatsApp/IG/X.
- Kartu gambar share (canvas/SVG) untuk IG/Story.
- `share_target` PWA (membagikan tautan dari aplikasi lain ke bioXip).
- Snapshot jawaban publik (opt-in) — menunggu AI stabil & review klinis.
- Pelacakan rujukan `?ref=&utm_source=` + K-factor.

## 5. In-app browser adalah kasus utama (jangan diabaikan)
Mayoritas trafik sosial di Indonesia datang dari browser dalam aplikasi.
- Deteksi UA: `Instagram`, `FBAN/FBAV`, `TikTok`, `Line`, `Twitter`, `WebView`.
- Bila terdeteksi dan pengguna akan login: **layar perantara** "Buka di Chrome/Safari" (deep link + tombol salin tautan).
- Jangan biarkan pengguna menabrak error OAuth tanpa penjelasan.

## 6. Halaman publik (mengapa wajib meski gate login aktif)
Karena sign in diwajibkan sejak versi gratis, tautan apa pun tidak boleh langsung menabrak login:
1. **Halaman topik publik** (TB, DBD, stunting, …) — terindeks & aman dibagikan.
2. **Drug card publik ringkas** (identitas, ATC, kelas, rute, Fornas, tautan sumber) + CTA masuk untuk detail.
3. **Preview 3 hasil** untuk pengunjung belum login + CTA "Masuk untuk melihat semua".
Semua halaman publik membawa atribusi sumber asli dan tidak memuat data pasien.

## 7. Prinsip yang tidak boleh dilanggar
1. **Mobile-first dulu**, desktop menyusul.
2. **Bahasa Indonesia default**; Inggris sebagai opsi.
3. **Google OAuth + magic link/OTP** untuk masuk (tanpa Apple).
4. **Halaman publik + OG tags + salin tautan** tersedia sejak Sprint 1 (fondasi share); integrasi kanal share menyusul.
5. **Tidak ada PII di tautan share, log analitik, atau laporan institusi** (agregat n≥10).
6. **Tanpa data pasien** — input semacam itu ditolak.
7. **Tanpa kejutan biaya** — estimasi Rp tampil sebelum eksekusi AI.
8. **Pembayaran lokal** (QRIS/VA/e-wallet) — bukan kartu kredit sebagai kanal utama.
9. Uji di **in-app browser** & perangkat kelas menengah sebelum rilis.
10. Semua keputusan baru **dicatat** di `docs/blueprint.md` (decision log).

## 8. Checklist rilis fitur (wajib lulus)
- [ ] Tampilan 360px tanpa scroll horizontal.
- [ ] Target sentuh ≥44px; navigasi jempol.
- [ ] LCP <2,5 dtk di 4G; payload JS kecil.
- [ ] Berfungsi di in-app browser (atau ada layar "buka di browser").
- [ ] Halaman tujuan (bila ada tautan) bersifat **publik** + OG tags benar.
- [ ] Tombol **Salin tautan** tersedia.
- [ ] Teks & istilah Indonesia; bukan terjemahan kaku.
- [ ] Tidak ada PII di tautan/log.
- [ ] Uji di Android kelas menengah + iPhone.
