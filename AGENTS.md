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
- `node scripts/build_topics.js` — bangun halaman topik; `--check` untuk CI (deteksi file basi)
- `node tests/ui_harness.js` — render UI (search/answer/drug/interactions)
- `node scripts/validate_rxnorm.js` — pemetaan RxNorm 30 nama
- `node scripts/validate_api.js` — kontrak API production (butuh jaringan)
- `node --check <file>.js` untuk file JS baru

## Aturan

- Nama produk/brand hanya di `web/js/brand.js` (satu tempat).
- Secrets hanya lewat env (GitHub Actions / Cloudflare); `service_role` TIDAK pernah di frontend.
- Harvester menulis via `service_role`; database tulis tidak pernah dari edge.
- Jangan commit file `.env*` atau key.
- Migration baru: tambahkan `supabase/migrations/NNN_*.sql` (jangan edit file lama).
