# bioXip

Literatur medis dunia, untuk peneliti Indonesia.

bioXip adalah mesin pencari literatur biomedis yang mengindex publikasi internasional
(Europe PMC: PubMed + preprint; ClinicalTrials.gov) dan menautkan ke versi open-access
lokal Indonesia. UI default Bahasa Indonesia.

Lihat `docs/blueprint.md` untuk arsitektur lengkap dan log keputusan.

## Struktur

- `web/` — frontend statis (deploy Cloudflare Pages)
- `functions/` — Cloudflare Pages Functions (edge API)
- `supabase/migrations/` — schema Postgres (Supabase)
- `harvester/` — pipeline Python offline (GitHub Actions)
- `.github/workflows/` — deploy + harvest + housekeeping
