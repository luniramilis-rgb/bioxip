-- Cache jawaban AI (L2) di Postgres: andal lintas-colo, dipakai bila Cache API (L1) meleset.
-- Hanya ditulis/dibaca oleh edge memakai service_role; tidak ada akses anon.

create table if not exists answer_cache (
  query_hash text primary key,
  query_text text not null,
  payload    jsonb not null default '{}',
  model      text,
  hits       int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists answer_cache_expires_idx on answer_cache (expires_at);

alter table answer_cache enable row level security;
-- Sengaja tanpa policy: anon/authenticated tidak boleh membaca cache jawaban.

create or replace function fn_answer_cache_hit(p_query_hash text)
returns void
language sql security definer set search_path = public as $$
  update answer_cache set hits = hits + 1 where query_hash = p_query_hash;
$$;

revoke execute on function fn_answer_cache_hit(text) from anon, authenticated;
grant execute on function fn_answer_cache_hit(text) to service_role;
