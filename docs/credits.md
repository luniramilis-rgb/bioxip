# bioXip — Rancangan Teknis: Kredit, Top-up, dan AI Proxy

Dokumen hidup. Ringkasan keputusan dicatat juga di `docs/blueprint.md` (decision log).

## 1. Ringkasan model
Pengguna membayar → saldo/kuota bertambah → memakai AI di bioXip → backend meneruskan ke provider (DeepSeek) → kuota berkurang → bioXip mengambil margin.

Prinsip:
1. **Ledger, bukan kolom saldo bebas.** Saldo = jumlah mutasi; setiap perubahan punya baris.
2. **Debit di depan, refund bila gagal.** Tidak ada pemakaian tanpa potong; tidak ada potong tanpa layanan.
3. **Idempotent.** Webhook top-up & retry tidak boleh menggandakan saldo.
4. **Grounded.** AI wajib memakai retrieval bioXip + sitasi; tanpa itu, chat ditolak.
5. **Tanpa data pasien.** Input yang memuat data identitas pasien ditolak/di-mask.
6. **Rahasia.** API key provider hanya di server (env), tidak pernah di browser.

## 2. Skema tabel (Postgres/Supabase)

```sql
-- 2.1 Akun kredit (1 baris per user; saldo adalah cache dari ledger)
create table credit_accounts (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  balance        bigint not null default 0,      -- dipertahankan via trigger dari ledger
  currency       text   not null default 'IDR',
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

-- 2.2 Ledger (sumber kebenaran; append-only)
create table credit_ledger (
  id               bigserial primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  delta            bigint not null,                 -- + topup/bonus, - usage/penalti
  reason           text   not null,                 -- topup | usage | refund | bonus | adjustment
  ref_id           text,                            -- id request AI / id pembayaran
  idempotency_key  text,                            -- unik bila ada (mis. webhook id)
  meta             jsonb  not null default '{}',    -- provider, model, tokens, biaya
  created_at       timestamptz not null default now()
);

create unique index credit_ledger_idem_idx
  on credit_ledger (idempotency_key)
  where idempotency_key is not null;
create index credit_ledger_user_idx on credit_ledger (user_id, created_at desc);

-- 2.3 Top-up (intent & hasil pembayaran)
create table topups (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  provider         text not null,                   -- qris | gopay | ovo | dana | bank | manual
  provider_ref     text,                            -- id transaksi di provider
  amount_idr       bigint not null,
  credits          bigint not null,                 -- kredit yang diberikan (termasuk bonus)
  status           text not null default 'pending', -- pending | paid | expired | failed | refunded
  idempotency_key  text unique,
  created_at       timestamptz not null default now(),
  paid_at          timestamptz
);

-- 2.4 Log pemakaian AI (audit biaya & margin)
create table ai_usage_log (
  id             bigserial primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  request_id     uuid not null,
  feature        text not null,                     -- chat | answer | drug | interactions
  provider       text not null,                     -- deepseek
  model          text not null,
  input_tokens   int not null default 0,
  output_tokens  int not null default 0,
  cost_micro_idr bigint not null default 0,         -- biaya asli (µIDR, integer)
  credits_charged bigint not null default 0,
  margin_micro_idr bigint generated always as
    (credits_charged * 1000000 - cost_micro_idr) stored,
  status         text not null default 'ok',        -- ok | refunded | error
  created_at     timestamptz not null default now()
);
create index ai_usage_user_idx on ai_usage_log (user_id, created_at desc);

-- 2.5 Kuota & pembatasan
create table usage_limits (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  plan           text not null default 'free',      -- free | plus | institutional
  daily_credits  bigint not null default 2000,      -- batas harian (0 = tanpa batas)
  rpm            int not null default 6,            -- request per menit
  updated_at     timestamptz not null default now()
);
```

### Trigger saldo (cache dari ledger)
```sql
create or replace function apply_ledger_delta() returns trigger language plpgsql as $$
begin
  insert into credit_accounts (user_id, balance)
  values (new.user_id, new.delta)
  on conflict (user_id) do update
    set balance = credit_accounts.balance + new.delta,
        updated_at = now();
  return new;
end $$;

create trigger credit_ledger_apply
  after insert on credit_ledger
  for each row execute function apply_ledger_delta();
```

### RLS
```sql
alter table credit_accounts enable row level security;
alter table credit_ledger  enable row level security;
alter table topups         enable row level security;
alter table ai_usage_log   enable row level security;
alter table usage_limits   enable row level security;

-- pengguna hanya bisa membaca datanya sendiri
create policy own_account on credit_accounts for select using (auth.uid() = user_id);
create policy own_ledger  on credit_ledger   for select using (auth.uid() = user_id);
create policy own_topups  on topups          for select using (auth.uid() = user_id);
create policy own_usage   on ai_usage_log    for select using (auth.uid() = user_id);
create policy own_limits  on usage_limits    for select using (auth.uid() = user_id);

-- tulis (insert ledger/usage) hanya via service_role di server; tidak ada policy insert untuk anon/user
revoke insert, update, delete on credit_ledger, ai_usage_log, topups from anon, authenticated;
```

## 3. Alur debit & refund

### 3.1 Pemakaian AI (chat/answer)
```
1. Terima permintaan (terautentikasi) → buat request_id (uuid).
2. Cek usage_limits: rpm (rate limit) & daily_credits.
3. Estimasi biaya maksimum berdasarkan max_tokens → cek saldo ≥ estimasi.
   Jika saldo < estimasi → 402 { error: "saldo tidak cukup", balance }.
4. Debit sementara (hold) sebesar estimasi:
   insert credit_ledger (delta = -estimasi, reason='usage', ref_id=request_id,
                         meta={state:'hold'})
5. Jalankan retrieval + panggil DeepSeek (stream SSE).
6. Setelah stream selesai, dapatkan usage asli (input/output tokens).
   - biaya_asli → kredit_asli = ceil(biaya_asli × markup)
   - Selisih: refund = estimasi − kredit_asli
     insert credit_ledger (delta = +refund, reason='refund', ref_id=request_id,
                           meta={state:'settle'})
   - catat ai_usage_log (tokens, biaya, kredit, margin, status='ok')
7. Bila gagal/timeout sebelum output:
   insert credit_ledger (delta = +estimasi, reason='refund', ref_id=request_id,
                         meta={state:'fail'})
   catat ai_usage_log status='refunded'.
```

Aturan:
- Debit hold & settle memakai `ref_id` + `idempotency_key = request_id + ':hold' / ':settle'`.
- Markup kredit dikonfigurasi di server (mis. `CREDIT_MARKUP = 2.6`).
- Pembulatan: selalu **ke atas** ke satuan kredit (menguntungkan margin, transparan di UI).

### 3.2 Top-up
```
1. Klien POST /api/credits/topup { amount_idr, provider } → server buat row topups(status='pending')
   + buat transaksi di provider (QRIS/e-wallet) → kembalikan instruksi bayar.
2. Provider memanggil /api/payments/webhook (server-to-server).
3. Verifikasi signature provider.
4. Idempotent: proses hanya bila topups.status masih 'pending' dan provider_ref belum ada.
5. insert credit_ledger (delta = +credits, reason='topup', idempotency_key = provider_ref)
6. update topups(status='paid', paid_at=now()).
7. Bila gagal kedaluwarsa → status='expired' (tanpa mutasi ledger).
```

## 4. Konfigurasi harga (server env)
| Variabel | Contoh | Fungsi |
|---|---|---|
| `DEEPSEEK_API_KEY` | sk-… | kredensial provider (server-only) |
| `DEEPSEEK_BASE_URL` | https://api.deepseek.com | endpoint provider |
| `DEEPSEEK_MODEL` | deepseek-chat | model default |
| `PRICE_IN_MICRO_IDR_PER_1K` | 150000 | biaya input per 1k token (µIDR) |
| `PRICE_OUT_MICRO_IDR_PER_1K` | 600000 | biaya output per 1k token (µIDR) |
| `CREDIT_MARKUP` | 2.6 | pengali kredit terhadap biaya asli |
| `MAX_TOKENS_DEFAULT` | 1024 | batas output per permintaan |
| `FREE_DAILY_CREDITS` | 2000 | kuota harian tier free |

> Harga di atas contoh; **wajib disesuaikan** dengan tarif provider terkini saat implementasi.

## 5. Kontrak endpoint

### 5.1 `GET /api/credits/me`
```json
{ "balance": 48210, "currency": "IDR", "plan": "plus",
  "daily_credits": 2000, "used_today": 340 }
```

### 5.2 `POST /api/credits/topup`
Request: `{ "amount_idr": 50000, "provider": "qris" }`
Response:
```json
{ "topup_id": "uuid", "status": "pending", "amount_idr": 50000, "credits": 50000,
  "payment": { "qr_string": "00020101…", "expires_at": "2026-09-10T11:00:00Z" } }
```

### 5.3 `POST /api/payments/webhook` (server-to-server)
- Verifikasi signature; balas `200` cepat; proses idempotent.

### 5.4 `POST /api/ai/chat` (SSE)
Request:
```json
{ "messages": [{"role":"user","content":"…"}],
  "feature": "chat",
  "grounding": { "search": true, "drug": true },
  "max_tokens": 1024 }
```
Respons (SSE):
```
event: meta
data: {"request_id":"uuid","balance_after_hold":47000}

event: delta
data: {"text":"Metformin…"}

event: citation
data: {"n":1,"title":"…","url":"…"}

event: done
data: {"credits_charged":420,"balance":47790,"tokens":{"in":3890,"out":730}}
```
Error:
| Status | Kondisi | Body |
|---|---|---|
| 401 | belum login | `{ "error": "unauthorized" }` |
| 402 | saldo/kuota kurang | `{ "error": "insufficient_credits", "balance": 120 }` |
| 429 | rate limit harian/menit | `{ "error": "rate_limited", "retry_after": 30 }` |
| 422 | input terlarang (data pasien/permintaan diagnosa) | `{ "error": "unsafe_input", "reason": "…" }` |
| 502 | provider gagal | `{ "error": "provider_error" }` (saldo otomatis di-refund) |

### 5.5 `GET /api/credits/ledger?limit=50`
```json
{ "items": [ { "delta": -420, "reason": "usage", "ref_id": "uuid", "created_at": "…" } ] }
```

## 6. Guardrail safety (wajib di `/api/ai/chat`)
1. **Grounded-only**: retrieval bioXip dijalankan lebih dulu; prompt sistem melarang klaim tanpa sumber dan mewajibkan `[n]`.
2. **Tolak**: permintaan diagnosis pasien, peresepan, atau input data pasien (NIK, MRN, nomor telepon, tanggal lahir + nama).
3. **Validasi sitasi**: setiap `[n]` harus ada di konteks retrieval; jika tidak → tandai peringatan.
4. **Disclaimer** di setiap respons + tombol "lihat sumber".
5. **Log audit** tanpa menyimpan isi percakapan melebihi kebijakan privasi (default: simpan hash + metadata, bukan teks penuh).

## 7. Metrik untuk dijaga
| Metrik | Target awal |
|---|---|
| Saldo negatif | **0** (constraint: tidak boleh < 0) |
| Dobel top-up | 0 (idempotency) |
| Refund gagal bayar | 100% tercatat |
| Margin rata-rata per request | ≥ 55% dari kredit |
| Latensi first token | < 3 dtk |
| Insiden saldo tidak cocok (ledger vs cache) | 0 (uji rekonsiliasi harian) |

## 8. Uji & validasi
1. **Unit**: perhitungan biaya→kredit, pembulatan, refund.
2. **Integrasi**: hold→settle; hold→fail→refund; saldo tidak pernah negatif.
3. **Idempotency**: webhook dikirim 2× → saldo bertambah sekali.
4. **Rekonsiliasi**: `SUM(ledger.delta) == credit_accounts.balance` untuk semua user (job harian).
5. **Safety**: 10 prompt terlarang → 422; 10 prompt sah → grounded + sitasi.
6. **CI**: skrip validasi baru `scripts/validate_credits.js` (struktur & aturan) dijalankan bersama validator lain.

## 9. Urutan implementasi
| Fase | Isi | Hasil |
|---|---|---|
| P1 | Migrasi tabel + trigger + RLS; `GET /api/credits/me`; debit/refund dasar (tanpa AI) | ledger dapat diuji |
| P2 | `POST /api/ai/chat` proxy DeepSeek + estimasi hold + settle + log | chat berbayar berjalan |
| P3 | Grounded RAG + sitasi + guardrail input | pembeda & keamanan |
| P4 | Top-up QRIS/e-wallet + webhook idempotent | monetisasi aktif |
| P5 | Tier & kuota institusi, API key pelanggan | B2B |

## 10. Keputusan yang sudah ditetapkan (2026-09-10)
1. **Provider top-up: Xendit** (QRIS/e-wallet/VA) dengan webhook idempotent.
2. **Gratis vs berbayar: mode eksplisit** — segmented `[Cari bukti · GRATIS]` vs `[Tanya AI · kredit]`; search-first + estimasi biaya tampil sebelum eksekusi (lihat §11).
3. **Simpan percakapan untuk evaluasi** — teks percakapan disimpan dengan kebijakan retensi & privasi (lihat §11.4).
4. **Provider AI: DeepSeek** (satu-satunya) — tetap dibuat lapisan abstraksi `provider` agar bisa menambah model lain tanpa mengubah ledger.

## 11. UX: membedakan gratis vs berbayar (satu search bar)

### 11.1 Prinsip
1. **Search & data selalu gratis** (`/api/search`, `/api/answer`, `/api/drug`, `/api/interactions`) — **tidak pernah** menyentuh ledger.
2. **AI selalu berbayar** (`POST /api/ai/chat`) — hanya endpoint ini yang melakukan debit.
3. **Biaya tampil sebelum eksekusi** (estimasi), dan **hasil akhir menampilkan kredit terpakai**.
4. Tidak ada pemotongan otomatis; perpindahan ke mode AI selalu aksi sadar pengguna.

### 11.2 Tata letak
```
[ Cari bukti · GRATIS ]  [ Tanya AI · kredit ]     ← segmented, default: gratis
┌─────────────────────────────────────────────┐
│ tulis pertanyaan atau kata kunci…           │
└─────────────────────────────────────────────┘
[ Cari ]            atau            [ Tanya AI ≈ 400 kredit ]
Saldo: 48.210 kredit · AI gratis 2/3 hari ini · Isi kredit
```
- Mode gratis: tombol "Cari" (tanpa angka kredit).
- Mode AI: tombol menampilkan estimasi; bila saldo/kuota kurang → tombol menjadi "Isi kredit".
- Badge saldo + kuota AI harian selalu terlihat di header.

### 11.3 Search-first + saran intent (bukan auto-charge)
- Setelah hasil gratis tampil, muncul kartu: **"Buat sintesis AI dari N studi — perkiraan X kredit"** → `[Buat jawaban AI]`.
- Deteksi intent (mis. ada "?", "apakah", "vs") hanya memunculkan **chip saran** untuk pindah ke mode AI; tetap butuh tap konfirmasi.

### 11.4 Kuota gratis & penyimpanan percakapan
- Tier free: `daily_credits = 2000` (≈3 jawaban AI/hari) untuk user terdaftar; search tetap tak terbatas.
- Penyimpanan percakapan untuk evaluasi: teks disimpan di `ai_chat_log` dengan **retensi 90 hari**, dapat dihapus atas permintaan pengguna, dan **tidak memuat data pasien** (input semacam itu ditolak 422). Metadata (tokens, biaya, margin) disimpan lebih lama untuk audit keuangan.

### 11.5 Endpoint terkait
| Endpoint | Biaya | Auth | Catatan |
|---|---|---|---|
| `GET /api/search` | gratis | opsional | tanpa ledger |
| `POST /api/ai/chat` | berbayar | wajib | debit hold→settle |
| `GET /api/ai/estimate?feature=answer&max_tokens=1024` | gratis | wajib | `{ "credits": 420 }` untuk preview tombol |
| `GET /api/credits/me` | gratis | wajib | saldo + kuota harian |
| `POST /api/payments/webhook` | — | provider | idempotent |

### 11.6 Tabel tambahan (percakapan)
```sql
create table ai_chat_log (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  request_id  uuid not null,
  feature     text not null,
  messages    jsonb not null,          -- teks percakapan (retensi 90 hari)
  answer      text,
  citations   jsonb not null default '[]',
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '90 days')
);
create index ai_chat_log_user_idx on ai_chat_log (user_id, created_at desc);
-- job harian: delete from ai_chat_log where expires_at < now();
```

