# bioXip — Onboarding & Segmentasi Pengguna

Acuan **Sprint 1** (auth + gating + onboarding). Dokumen ini **rancangan**, belum implementasi kode.
Terkait: `docs/credits.md` (§14 auth, §15 data) dan `docs/plan.md` (Sprint 1).

## 1. Tujuan
1. **Segmentasi** — menentukan tawaran, fitur default, dan kanal komunikasi.
2. **Personalisasi** — mode awal yang relevan dengan peran (klinis vs farmasi vs akademik).
3. **Penjualan institusi (B2B)** — data kampus/RS/apotek sebagai dasar lisensi.
4. **Data riset produk** — distribusi pengguna & kebutuhan nyata.
5. **Time-to-value cepat** — pengguna baru langsung mencoba AI lewat template contoh, bukan halaman kosong.

## 2. Prinsip desain (konteks Indonesia)
| Prinsip | Alasan lokal |
|---|---|
| **≤3 langkah, tiap langkah bisa "Lewati"** | Banyak pengguna mobile dengan kuota terbatas; onboarding panjang = drop-off |
| **Tap = lanjut, tanpa tombol Submit** | Mengurangi friksi; form panjang terasa berat di HP |
| **Istilah Indonesia + bilingual** | "Koas", "IFRS", "Puskesmas", "TTD" tidak punya padanan Inggris yang dipahami |
| **Wajib menyertakan "Apoteker"** | Segmen inti bioXip; Consensus tidak punya |
| **Jangan tampilkan harga berbeda di onboarding** | Menghindari kesan diskriminatif; kumpulkan data dulu |
| **Honor-based segmentasi** | Verifikasi (email institusi/STR/NIM) menyusul, jangan jadi gerbang |
| **Consent singkat (UU PDP)** | Wajib transparan; jangan menyembunyikan pemakaian data |
| **Google dominan; tanpa Apple** | Google OAuth + magic link/OTP; Apple dibatalkan (biaya & relay email) |

## 3. Alur onboarding (3 kartu + 1 baris consent)
```
[Kartu 1: Peran] → [Kartu 2: Institusi (opsional)] → [Kartu 3: Tujuan + consent] → [Contoh AI] → Selesai
   ↑ Lewati                ↑ Lewati                          ↑ Lewati
```

### Kartu 1 — "Mana yang paling menggambarkan Anda?"
Satu pilihan **kategori**, lalu (bila relevan) satu pilihan **spesifik**. Maksimal satu tingkat percabangan.

**Kategori & opsi spesifik:**
| Kategori | Opsi spesifik |
|---|---|
| **Akademik** | Mahasiswa S1 · Mahasiswa profesi / koas · Mahasiswa S2/S3 · Dosen / peneliti |
| **Klinis** | Dokter umum · Dokter spesialis · Perawat · Bidan · Tenaga kesehatan lain |
| **Farmasi** | Apoteker · Apoteker klinis / IFRS · Mahasiswa farmasi · Tenaga teknis kefarmasian |
| **Industri & lembaga** | Industri farmasi · CRO / riset pasar · Pemerintah / regulator · Organisasi profesi |
| **Lainnya** | (isi bebas, teks singkat) |

Aturan:
- Menyimpan `role_category` + `role_detail` (dua kolom) agar analitik tetap bisa digulung per kategori.
- "Lainnya" wajib memicu penyimpanan teks bebas **terpisah** (maks 60 karakter) dan masuk antrean kurasi.
- Tombol **Lewati** menyimpan `role_category = 'unknown'` (bukan null) supaya analitik tidak kehilangan pengguna.

### Kartu 2 — "Dari mana Anda?" (opsional)
| Jenis institusi | Contoh |
|---|---|
| Kampus / universitas | (autocomplete nama) |
| Rumah sakit | (autocomplete) |
| Puskesmas / klinik | (autocomplete) |
| Apotek / jaringan apotek | (autocomplete) |
| Perusahaan / lembaga | (autocomplete) |
| Mandiri / independen | — |

Aturan:
- Autocomplete dari master data sederhana (nama institusi + kota), boleh lewati.
- Simpan `institution_type` + `institution_name` (teks). Jangan paksa domain email.
- Nilai B2B: institusi dengan ≥5 pengguna aktif → kandidat penawaran lisensi.

### Kartu 3 — "Apa kebutuhan utama Anda?" + consent
Pilih satu (opsional):
- Riset & tinjauan literatur
- Praktik klinis / keputusan terapi
- Tugas studi / skripsi / tesis
- Informasi obat & keamanan (farmasi)
- Intelijen produk / pipeline
- Belajar umum

Lalu baris consent (checkbox, **wajib dicentang hanya untuk menyimpan profil**; fitur tetap bisa dipakai tanpa consent namun profil tidak dipakai untuk personalisasi):
> "Saya setuju data profil ini dipakai untuk personalisasi pengalaman dan komunikasi produk. Saya dapat meminta hapus data kapan pun. [Kebijakan Privasi]"

Aturan: `consent_at` disimpan; bila tidak dicentang, tetap boleh lanjut dengan `consent = false` (personalisasi dimatikan, data tetap anonim untuk agregat).

## 4. Langkah akhir — Template pertanyaan AI (pola Consensus)Setelah onboarding, tampilkan **3 kartu contoh** sesuai peran, masing-masing berisi **pertanyaan siap-pakai**. Mengetuk salah satu langsung menjalankan jawaban AI dan **memperlihatkan contoh hasil**.

Kartu contoh (dipilih otomatis berdasarkan `role_category` + `purpose`):

| Peran | Contoh 1 (terapi) | Contoh 2 (farmasi/keamanan) | Contoh 3 (bukti Indonesia) |
|---|---|---|---|
| Klinis | "Pada pasien DM tipe 2 dengan obesitas, bagaimana perbandingan efektivitas metformin vs GLP-1 RA terhadap berat badan dan HbA1c?" | "Apa kontraindikasi dan pemantauan penting kortikosteroid jangka panjang?" | "Bagaimana profil resistensi dan pilihan terapi TB di Indonesia menurut bukti terbaru?" |
| Farmasi | "Bagaimana dosis dan penyesuaian metformin pada gangguan ginjal?" | "Interaksi bermakna antara warfarin dan antibiotik apa saja?" | "Apa bukti terkini stabilitas dan penyimpanan vaksin pada rantai dingin terbatas?" |
| Akademik | "Apa bukti terbaru efektivitas intervensi pencegahan stunting di Asia Tenggara?" | "Bagaimana metodologi meta-analisis untuk menilai interaksi obat?" | "Apa kesenjangan riset kesehatan ibu di Indonesia 5 tahun terakhir?" |
| Industri | "Bagaimana lanskap uji klinis fase 3 untuk target SGLT2 di Asia Tenggara?" | "Perbandingan keamanan kardiovaskular kelas GLP-1 RA berdasarkan bukti terbaru." | "Apa status regulasi dan ketersediaan obat baru tertentu di Indonesia?" |

Aturan tampilan:
1. **3 kartu saja** (jangan lebih) — menghindari kelumpuhan pilihan.
2. Kartu menampilkan **pertanyaan** (bukan penjelasan panjang) + label kecil jenis keluaran (mis. "ringkasan bukti", "dosis", "interaksi").
3. Ketuk → jalankan AI dengan **estimasi biaya tampil** (lihat `docs/credits.md` §6/§8).
4. **Jika saldo Rp0**: tampilkan contoh **hasil yang di-mock** (snapshot statis, ditandai jelas "contoh") + tombol "Isi saldo untuk mencoba".
5. Jika saldo > 0: jalankan sungguhan; hasil asli menggantikan mock.

> Catatan penting: karena AI berbayar dan tanpa trial, **wajib ada contoh hasil statis** (snapshot dari golden set yang sudah divalidasi) agar pengguna merasakan nilai sebelum membayar. Snapshot ini diambil dari pertanyaan yang sama saat golden set dibuat (Sprint 4), ditandai tanggal & sumber, dan **tidak pernah** menampilkan jawaban yang belum diverifikasi.

### 4.1 Setelah contoh hasil tampil → dorong berbagi (fondasi sekarang, integrasi ditunda)
Sesuai `docs/principles.md` §4, yang **dikerjakan sekarang** hanya fondasi murah:
1. **Tombol "Salin tautan"** pada contoh hasil & drug card.
2. **Halaman topik publik** sebagai tujuan tautan (aman dibagikan tanpa login).
3. **OG tags + gambar 1200×630** agar preview tautan rapi.

**Ditunda ke backlog** (setelah sistem dasar stabil): Web Share API, tombol eksplisit WhatsApp/IG/Threads/X, kartu gambar share, `share_target` PWA, snapshot jawaban publik (opt-in), dan pelacakan rujukan `?ref=`/K-factor.

### 4.2 Auth & lingkungan mobile
- Penyedia masuk: **Google OAuth** + **magic link/OTP email**. (**Apple Sign In tidak dipakai**.)
- **In-app browser** (Instagram/Facebook/TikTok/Line) memblokir OAuth Google → deteksi UA dan tampilkan layar "Buka di Chrome/Safari" + tombol salin tautan.
- **Keterkiriman email**: domain pengirim + SPF/DKIM; sediakan **OTP 6 digit** sebagai cadangan bila magic link gagal dibuka.
- Tombol **Salin tautan** tersedia pada contoh hasil (fondasi berbagi); integrasi kanal share ditunda ke backlog.

## 5. Spesifikasi data (ringkas)
Tabel `profiles` (baru, melengkapi `credit_accounts`):
```sql
create table profiles (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  full_name        text,
  role_category    text not null default 'unknown',  -- akademik | klinis | farmasi | industri | lainnya | unknown
  role_detail      text,                              -- mahasiswa_s1 | koas | dokter_umum | apoteker | ...
  role_other       text,                              -- bila memilih "Lainnya"
  institution_type text,                              -- kampus | rs | puskesmas | apotek | perusahaan | mandiri
  institution_name text,
  purpose          text,                              -- riset | klinis | studi | obat | intelijen | belajar
  consent          boolean not null default false,
  consent_at       timestamptz,
  onboarding_step  int not null default 0,           -- untuk analitik drop-off
  onboarding_done  boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
```
Aturan tambahan:
- `onboarding_step` diperbarui setiap langkah → **drop-off per langkah** bisa dihitung.
- RLS: pengguna hanya baca/tulis barisnya sendiri; agregat hanya via server.
- Data mentah tidak pernah dibagikan ke pihak ketiga; laporan selalu **agregat** (n ≥ 10 segmen).

## 6. Event analitik
| Event | Kapan | Properti |
|---|---|---|
| `auth_started` | menekan masuk | `provider` (google/magic_link) |
| `auth_completed` | sesi terbentuk | `is_new_user` |
| `onboarding_viewed` | kartu 1 tampil | `variant` (A: setelah login, B: setelah search pertama) |
| `onboarding_step_completed` | tiap langkah | `step` (1/2/3), `skipped` (bool) |
| `onboarding_completed` | langkah 3 selesai | `role_category`, `institution_type`, `purpose`, `consent` |
| `onboarding_skipped_all` | menutup onboarding | `from_step` |
| `sample_question_clicked` | mengetuk kartu contoh | `role_category`, `sample_id`, `balance_zero` (bool) |
| `sample_result_shown` | hasil (mock/nyata) tampil | `mode` (mock/real), `latency_ms` |
| `first_search` | pencarian pertama | `query_len`, `source_count` |
| `first_ai_charge` | debit AI pertama | `charged_idr`, `tokens_in`, `tokens_out` |
| `first_topup` | top-up pertama berhasil | `amount_idr`, `method` |
| `onboarding_edit` | mengubah profil dari pengaturan | `field` |

Prinsip: **tanpa PII di properti event**; `role_other` tidak pernah dikirim ke analitik (hanya ke DB).

## 7. Aturan pemakaian data (UU PDP)
| Data | Dipakai untuk | Tidak dipakai untuk |
|---|---|---|
| Peran (`role_category/detail`) | Personalisasi mode & rekomendasi; segmentasi penawaran | Tidak dijual; tidak untuk diskriminasi harga tersembunyi |
| Institusi | Penawaran lisensi B2B; laporan agregat | Tidak mengungkap individu ke institusi tanpa izin |
| Tujuan | Onboarding kontekstual; roadmap fitur | — |
| Email | Autentikasi, notifikasi produk/topik | Tidak dibagikan ke pihak ketiga tanpa consent |
| Query & percakapan | Perbaikan kualitas (agregat), golden set evaluasi | Tidak untuk iklan pihak ketiga |
| Profil demo | **Tidak ada** data pasien (ditolak 422) | — |

Kewajiban:
1. **Consent eksplisit** + tautan kebijakan privasi di kartu 3.
2. **Hak akses & hapus**: pengguna dapat mengunduh/menghapus data profil & percakapan; endpoint/permintaan manual.
3. **Retensi**: percakapan AI 90 hari; profil selama akun aktif + 30 hari setelah hapus.
4. **Minimisasi**: hanya tanyakan yang dipakai; semua opsional kecuali consent.
5. **Keamanan**: akses DB via service_role di server; RLS aktif; tidak ada PII di log analitik.
6. **Transparansi laporan**: laporan ke institusi selalu agregat (n ≥ 10), tanpa mengidentifikasi individu.

## 8. Eksperimen & metrik
| Eksperimen | Varian | Metrik utama |
|---|---|---|
| Waktu onboarding | A: langsung setelah login · B: setelah pencarian pertama | `onboarding_completed` / `onboarding_viewed`; `first_search` |
| Panjang onboarding | 1 pertanyaan vs 3 pertanyaan | completion rate, `first_topup` |
| Template AI | 3 kartu peran-spesifik vs 3 kartu generik | `sample_question_clicked` → `first_topup` |

Funnel yang dipantau harian:
`auth_started → auth_completed → onboarding_viewed → onboarding_completed → sample_question_clicked → first_search → first_topup`

Target awal (indikatif): completion onboarding ≥ 60%; klik template ≥ 35%; konversi ke top-up pertama ≥ 3% dalam 7 hari.

## 9. Yang harus dihindari
1. Menampilkan harga akademik/industri **di layar onboarding**.
2. Lebih dari 3 langkah atau lebih dari 1 tingkat percabangan.
3. Mewajibkan institusi/email institusi (honor-based dulu).
4. Menyimpan `role_other` ke analitik (risiko PII).
5. Menampilkan contoh hasil AI **tanpa penanda "contoh"**.
6. Menaruh consent sebagai centang tersembunyi/pre-checked.

## 10. Dependensi Sprint 1
- Supabase Auth: **Google OAuth + magic link** aktif.
- Tabel `profiles` + trigger `handle_new_user`.
- Master data institusi sederhana (CSV → tabel kecil) untuk autocomplete.
- **Golden set snapshot** (3–6 contoh hasil) — dibuat di Sprint 4; sebelum itu, kartu contoh menampilkan hasil mock yang ditandai "contoh" dan belum diverifikasi (dilarang tampil sebagai nyata).
