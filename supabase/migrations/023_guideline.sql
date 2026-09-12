-- Fase L0 — Pedoman klinis lokal (ringkas, hemat storage, akurat).
-- SATU tabel inti + view + RPC. Tidak menyimpan PDF/full-text.
-- Sumber/edisi memakai ulang `fact_sources` (migrasi 017).

create table if not exists public.guideline_recs (
  id bigserial primary key,
  source_id text not null references public.fact_sources(id),
  tier text not null check (tier in ('pnk', 'permenkes', 'profesi', 'regulator', 'epidemiologi')),
  topik text not null,
  ringkasan text not null check (char_length(ringkasan) <= 300),
  kelas text,
  locator text not null,
  url text not null,
  keywords text not null default '',
  search_text text not null default '',
  search_tsv tsvector generated always as (to_tsvector('simple', coalesce(search_text, ''))) stored,
  valid_from date not null default current_date,
  valid_to date,
  verified_by text,
  verified_at timestamptz,
  checksum text,
  created_at timestamptz not null default now(),
  unique (source_id, topik, locator)
);

create index if not exists guideline_recs_tsv_idx on public.guideline_recs using gin (search_tsv);
create index if not exists guideline_recs_topik_idx on public.guideline_recs (topik);

-- View publik: hanya baris yang masih berlaku; join metadata sumber/edisi.
create or replace view public.guideline_recs_public as
select
  g.id, g.tier, g.topik, g.ringkasan, g.kelas, g.locator, g.url,
  g.search_tsv,
  s.nama as sumber, s.edisi, s.berlaku_dari, s.url as sumber_url
  from public.guideline_recs g
  join public.fact_sources s on s.id = g.source_id
 where g.valid_to is null or g.valid_to >= current_date;

-- Pencarian: exact topik > prefix topik > FTS > kemiripan (tanpa LIKE liar).
create or replace function public.fn_guideline_search(
  p_query text,
  p_topik text default null,
  p_limit int default 8
)
returns table (
  id bigint,
  tier text,
  topik text,
  ringkasan text,
  kelas text,
  locator text,
  url text,
  sumber text,
  edisi text,
  berlaku_dari date,
  score real
)
language sql
stable
set search_path = public, extensions
as $$
  with params as (
    select nullif(btrim(coalesce(p_query, '')), '') as raw,
           lower(btrim(coalesce(p_query, ''))) as low,
           nullif(btrim(coalesce(p_topik, '')), '') as topik,
           websearch_to_tsquery('simple', coalesce(p_query, '')) as tsq
  )
  select
    v.id, v.tier, v.topik, v.ringkasan, v.kelas, v.locator, v.url, v.sumber, v.edisi, v.berlaku_dari,
    greatest(
      case when p.topik is not null and lower(v.topik) = lower(p.topik) then 1.0 else 0 end,
      case when p.raw is not null and starts_with(lower(v.topik), p.low) then 0.9 else 0 end,
      case when p.raw is not null then coalesce(ts_rank(v.search_tsv, p.tsq), 0) else 0 end,
      case when p.raw is not null and char_length(p.low) >= 3 then coalesce(similarity(lower(v.ringkasan), p.low), 0) else 0 end
    )::real as score
  from public.guideline_recs_public v, params p
  where
    (p.topik is not null and lower(v.topik) = lower(p.topik))
    or (p.raw is not null and (
      lower(v.topik) = p.low
      or starts_with(lower(v.topik), p.low)
      or v.search_tsv @@ p.tsq
      or (char_length(p.low) >= 3 and lower(v.ringkasan) % p.low)
    ))
  order by score desc, v.topik asc, v.id asc
  limit greatest(1, least(coalesce(p_limit, 8), 50));
$$;

-- Keamanan: tabel dasar tertutup; view & RPC read-only untuk pengguna.
alter table public.guideline_recs enable row level security;
revoke all on table public.guideline_recs from anon, authenticated;
grant select on public.guideline_recs_public to anon, authenticated;

revoke execute on function public.fn_guideline_search(text, text, int) from public;
revoke execute on function public.fn_guideline_search(text, text, int) from anon, authenticated;
grant execute on function public.fn_guideline_search(text, text, int) to anon, authenticated;

notify pgrst, 'reload schema';
