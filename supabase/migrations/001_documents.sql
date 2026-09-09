create type doc_type as enum ('paper','preprint','trial','local');
create type doc_status as enum ('active','withdrawn','removed');

create table documents (
  id              uuid primary key default gen_random_uuid(),
  doc_type        doc_type not null,
  identity_key    text not null,
  work_group      uuid,
  is_preferred    boolean not null default true,
  title           text not null,
  abstract        text,
  authors         jsonb not null default '[]',
  journal         text,
  issn            text,
  year            int,
  published_on    date,
  doi             text,
  url             text,
  external_ids    jsonb not null default '{}',
  keywords        text[] not null default '{}',
  tags_text       text not null default '',
  lang            text not null default 'en',
  oa              jsonb not null default '{}',
  citation_count  int not null default 0,
  meta            jsonb not null default '{}',
  source          text not null,
  search_vector   tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(abstract, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(tags_text, '')), 'C')
  ) stored,
  status          doc_status not null default 'active',
  last_seen_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (doc_type, identity_key)
);

create index documents_search_vector_idx on documents using gin (search_vector);
create index documents_meta_idx on documents using gin (meta jsonb_path_ops);
create index documents_work_group_idx on documents (work_group) where work_group is not null;
create index documents_doi_idx on documents (doi) where doi is not null;
create index documents_source_pub_idx on documents (source, published_on desc) where status = 'active';
create index documents_keywords_idx on documents using gin (keywords);
create index documents_updated_idx on documents (updated_at);
