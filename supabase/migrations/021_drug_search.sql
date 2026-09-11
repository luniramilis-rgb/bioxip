-- Fase 4 — Pencarian obat (FTS + trigram) untuk /api/suggest & /api/drug.
-- Catatan: rencana menyebut `018_drug_search.sql`, tetapi 018-020 sudah terpakai,
-- sehingga memakai nomor 021. Aditif; gate review sudah dihapus (020).

-- Tambahkan kolom pencarian ke view publik agar index GIN `search_tsv` dipakai.
drop view if exists public.drug_products_public;
create view public.drug_products_public as
select slug, nama, inn, us_name, atc, kelas, rute, bentuk_sediaan, kekuatan,
       status_fornas, nie, source_id, source_tier, retrieved_at, valid_from, valid_to, search_tsv
  from public.drug_products
 where valid_to is null or valid_to >= current_date;

grant select on public.drug_products_public to anon, authenticated;

-- Pencarian berperingkat: exact nama/INN > prefix > FTS > kemiripan trigram.
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
      case when lower(v.nama) like p.low || '%' then 0.8 else 0 end,
      case when lower(coalesce(v.inn, '')) like p.low || '%' then 0.79 else 0 end,
      coalesce(ts_rank(v.search_tsv, p.tsq), 0),
      coalesce(similarity(lower(v.nama), p.low), 0),
      coalesce(similarity(lower(coalesce(v.inn, '')), p.low), 0)
    )::real as score
  from public.drug_products_public v, params p
  where p.raw is not null
    and (
      lower(v.nama) = p.low
      or lower(coalesce(v.inn, '')) = p.low
      or lower(v.nama) like p.low || '%'
      or lower(coalesce(v.inn, '')) like p.low || '%'
      or v.search_tsv @@ p.tsq
      or similarity(lower(v.nama), p.low) > 0.25
      or similarity(lower(coalesce(v.inn, '')), p.low) > 0.25
    )
  order by score desc, v.nama asc
  limit greatest(1, least(coalesce(p_limit, 8), 50));
$$;

-- Baca-saja untuk klien; cabut dari PUBLIC lalu beri ke anon/authenticated.
revoke execute on function public.fn_drug_search(text, int) from public;
revoke execute on function public.fn_drug_search(text, int) from anon, authenticated;
grant execute on function public.fn_drug_search(text, int) to anon, authenticated;

notify pgrst, 'reload schema';
