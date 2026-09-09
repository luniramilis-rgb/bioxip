create or replace view public.source_stats as
select
  source,
  doc_type,
  count(*)                        as total,
  count(*) filter (where status = 'active') as active,
  max(updated_at)                 as last_updated
from documents
group by source, doc_type;

grant select on public.source_stats to anon, authenticated;

create or replace view public.latest_harvest_runs as
select distinct on (provider) provider, kind, status, started_at, finished_at,
       fetched, inserted, updated
from harvest_runs
order by provider, started_at desc;

grant select on public.latest_harvest_runs to anon, authenticated;
