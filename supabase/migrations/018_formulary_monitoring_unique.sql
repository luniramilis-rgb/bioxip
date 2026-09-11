-- Fase 2: constraint unik untuk idempotensi ingest monitoring.
-- `ON CONFLICT (drug_slug, kategori, parameter)` (dipakai harvester) memerlukan
-- unique index; migrasi 017 hanya membuat index non-unik pada drug_slug.

create unique index if not exists drug_monitoring_unique_key
  on public.drug_monitoring (drug_slug, kategori, parameter);

notify pgrst, 'reload schema';
