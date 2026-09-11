-- Fase 1 — Lapisan fakta obat (formulary) + pencarian.
-- Aditif saja: tidak mengubah tabel/migrasi lama. Data mentah masuk `formulary_staging`,
-- hanya baris `reviewed` yang tersaji via view publik. Lihat docs/formulary.md.

-- Ekstensi untuk pencarian fuzzy (Supabase menaruh ekstensi di schema `extensions`).
create extension if not exists pg_trgm with schema extensions;
set search_path = public, extensions, pg_catalog;

-- ---------------------------------------------------------------------------
-- Registri sumber: metadata edisi disimpan SEKALI di sini (hemat storage).
-- ---------------------------------------------------------------------------
create table if not exists public.fact_sources (
  id text primary key,
  nama text not null,
  pengelola text,
  edisi text,
  berlaku_dari date,
  berlaku_sampai date,
  url text,
  lisensi text,
  catatan text,
  checksum text,
  retrieved_at timestamptz default now(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Produk obat + identitas + status Fornas.
-- ---------------------------------------------------------------------------
create table if not exists public.drug_products (
  slug text primary key,
  nama text not null,
  inn text,
  us_name text,
  atc text,
  kelas text,
  rute text,
  bentuk_sediaan text,
  kekuatan text,
  status_fornas boolean not null default false,
  nie text,
  aliases text[] not null default '{}',
  search_text text not null default '',
  search_tsv tsvector generated always as (to_tsvector('simple', coalesce(search_text, ''))) stored,
  source_id text references public.fact_sources(id),
  valid_from date not null default current_date,
  valid_to date,
  reviewed boolean not null default false,
  reviewed_by text,
  reviewed_at timestamptz,
  checksum text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Dosis per populasi/indikasi; monitoring; interaksi; crosswalk ontologi.
-- ---------------------------------------------------------------------------
create table if not exists public.drug_doses (
  id bigserial primary key,
  drug_slug text not null references public.drug_products(slug) on delete cascade,
  populasi text not null default 'umum',
  indikasi text,
  dosis text,
  maks text,
  catatan_ginjal text,
  catatan_hati text,
  source_id text references public.fact_sources(id),
  valid_from date not null default current_date,
  valid_to date,
  reviewed boolean not null default false,
  reviewed_by text,
  reviewed_at timestamptz,
  checksum text
);

create table if not exists public.drug_interactions (
  id bigserial primary key,
  a_slug text not null,
  b_slug text not null,
  severity text not null check (severity in ('tinggi', 'sedang', 'rendah')),
  mekanisme text,
  saran text,
  source_id text references public.fact_sources(id),
  valid_from date not null default current_date,
  valid_to date,
  reviewed boolean not null default false,
  reviewed_by text,
  reviewed_at timestamptz,
  checksum text,
  unique (a_slug, b_slug)
);

create table if not exists public.drug_monitoring (
  id bigserial primary key,
  drug_slug text not null references public.drug_products(slug) on delete cascade,
  parameter text not null,
  kategori text not null default 'umum' check (kategori in ('umum', 'ginjal', 'hati', 'geriatri', 'deprescribing')),
  catatan text,
  source_id text references public.fact_sources(id),
  valid_from date not null default current_date,
  valid_to date,
  reviewed boolean not null default false,
  reviewed_by text,
  reviewed_at timestamptz,
  checksum text
);

create table if not exists public.drug_crosswalk (
  id bigserial primary key,
  inn text not null unique,
  atc text,
  rxnorm text,
  mesh text
);

-- ---------------------------------------------------------------------------
-- Antrean ingest (two-phase) + metadata dataset (versi cache).
-- ---------------------------------------------------------------------------
create table if not exists public.formulary_staging (
  id bigserial primary key,
  kind text not null,
  slug text,
  payload jsonb not null,
  checksum text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_by text,
  reviewed_at timestamptz
);

create table if not exists public.formulary_meta (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);
insert into public.formulary_meta (key, value) values ('dataset_version', '0')
  on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Index: FTS (tsvector) + trigram untuk fuzzy, kolom pencarian lain seperlunya.
-- ---------------------------------------------------------------------------
create index if not exists drug_products_tsv_idx on public.drug_products using gin (search_tsv);
create index if not exists drug_products_nama_trgm_idx on public.drug_products using gin (lower(nama) gin_trgm_ops);
create index if not exists drug_products_search_trgm_idx on public.drug_products using gin (lower(search_text) gin_trgm_ops);
create index if not exists drug_products_atc_idx on public.drug_products (atc);
create index if not exists drug_products_fornas_idx on public.drug_products (status_fornas) where status_fornas;
create index if not exists drug_doses_slug_idx on public.drug_doses (drug_slug);
create index if not exists drug_interactions_pair_idx on public.drug_interactions (a_slug, b_slug);
create index if not exists drug_monitoring_slug_idx on public.drug_monitoring (drug_slug);
create index if not exists formulary_staging_status_idx on public.formulary_staging (status);

-- ---------------------------------------------------------------------------
-- View publik: hanya baris reviewed + masih berlaku. Ini satu-satunya jalur anon.
-- ---------------------------------------------------------------------------
create or replace view public.drug_products_public as
select slug, nama, inn, us_name, atc, kelas, rute, bentuk_sediaan, kekuatan,
       status_fornas, nie, source_id, valid_from, valid_to, reviewed_at
  from public.drug_products
 where reviewed
   and (valid_to is null or valid_to >= current_date);

create or replace view public.drug_doses_public as
select drug_slug, populasi, indikasi, dosis, maks, catatan_ginjal, catatan_hati, source_id
  from public.drug_doses
 where reviewed
   and (valid_to is null or valid_to >= current_date);

create or replace view public.drug_interactions_public as
select a_slug, b_slug, severity, mekanisme, saran, source_id
  from public.drug_interactions
 where reviewed
   and (valid_to is null or valid_to >= current_date);

create or replace view public.drug_monitoring_public as
select drug_slug, parameter, kategori, catatan, source_id
  from public.drug_monitoring
 where reviewed
   and (valid_to is null or valid_to >= current_date);

-- ---------------------------------------------------------------------------
-- RLS + grant: tabel dasar tertutup dari anon/authenticated; hanya view yang dibaca.
-- Penulisan hanya via service_role (harvester/CI).
-- ---------------------------------------------------------------------------
alter table public.fact_sources enable row level security;
alter table public.drug_products enable row level security;
alter table public.drug_doses enable row level security;
alter table public.drug_interactions enable row level security;
alter table public.drug_monitoring enable row level security;
alter table public.drug_crosswalk enable row level security;
alter table public.formulary_staging enable row level security;
alter table public.formulary_meta enable row level security;

revoke all on table public.fact_sources, public.drug_products, public.drug_doses,
  public.drug_interactions, public.drug_monitoring, public.drug_crosswalk,
  public.formulary_staging, public.formulary_meta
  from anon, authenticated;

grant select on public.drug_products_public, public.drug_doses_public,
  public.drug_interactions_public, public.drug_monitoring_public
  to anon, authenticated;

-- Pastikan tabel BARU tidak otomatis terbuka untuk anon.
alter default privileges in schema public revoke all on tables from anon;

-- Segarkan skema PostgREST agar view langsung tersedia.
notify pgrst, 'reload schema';
