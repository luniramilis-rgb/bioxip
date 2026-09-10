# bioXip — Rancangan Teknis: Saldo Rp, Top-up, dan AI Proxy

Dokumen hidup. Keputusan dicatat juga di `docs/blueprint.md` (decision log).

## 1. Model bisnis (final)

1. **Search & data selalu gratis** (tanpa login, tanpa batas, tanpa ledger).
2. **AI (Tanya AI / sintesis) terkunci tanpa saldo.** Tidak ada trial.
3. Saldo dibeli bertingkat: **Rp50.000 · Rp100.000 · Rp150.000 · Rp500.000** — **tanpa bonus** (1:1).
4. **Saldo tidak kedaluwarsa** — tanpa masa berlaku.
5. Saldo ditampilkan dalam **Rp** (gaya platform DeepSeek), bukan "kredit".
6. Harga AI = **biaya asli DeepSeek × markup 12×**, dihitung dari **tarif peak**.
7. Provider AI: **DeepSeek V4.1 Flash** (satu-satunya, dengan lapisan abstraksi `provider`).
8. Top-up via **Xendit**: QRIS, Virtual Account, dan e-wallet.

Prinsip teknis:
- **Ledger append-only** (sumber kebenaran); saldo = jumlah mutasi.
- **Debit di depan, refund bila gagal**; idempotent.
- **Grounded-only**: AI wajib memakai retrieval bioXip + sitasi `[n]`.
- **Tanpa data pasien**; input semacam itu ditolak (422).
- API key provider **hanya di server**.
- Percakapan disimpan untuk evaluasi (retensi 90 hari, dapat dihapus atas permintaan).

## 2. Satuan uang & pembulatan
- Semua nilai disimpan sebagai **micro-IDR** (integer; 1 Rp = 1.000.000 micro).
- Perhitungan memakai integer µIDR → hindari galat float.
- Pembulatan tagihan: **selalu ke atas ke Rp1 penuh**.
- Minimal tagihan per permintaan: **Rp100** (`MIN_CHARGE_MICRO_IDR = 100000000`).
- Tampilan saldo: `Rp 48.210`.

## 3. Skema tabel

```sql
-- 3.1 Akun saldo (cache dari ledger)
create table credit_accounts (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  balance_micro_idr   bigint not null default 0 check (balance_micro_idr >= 0),
  plan                text not null default 'free',   -- free | paid | institution
  updated_at          timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

-- 3.2 Ledger (append-only; sumber kebenaran)
create table credit_ledger (
  id                 bigserial primary key,
  user_id            uuid not null references auth.users(id) on delete cascade,
  delta_micro_idr    bigint not null,          -- + topup/bonus/refund, - usage
  reason             text not null,            -- topup | usage | refund | bonus | adjustment
  ref_id             text,                     -- request_id AI / id pembayaran
  idempotency_key    text,
  meta               jsonb not null default '{}',
  created_at         timestamptz not null default now()
);
create unique index credit_ledger_idem_idx on credit_ledger (idempotency_key) where idempotency_key is not null;
create index credit_ledger_user_idx on credit_ledger (user_id, created_at desc);

-- 3.3 Top-up
create table topups (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  provider          text not null default 'xendit',
  provider_ref      text,
  amount_idr        bigint not null,
  bonus_idr         bigint not null default 0,
  credited_idr      bigint not null,
  status            text not null default 'pending', -- pending | paid | expired | failed | refunded
  idempotency_key   text unique,
  created_at        timestamptz not null default now(),
  paid_at           timestamptz
);

-- 3.4 Log pemakaian AI (audit biaya & margin)
create table ai_usage_log (
  id                bigserial primary key,
  user_id           uuid not null references auth.users(id) on delete cascade,
  request_id        uuid not null,
  feature           text not null,             -- chat | answer | drug | interactions
  provider          text not null default 'deepseek',
  model             text not null,
  input_tokens      int not null default 0,
  output_tokens     int not null default 0,
  cost_micro_idr    bigint not null default 0, -- biaya asli (tarif peak)
  charged_micro_idr bigint not null default 0, -- yang didebitkan ke user
  margin_micro_idr  bigint generated always as (charged_micro_idr - cost_micro_idr) stored,
  status            text not null default 'ok', -- ok | refunded | error
  created_at        timestamptz not null default now()
);
create index ai_usage_user_idx on ai_usage_log (user_id, created_at desc);

-- 3.5 Riwayat percakapan (evaluasi; retensi 90 hari)
create table ai_chat_log (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  request_id  uuid not null,
  feature     text not null,
  messages    jsonb not null,
  answer      text,
  citations   jsonb not null default '[]',
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '90 days')
);
create index ai_chat_log_user_idx on ai_chat_log (user_id, created_at desc);
```

Trigger saldo:
```sql
create or replace function apply_ledger_delta() returns trigger language plpgsql as $$
begin
  insert into credit_accounts (user_id, balance_micro_idr)
  values (new.user_id, new.delta_micro_idr)
  on conflict (user_id) do update
    set balance_micro_idr = credit_accounts.balance_micro_idr + new.delta_micro_idr,
        updated_at = now();
  return new;
end $$;

create trigger credit_ledger_apply after insert on credit_ledger
for each row execute function apply_ledger_delta();
```

RLS: user hanya **membaca** data miliknya; insert/update/delete hanya via `service_role`.

## 4. Tarif, konfigurasi, dan markup

Tarif DeepSeek V4.1 Flash (per 1 juta token, USD):
| Komponen | Tarif |
|---|---|
| Input — cache **hit** | $0,006 |
| Input — cache **miss** | $0,30 |
| Output | $1,20 |

| Variabel | Nilai | Fungsi |
|---|---|---|
| `DEEPSEEK_API_KEY` | sk-… | server-only |
| `DEEPSEEK_BASE_URL` | https://api.deepseek.com | endpoint |
| `DEEPSEEK_MODEL` | deepseek-v4.1-flash | model |
| `USD_IDR` | 16300 | kurs internal (perbarui berkala) |
| `PRICE_IN_HIT_MICRO_IDR_PER_1K` | 97800 | input cache hit per 1k token (µIDR) |
| `PRICE_IN_MISS_MICRO_IDR_PER_1K` | 4890000 | input cache miss per 1k token (µIDR) |
| `PRICE_OUT_MICRO_IDR_PER_1K` | 19560000 | output per 1k token (µIDR) |
| `MARKUP` | **12** | pengali harga jual |
| `MIN_CHARGE_MICRO_IDR` | 100000000 (Rp100) | minimal tagihan |
| `RATE_LIMIT_RPM` | 6 | batas permintaan AI/menit/user |

Rumus (µIDR, integer):
```
cost    = ceil(in_hit_tokens/1000  * PRICE_IN_HIT)
        + ceil(in_miss_tokens/1000 * PRICE_IN_MISS)
        + ceil(out_tokens/1000     * PRICE_OUT)
charged = max(cost * MARKUP, MIN_CHARGE)
charged = ceil(charged / 1_000_000) * 1_000_000        # bulat ke Rp1
```

### Peran penting cache (pengungkit margin terbesar)
Cache hit **50× lebih murah** dari cache miss ($0,006 vs $0,30). Karena itu prompt harus disusun agar **prefix stabil**:
- Urutan: `system prompt` + kamus/instruksi tetap → **konteks retrieval & pertanyaan di paling akhir**.
- Jangan menyisipkan timestamp/ID acak di awal prompt (merusak cache).
- Pertahankan system prompt identik antar-request sebisa mungkin.

### Ilustrasi (kurs Rp16.300/$)
Satu jawaban: 4.000 token input + 1.000 token output.

| Skenario | Biaya asli | Dijual 12× | Dibulatkan |
|---|---|---|---|
| Input mayoritas cache **hit** (2.800 hit + 1.200 miss) | ≈ Rp25,7 | ≈ Rp308 | **Rp309** |
| Input **tanpa cache** (4.000 miss) | ≈ Rp39,1 | ≈ Rp469 | **Rp470** |

Daya beli saldo (perkiraan):
| Saldo | Dengan cache baik (Rp309/jawaban) | Tanpa cache (Rp470/jawaban) |
|---|---|---|
| Rp50.000 | ±161 jawaban | ±106 jawaban |
| Rp100.000 | ±323 | ±212 |
| Rp150.000 | ±485 | ±319 |
| Rp500.000 | ±1.618 | ±1.063 |

## 5. Alur debit & refund (AI) — tanpa trial

```
1. Request terautentikasi → request_id (uuid).
2. Estimasi = f(max_tokens) * MARKUP, minimal Rp100.
3. Saldo < estimasi → 402 { error: "insufficient_balance", balance_idr }.
4. Hold: ledger(-estimasi, reason='usage', ref_id=request_id, meta.state='hold').
5. Retrieval bioXip → DeepSeek (SSE) → usage asli.
6. Settle:
   charged = tagihan dari usage asli
   refund  = estimasi - charged (bila positif)
   ledger(+refund, reason='refund', ref_id, meta.state='settle')
   ai_usage_log(cost, charged, status='ok')
   ai_chat_log(messages, answer, citations)
7. Gagal/timeout sebelum output → refund penuh (meta.state='fail'), status='refunded'.
```

Idempotency: `request_id + ':hold' | ':settle' | ':fail'`.

## 6. Gating gratis vs berbayar

| Area | Akses | Biaya |
|---|---|---|
| `/api/search`, `/api/answer`, `/api/drug`, `/api/interactions` | publik | **gratis, tanpa ledger** |
| `/api/ai/chat` | login + saldo > 0 | berbayar (hold→settle) |
| Halaman AI di UI | login + saldo > 0 | tombol menampilkan estimasi |

Tanpa saldo: **AI terkunci** (tombol menjadi "Isi saldo"), tetapi seluruh search & data tetap dapat dipakai — termasuk oleh pengunjung tanpa akun (SEO & akuisisi tetap jalan).

Alasan pemisahan ini penting: `/api/search` tidak pernah menyentuh ledger, sehingga **mustahil** biaya muncul dari pencarian.

## 7. Paket top-up (tanpa bonus, 1:1)
| Paket | Dibayar | Saldo masuk |
|---|---|---|
| Kecil | Rp50.000 | Rp50.000 |
| Menengah | Rp100.000 | Rp100.000 |
| Besar | Rp150.000 | Rp150.000 |
| Ekstra | Rp500.000 | Rp500.000 |

Kanal pembayaran (Xendit): **QRIS**, **Virtual Account**, **e-wallet** (OVO/DANA/ShopeePay sesuai ketersediaan akun Xendit).

## 8. Kontrak endpoint

### 8.1 `GET /api/credits/me`
```json
{ "balance_idr": 0, "plan": "free", "ai_locked": true, "currency": "IDR" }
```

### 8.2 `POST /api/credits/topup`
Request: `{ "amount_idr": 100000, "method": "qris" }`
Response:
```json
{ "topup_id": "uuid", "status": "pending", "amount_idr": 100000, "bonus_idr": 5000,
  "payment": { "type": "qris", "qr_string": "00020101…", "expires_at": "2026-09-10T11:00:00Z" } }
```

### 8.3 `POST /api/payments/webhook` (Xendit)
Verifikasi callback token/signature; balas 200 cepat; proses idempotent via `provider_ref`.

### 8.4 `GET /api/ai/estimate?feature=chat&max_tokens=1024`
```json
{ "estimate_idr": 435, "basis": "peak", "markup": 12 }
```

### 8.5 `POST /api/ai/chat` (SSE)
Request: `{ "messages": [...], "feature": "chat", "grounding": {"search": true, "drug": true}, "max_tokens": 1024 }`
```
event: meta      data: {"request_id":"uuid","estimate_idr":435,"balance_idr":48210}
event: delta     data: {"text":"Metformin…"}
event: citation  data: {"n":1,"title":"…","url":"…"}
event: done      data: {"charged_idr":435,"balance_idr":47775,"tokens":{"in":3890,"out":730}}
```
Error: 401 unauthorized · 402 insufficient_balance · 429 rate_limited · 422 unsafe_input · 502 provider_error (saldo otomatis refund).

### 8.6 `GET /api/credits/ledger?limit=50`
```json
{ "items": [ { "delta_idr": -435, "reason": "usage", "ref_id": "uuid", "created_at": "…" } ] }
```

## 9. Guardrail safety (`/api/ai/chat`)
1. **Grounded-only**: retrieval dijalankan lebih dulu; prompt melarang klaim tanpa sumber dan mewajibkan `[n]`.
2. **Tolak**: permintaan diagnosis pasien/peresepan, dan input data pasien (NIK, MRN, telepon, tanggal lahir + nama) → 422.
3. **Validasi sitasi**: setiap `[n]` harus ada di konteks retrieval; jika tidak → tandai peringatan.
4. **Disclaimer** di setiap respons + tombol "lihat sumber".
5. **Log audit**: percakapan disimpan terbatas (retensi 90 hari) tanpa data pasien.

## 10. Metrik & validasi
| Metrik | Target |
|---|---|
| Saldo negatif | 0 (constraint DB) |
| Dobel top-up | 0 (idempotency) |
| Refund gagal | 100% tercatat |
| Margin rata-rata | mendekati 12× biaya asli (dikurangi biaya pembayaran Xendit) |
| Rekonsiliasi harian | `SUM(ledger.delta_micro_idr) == balance_micro_idr` semua akun |
| Konversi | pengunjung search → top-up pertama (diukur sejak peluncuran) |

Uji wajib: perhitungan tagihan (pembulatan + minimum), hold→settle, hold→fail→refund, webhook ganda, akses AI dengan saldo 0 → 402, 10 prompt terlarang → 422.

## 11. Urutan implementasi
| Fase | Isi |
|---|---|
| P1 | Migrasi tabel + trigger + RLS; `GET /api/credits/me`; uji ledger tanpa AI |
| P2 | `POST /api/ai/chat` proxy DeepSeek + hold/settle + `ai_usage_log` |
| P3 | Grounded RAG + sitasi + guardrail input + `ai_chat_log` (retensi 90 hari) |
| P4 | UI: tombol AI menampilkan estimasi, status saldo, AI terkunci saat Rp0 |
| P5 | Xendit top-up + webhook idempotent + halaman saldo/riwayat |
| P6 | Paket institusi & API pelanggan |

## 12. Keputusan yang sudah final
1. Top-up: **Xendit** (QRIS + Virtual Account + e-wallet).
2. Model: **search gratis selamanya; AI terkunci tanpa saldo; tanpa trial**.
3. Provider: **DeepSeek V4.1 Flash** — tarif input cache hit $0,006 / miss $0,30 / output $1,20 per 1 juta token.
4. Percakapan: **disimpan untuk evaluasi** (retensi 90 hari, dapat dihapus, tanpa data pasien).
5. Saldo: **Rp, tanpa kedaluwarsa, tanpa bonus**, markup **12×** biaya asli.
6. Optimasi cache prompt (prefix stabil) sebagai pengungkit margin utama.
