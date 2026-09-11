# AGENTS.md

Repo bioXip. Baca `docs/blueprint.md` sebelum mengubah arsitektur.

## Komando

- Harvester (lokal): `python -m harvester.runners.harvest_delta --provider europepmc`
- Syntax check tanpa deps: `python -m compileall harvester tests scripts`
- Test: `python -m pytest` (di lingkungan dengan deps terpasang)
- Migrasi: `supabase db push` (perlu Supabase CLI)

## Validasi (jalankan sebelum commit)

- `node scripts/validate_drugs.js` — struktur katalog obat + ATC
- `node scripts/validate_monitoring.js` — kelengkapan monitoring 30 obat
- `node scripts/validate_interactions.js` — tabel interaksi + severity
- `node scripts/validate_topics.js` — data topik + halaman statis (meta/JSON-LD/disclaimer)
- `node scripts/validate_credits.js` — skema ledger + harga + rumus tagihan
- `python scripts/validate_credits_live.py` — uji live hold/settle/refund (butuh kredensial DB; opsional)
- `node scripts/validate_ai.js` — proxy AI + debit (statis; live mock bila ada kredensial)
- `node scripts/validate_auth.js` — klien auth (hash/code redirect, refresh, rute masuk, precache)
- `node tests/auth_unit.js` — unit test auth (parse, sesi, refresh, sign out)
- `node scripts/validate_topup.js` — top-up Xendit (statis; live mock bila ada kredensial)
- `node scripts/validate_topup_live.mjs` — uji produksi: topup → webhook → saldo bertambah → idempotent
- `node tests/provider_unit.js` — unit test provider LLM (parse JSON, retry, truncation)
- `node tests/stream_unit.js` — unit test streaming (ekstraksi jawaban inkremental, parser SSE)
- `node scripts/validate_security.js` — statis: fungsi sensitif tertutup dari PUBLIC/anon, service_role tidak di klien
- `node scripts/validate_security_live.mjs` — produksi: anon ditolak pada fungsi & tabel sensitif (butuh anon key)
- `node scripts/validate_ai_live.mjs` — uji produksi: streaming token bertahap (butuh kredensial)
- `node scripts/validate_grounded.js` — grounded pipeline + golden set (>=150 item)
- `node scripts/build_golden.js` — bangun golden set; `--check` untuk CI
- `node tests/rank_unit.js` — unit test ranking, snippet, klasifikasi pertanyaan
- `node scripts/build_topics.js` — bangun halaman topik; `--check` untuk CI (deteksi file basi)
- `node tests/ui_harness.js` — render UI (search/answer/drug/interactions/mode AI/saldo)
- `node scripts/validate_rxnorm.js` — pemetaan RxNorm 30 nama
- `node scripts/validate_api.js` — kontrak API production (butuh jaringan)
- `node --check <file>.js` untuk file JS baru

## Aturan

- Nama produk/brand hanya di `web/js/brand.js` (satu tempat).
- Secrets hanya lewat env (GitHub Actions / Cloudflare); `service_role` TIDAK pernah di frontend.
- Harvester menulis via `service_role`; database tulis tidak pernah dari edge.
- Jangan commit file `.env*` atau key.
- Migration baru: tambahkan `supabase/migrations/NNN_*.sql` (jangan edit file lama).
