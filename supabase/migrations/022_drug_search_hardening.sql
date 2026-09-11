-- Fase 4 (perbaikan review): amankan `fn_drug_search` + optimalkan trigram.
-- - Prefix pakai `starts_with()` (bukan LIKE) agar `%`/`_` dari input tak jadi wildcard.
-- - Fuzzy pakai operator `%` (index-able) dengan index trigram pada `lower(inn)`
--   agar tidak memaksa seq-scan lewat `similarity(...) > threshold`.

set search_path = public, extensions, pg_catalog;

create index if not exists drug_products_inn_trgm_idx
  on public.drug_products using gin (lower(inn) gin_trgm_ops);

create or replace function public.fn_drug_search(p_query text, p_limit int default 8)
returns table (
  slug text,
  nama text,
  inn text,
  atc text,
  kelas text,
  rute text,
  bentuk_sediaan text,
  kekuatan text,
  status_fornas boolean,
  source_tier text,
  score real
)
language sql
stable
set search_path = public, extensions
as $$
  with params as (
    select nullif(btrim(coalesce(p_query, '')), '') as raw,
           lower(btrim(coalesce(p_query, ''))) as low,
           websearch_to_tsquery('simple', coalesce(p_query, '')) as tsq
  )
  select
    v.slug, v.nama, v.inn, v.atc, v.kelas, v.rute, v.bentuk_sediaan, v.kekuatan, v.status_fornas, v.source_tier,
    greatest(
      case when lower(v.nama) = p.low then 1.0 else 0 end,
      case when lower(coalesce(v.inn, '')) = p.low then 0.99 else 0 end,
      case when starts_with(lower(v.nama), p.low) then 0.8 else 0 end,
      case when starts_with(lower(coalesce(v.inn, '')), p.low) then 0.79 else 0 end,
      coalesce(ts_rank(v.search_tsv, p.tsq), 0),
      coalesce(similarity(lower(v.nama), p.low), 0),
      coalesce(similarity(lower(coalesce(v.inn, '')), p.low), 0)
    )::real as score
  from public.drug_products_public v, params p
  where p.raw is not null
    and (
      lower(v.nama) = p.low
      or lower(coalesce(v.inn, '')) = p.low
      or starts_with(lower(v.nama), p.low)
      or starts_with(lower(coalesce(v.inn, '')), p.low)
      or v.search_tsv @@ p.tsq
      or lower(v.nama) % p.low
      or lower(coalesce(v.inn, '')) % p.low
    )
  order by score desc, v.nama asc
  limit greatest(1, least(coalesce(p_limit, 8), 50));
$$;

revoke execute on function public.fn_drug_search(text, int) from public;
revoke execute on function public.fn_drug_search(text, int) from anon, authenticated;
grant execute on function public.fn_drug_search(text, int) to anon, authenticated;

notify pgrst, 'reload schema';
