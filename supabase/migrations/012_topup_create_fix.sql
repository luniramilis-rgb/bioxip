-- Perbaikan: parameter OUT bernama `status` bentrok dengan kolom topups.status
-- (error: column reference "status" is ambiguous). Ganti nama OUT + kualifikasi kolom.
-- create or replace tidak dapat mengubah return type → drop dulu.

drop function if exists fn_topup_create(bigint, text);

create function fn_topup_create(
  p_amount_idr bigint,
  p_channel text default 'QRIS'
) returns table (
  topup_id uuid,
  external_id text,
  amount_idr bigint,
  credited_idr bigint,
  channel text,
  topup_status text,
  payment_url text,
  expires_at timestamptz
)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_existing topups;
  v_id uuid := gen_random_uuid();
  v_external text;
  v_channel text := upper(coalesce(nullif(trim(p_channel), ''), 'QRIS'));
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if p_amount_idr not in (50000, 100000, 150000, 500000) then
    raise exception 'invalid_amount';
  end if;
  if v_channel not in ('QRIS', 'VA', 'EWALLET') then
    raise exception 'invalid_channel';
  end if;

  select t.* into v_existing
    from topups t
   where t.user_id = v_uid
     and t.status = 'pending'
     and t.amount_idr = p_amount_idr
     and t.expires_at > now()
   order by t.created_at desc
   limit 1;

  if v_existing.id is not null then
    return query
      select v_existing.id, v_existing.external_id, v_existing.amount_idr,
             v_existing.credited_idr, v_existing.channel, v_existing.status::text,
             v_existing.payment_url, v_existing.expires_at;
    return;
  end if;

  v_external := 'bioxip-' || v_id::text;

  insert into topups (
    id, user_id, provider, amount_idr, credited_idr, status,
    idempotency_key, channel, external_id, expires_at, payment_url
  ) values (
    v_id, v_uid, 'xendit', p_amount_idr, p_amount_idr, 'pending',
    'topup:' || v_id::text, v_channel, v_external, now() + interval '30 minutes', null
  );

  return query
    select t.id, t.external_id, t.amount_idr, t.credited_idr, t.channel,
           t.status::text, t.payment_url, t.expires_at
      from topups t
     where t.id = v_id;
end $$;

grant execute on function fn_topup_create(bigint, text) to authenticated;

-- Segarkan cache skema PostgREST agar tanda tangan fungsi terbaru terlihat.
notify pgrst, 'reload schema';
