create table harvest_runs (
  id          bigserial primary key,
  provider    text not null,
  kind        text not null,
  watermark   timestamptz,
  fetched     int not null default 0,
  inserted    int not null default 0,
  updated     int not null default 0,
  removed     int not null default 0,
  status      text not null default 'running',
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  log         jsonb not null default '{}'
);

create table provider_cursor (
  provider        text primary key,
  last_delta_at   timestamptz,
  last_full_at    timestamptz
);

create table live_cache (
  namespace  text not null,
  query_hash text not null,
  payload    jsonb not null default '{}',
  expires_at timestamptz not null,
  primary key (namespace, query_hash)
);

create table search_cache (
  query_hash text primary key,
  query_text text not null,
  filters    jsonb not null default '{}',
  response   jsonb not null default '{}',
  expires_at timestamptz not null
);

create table search_logs (
  id           bigserial primary key,
  q            text not null,
  filters      jsonb not null default '{}',
  user_key     text,
  result_count int not null default 0,
  ms           int not null default 0,
  created_at   timestamptz not null default now()
);

create table usage_quota (
  user_key text not null,
  day      date not null,
  calls    int not null default 0,
  primary key (user_key, day)
);

create index harvest_runs_started_idx on harvest_runs (started_at desc);
create index search_logs_created_idx on search_logs (created_at desc);

alter table harvest_runs enable row level security;
alter table provider_cursor enable row level security;
alter table live_cache enable row level security;
alter table search_cache enable row level security;
alter table search_logs enable row level security;
alter table usage_quota enable row level security;

revoke all on table harvest_runs, provider_cursor, live_cache, search_cache, search_logs, usage_quota from anon, authenticated;

