create table term_map (
  id_term  text primary key,
  en_terms text not null,
  kind     text not null default 'mesh'
);

insert into term_map (id_term, en_terms, kind) values
  ('diabetes', 'diabetes OR diabetes mellitus OR type 2 diabetes', 'disease'),
  ('kanker paru', 'lung cancer OR lung neoplasms OR nonsmall cell lung cancer', 'disease'),
  ('kanker payudara', 'breast cancer OR breast neoplasms', 'disease'),
  ('tuberkulosis', 'tuberculosis OR TB OR mycobacterium tuberculosis', 'disease'),
  ('demam berdarah', 'dengue OR dengue fever OR dengue hemorrhagic fever', 'disease'),
  ('stunting', 'stunting OR child growth disorders OR malnutrition', 'disease'),
  ('malaria', 'malaria OR plasmodium', 'disease'),
  ('hipertensi', 'hypertension OR high blood pressure OR blood pressure', 'disease'),
  ('stroke', 'stroke OR cerebrovascular accident OR cerebral infarction', 'disease'),
  ('hiv', 'hiv OR human immunodeficiency virus', 'disease'),
  ('imunisasi', 'immunization OR vaccination OR vaccines', 'intervention'),
  ('obat', 'drug OR medication OR pharmaceutical', 'intervention'),
  ('vaksin', 'vaccine OR vaccination', 'intervention'),
  ('kehamilan', 'pregnancy OR antenatal OR maternal', 'disease'),
  ('asi', 'breastfeeding OR breast milk OR lactation', 'intervention'),
  ('anemia', 'anemia OR anaemia OR iron deficiency', 'disease');

create or replace function fn_bioxip_search(
  p_query      text,
  p_types      text[] default null,
  p_year_min   int default null,
  p_year_max   int default null,
  p_oa         boolean default false,
  p_indonesia  boolean default false,
  p_sort       text default 'relevance',
  p_limit      int default 20,
  p_offset     int default 0
) returns jsonb
language plpgsql stable
as $$
declare
  v_map text := '';
  v_row record;
  v_qtext text;
  v_tsq tsquery;
  v_where text := 'd.status = ''active''';
  v_score text;
  v_order text;
  v_total bigint;
  v_results jsonb;
begin
  for v_row in
    select en_terms from term_map
    where p_query ilike '%' || id_term || '%'
    group by en_terms
  loop
    v_map := v_map || ' OR ' || v_row.en_terms;
  end loop;

  v_qtext := trim(p_query || v_map);
  if v_map = '' then
    v_qtext := p_query;
  end if;

  begin
    v_tsq := websearch_to_tsquery('english', v_qtext);
  exception when others then
    v_tsq := plainto_tsquery('english', p_query);
  end;
  if v_tsq is null then
    v_tsq := plainto_tsquery('english', p_query);
  end if;

  if p_types is not null and cardinality(p_types) > 0 then
    v_where := v_where || format(' and d.doc_type = any(%L::doc_type[])', p_types);
  end if;
  if p_year_min is not null then
    v_where := v_where || format(' and coalesce(d.year, date_part(''year'', d.published_on)::int) >= %s', p_year_min);
  end if;
  if p_year_max is not null then
    v_where := v_where || format(' and coalesce(d.year, date_part(''year'', d.published_on)::int) <= %s', p_year_max);
  end if;
  if p_oa then
    v_where := v_where || ' and coalesce((d.oa->>''is_oa'')::boolean, false) = true';
  end if;
  if p_indonesia then
    v_where := v_where || ' and coalesce((d.meta->>''indonesia'')::boolean, false) = true';
  end if;

  v_score := format(
    '0.48 * ts_rank_cd(d.search_vector, %L::tsquery) +
     0.20 * greatest(0, 1 - extract(epoch from (now() - coalesce(d.published_on, d.created_at::date))) / (10 * 365.25 * 86400)) +
     0.16 * (case d.doc_type when ''paper'' then 1.0 when ''trial'' then 0.88 when ''preprint'' then 0.66 else 0.6 end) +
     0.10 * least(1.0, ln(d.citation_count + 1) / 6.0) +
     0.06 * (case when coalesce((d.oa->>''is_oa'')::boolean, false) then 1.0 else 0.0 end)',
    v_tsq::text);

  case p_sort
    when 'date' then v_order := 'published_on desc nulls last';
    when 'citations' then v_order := 'citation_count desc';
    else v_order := 'score desc';
  end case;

  execute format(
    'select count(*) from (
       select 1 from (
         select row_number() over (
                  partition by coalesce(d.work_group, d.id)
                  order by d.is_preferred desc, %s desc
                ) as rn
         from documents d
         where %s
       ) q
       where rn = 1
     ) t', v_score, v_where) into v_total;

  execute format(
    'select coalesce(jsonb_agg(j), ''[]''::jsonb) from (
       select to_jsonb(p) as j from (
         select * from (
           select d.id, d.doc_type, d.title, d.abstract, d.authors, d.journal,
                  d.issn, d.year, d.published_on, d.doi, d.url, d.external_ids,
                  d.keywords, d.lang, d.oa, d.citation_count, d.meta, d.source,
                  d.is_preferred, %s as score,
                  row_number() over (
                    partition by coalesce(d.work_group, d.id)
                    order by d.is_preferred desc, %s desc
                  ) as rn
           from documents d
           where %s
         ) ranked
         where rn = 1
         order by %s
         limit %s offset %s
       ) p
     ) jt',
    v_score, v_score, v_where, v_order, p_limit, p_offset) into v_results;

  return jsonb_build_object(
    'query', p_query,
    'total', coalesce(v_total, 0),
    'limit', p_limit,
    'offset', p_offset,
    'results', coalesce(v_results, '[]'::jsonb)
  );
end;
$$;
