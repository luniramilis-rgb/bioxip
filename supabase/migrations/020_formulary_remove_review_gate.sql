-- Keputusan produk (2026-09-11): hapus gate review manusia dari pipeline formulary.
-- Publikasi dipandu VALIDASI OTOMATIS + provenance, bukan `reviewed`.
-- Kolom `reviewed*` tetap ada (kompatibilitas) tetapi tidak lagi menjadi filter view.

-- Tingkat kepercayaan sumber (bukan penilaian manusia).
alter table public.drug_products add column if not exists source_tier text not null default 'official';
alter table public.drug_products add column if not exists retrieved_at timestamptz not null default now();
alter table public.drug_doses add column if not exists source_tier text not null default 'curated';
alter table public.drug_doses add column if not exists retrieved_at timestamptz not null default now();
alter table public.drug_interactions add column if not exists source_tier text not null default 'curated';
alter table public.drug_interactions add column if not exists retrieved_at timestamptz not null default now();
alter table public.drug_monitoring add column if not exists source_tier text not null default 'curated';
alter table public.drug_monitoring add column if not exists retrieved_at timestamptz not null default now();

-- View publik: semua baris yang masih berlaku (tanpa gate `reviewed`).
drop view if exists public.drug_products_public;
create view public.drug_products_public as
select slug, nama, inn, us_name, atc, kelas, rute, bentuk_sediaan, kekuatan,
       status_fornas, nie, source_id, source_tier, retrieved_at, valid_from, valid_to
  from public.drug_products
 where valid_to is null or valid_to >= current_date;

drop view if exists public.drug_doses_public;
create view public.drug_doses_public as
select drug_slug, populasi, indikasi, dosis, maks, catatan_ginjal, catatan_hati, source_id, source_tier
  from public.drug_doses
 where valid_to is null or valid_to >= current_date;

drop view if exists public.drug_interactions_public;
create view public.drug_interactions_public as
select a_slug, b_slug, severity, mekanisme, saran, source_id, source_tier
  from public.drug_interactions
 where valid_to is null or valid_to >= current_date;

drop view if exists public.drug_monitoring_public;
create view public.drug_monitoring_public as
select drug_slug, parameter, kategori, catatan, source_id, source_tier
  from public.drug_monitoring
 where valid_to is null or valid_to >= current_date;

grant select on public.drug_products_public, public.drug_doses_public,
  public.drug_interactions_public, public.drug_monitoring_public
  to anon, authenticated;

notify pgrst, 'reload schema';
