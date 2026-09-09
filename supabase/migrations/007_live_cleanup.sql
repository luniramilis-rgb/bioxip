drop view if exists public.source_stats;
drop view if exists public.latest_harvest_runs;
drop table if exists documents cascade;
drop table if exists term_map cascade;
drop table if exists harvest_runs cascade;
drop table if exists provider_cursor cascade;
drop function if exists public.fn_bioxip_search(text, text[], int, int, boolean, boolean, text, int, int);
