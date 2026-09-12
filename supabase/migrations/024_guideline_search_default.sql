-- L0 (perbaikan): `p_query` diberi default agar pencarian bisa dipanggil hanya
-- dengan `p_topik` (mis. `fn_guideline_search(p_topik => 'tb')`).
-- Aditif: `create or replace` (migrasi 023 sudah diterapkan; jangan diedit).

create or replace function public.fn_guideline_search(
  p_query text default null,
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

revoke execute on function public.fn_guideline_search(text, text, int) from public;
revoke execute on function public.fn_guideline_search(text, text, int) from anon, authenticated;
grant execute on function public.fn_guideline_search(text, text, int) to anon, authenticated;

notify pgrst, 'reload schema';
