-- Logging pemakaian AI dari edge (tanpa service_role): SECURITY DEFINER + auth.uid().

create or replace function fn_ai_log_usage(
  p_request_id uuid,
  p_feature text,
  p_provider text,
  p_model text,
  p_input_tokens int,
  p_output_tokens int,
  p_cost_micro_idr bigint,
  p_charged_micro_idr bigint,
  p_status text default 'ok'
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id bigint;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  insert into ai_usage_log (
    user_id, request_id, feature, provider, model,
    input_tokens, output_tokens, cost_micro_idr, charged_micro_idr, status
  ) values (
    v_uid, p_request_id, p_feature, coalesce(p_provider, 'mock'), coalesce(p_model, 'mock'),
    coalesce(p_input_tokens, 0), coalesce(p_output_tokens, 0),
    coalesce(p_cost_micro_idr, 0), coalesce(p_charged_micro_idr, 0), coalesce(p_status, 'ok')
  ) returning id into v_id;
  return v_id;
end $$;

create or replace function fn_ai_log_chat(
  p_request_id uuid,
  p_feature text,
  p_messages jsonb,
  p_answer text,
  p_citations jsonb
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id bigint;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  insert into ai_chat_log (user_id, request_id, feature, messages, answer, citations)
  values (v_uid, p_request_id, p_feature, coalesce(p_messages, '[]'::jsonb), p_answer, coalesce(p_citations, '[]'::jsonb))
  returning id into v_id;
  return v_id;
end $$;

create or replace function fn_usage_limit_for(p_user_id uuid)
returns table(plan text, rpm int)
language sql security definer set search_path = public as $$
  select coalesce(l.plan, 'free'), coalesce(l.rpm, 6)
  from (select 1) x
  left join usage_limits l on l.user_id = p_user_id;
$$;

grant execute on function fn_ai_log_usage(uuid, text, text, text, int, int, bigint, bigint, text) to authenticated;
grant execute on function fn_ai_log_chat(uuid, text, jsonb, text, jsonb) to authenticated;
grant execute on function fn_usage_limit_for(uuid) to authenticated;
