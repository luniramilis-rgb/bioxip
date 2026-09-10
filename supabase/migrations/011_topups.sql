-- Sprint 7: top-up via Xendit. Kolom tambahan + RPC pembuatan/pengambilan topup (SECURITY DEFINER).
-- Kredit hanya masuk lewat webhook (service_role), tidak pernah dari sisi klien.

alter table topups add column if not exists channel text;
alter table topups add column if not exists external_id text unique;
alter table topups add column if not exists payment_url text;
alter table topups add column if not exists expires_at timestamptz;
alter table topups add column if not exists raw jsonb not null default '{}';

create index if not exists topups_external_idx on topups (external_id);

-- Buat (atau ambil, bila sudah ada) satu topup pending untuk paket tertentu.
create or replace function fn_topup_create(
  p_amount_idr bigint,
  p_channel text default 'QRIS'
) returns table (
  topup_id uuid,
  external_id text,
  amount_idr bigint,
  credited_idr bigint,
  channel text,
  status text,
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

  select * into v_existing from topups
   where user_id = v_uid and status = 'pending' and amount_idr = p_amount_idr
     and expires_at > now()
   order by created_at desc limit 1;
  if v_existing.id is not null then
    return query select v_existing.id, v_existing.external_id, v_existing.amount_idr,
                        v_existing.credited_idr, v_existing.channel, v_existing.status,
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

  return query select t.id, t.external_id, t.amount_idr, t.credited_idr, t.channel,
                      t.status, t.payment_url, t.expires_at
                 from topups t where t.id = v_id;
end $$;

-- Ambil detail topup milik sendiri (untuk halaman menunggu pembayaran).
create or replace function fn_topup_get(p_topup_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row topups;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select * into v_row from topups where id = p_topup_id and user_id = v_uid;
  if v_row.id is null then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object(
    'found', true,
    'topup_id', v_row.id,
    'external_id', v_row.external_id,
    'amount_idr', v_row.amount_idr,
    'credited_idr', v_row.credited_idr,
    'channel', v_row.channel,
    'status', v_row.status,
    'payment_url', v_row.payment_url,
    'expires_at', v_row.expires_at,
    'paid_at', v_row.paid_at
  );
end $$;

grant execute on function fn_topup_create(bigint, text) to authenticated;
grant execute on function fn_topup_get(uuid) to authenticated;

-- Catat kanal pembayaran yang dikembalikan provider (dipanggil edge dengan JWT pengguna).
create or replace function fn_topup_attach(
  p_topup_id uuid,
  p_payment_url text,
  p_expires_at timestamptz,
  p_raw jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  update topups
     set payment_url = coalesce(p_payment_url, payment_url),
         expires_at = coalesce(p_expires_at, expires_at),
         raw = coalesce(p_raw, raw)
   where id = p_topup_id and user_id = v_uid and status = 'pending';
end $$;

grant execute on function fn_topup_attach(uuid, text, timestamptz, jsonb) to authenticated;

-- Webhook (service_role): tandai topup dibayar & kreditkan saldo. Idempotent.
create or replace function fn_topup_mark_paid(
  p_external_id text,
  p_status text,
  p_paid_at timestamptz,
  p_raw jsonb
) returns table (applied boolean, already_paid boolean, credited_idr bigint, topup_status text)
language plpgsql security definer set search_path = public as $$
declare
  v_row topups;
  v_status text := upper(coalesce(p_status, ''));
begin
  select * into v_row from topups where external_id = p_external_id for update;
  if v_row.id is null then
    return query select false, false, 0::bigint, 'not_found'::text;
    return;
  end if;

  if v_row.status = 'paid' then
    return query select false, true, 0::bigint, 'paid'::text;
    return;
  end if;

  if v_status not in ('SUCCEEDED', 'PAID', 'SETTLED', 'COMPLETED') then
    update topups
       set status = case
             when v_status in ('EXPIRED') then 'expired'
             when v_status in ('FAILED', 'CANCELLED') then 'failed'
             else status
           end,
           raw = coalesce(p_raw, raw)
     where id = v_row.id;
    return query select false, false, 0::bigint,
      (select status from topups where id = v_row.id);
    return;
  end if;

  insert into credit_ledger (user_id, delta_micro_idr, reason, ref_id, idempotency_key, meta)
  values (
    v_row.user_id,
    v_row.credited_idr * 1000000,
    'topup',
    v_row.external_id,
    'topup-paid:' || v_row.external_id,
    jsonb_build_object('provider', 'xendit', 'channel', v_row.channel, 'amount_idr', v_row.amount_idr)
  );

  update topups
     set status = 'paid',
         paid_at = coalesce(p_paid_at, now()),
         raw = coalesce(p_raw, raw)
   where id = v_row.id;

  return query select true, false, v_row.credited_idr, 'paid'::text;
end $$;

-- Hanya service_role (webhook) yang boleh memanggil; user tidak.
revoke execute on function fn_topup_mark_paid(text, text, timestamptz, jsonb) from anon, authenticated;

