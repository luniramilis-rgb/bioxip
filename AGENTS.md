# AGENTS.md

Repo bioXip. Baca `docs/blueprint.md` sebelum mengubah arsitektur.

## Komando

- Harvester (lokal): `python -m harvester.runners.harvest_delta --provider europepmc`
- Syntax check tanpa deps: `python -m compileall harvester tests scripts`
- Test: `python -m pytest` (di lingkungan dengan deps terpasang)
- Migrasi: `supabase db push` (perlu Supabase CLI)

## Aturan

- Nama produk/brand hanya di `web/js/brand.js` (satu tempat).
- Secrets hanya lewat env (GitHub Actions / Cloudflare); `service_role` TIDAK pernah di frontend.
- Harvester menulis via `service_role`; database tulis tidak pernah dari edge.
- Jangan commit file `.env*` atau key.
- Migration baru: tambahkan `supabase/migrations/NNN_*.sql` (jangan edit file lama).
