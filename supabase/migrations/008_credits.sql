-- Sprint 3: ledger saldo (append-only), operasi hold/settle/refund, top-up, log AI.
-- Semua nilai uang dalam micro-IDR (1 Rp = 1.000.000 micro).
-- Penulisan hanya melalui fungsi SECURITY DEFINER; RLS hanya memberi baca milik sendiri.

create table credit_accounts (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  balance_micro_idr bigint not null default 0 check (balance_micro_idr >= 0),
  plan              text not null default 'free' check (plan in ('free','paid','institution')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table credit_ledger (
  id              bigserial primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  delta_micro_idr bigint not null check (delta_micro_idr <> 0),
  reason          text not null check (reason in ('topup','usage','refund','bonus','adjustment')),
  ref_id          text,
  idempotency_key text,
  meta            jsonb not null default '{}',
  created_at      timestamptz not null default now()
);
create unique index credit_ledger_idem_idx on credit_ledger (idempotency_key) where idempotency_key is not null;
create index credit_ledger_user_idx on credit_ledger (user_id, created_at desc);

create table credit_operations (
  request_id       uuid primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  hold_micro_idr   bigint not null check (hold_micro_idr > 0),
  charged_micro_idr bigint,
  state            text not null default 'held' check (state in ('held','settled','refunded')),
  created_at       timestamptz not null default now(),
  closed_at        timestamptz
);
create index credit_operations_user_idx on credit_operations (user_id, created_at desc);

create table topups (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  provider        text not null default 'xendit',
  provider_ref    text,
  amount_idr      bigint not null check (amount_idr > 0),
  credited_idr    bigint not null check (credited_idr > 0),
  status          text not null default 'pending' check (status in ('pending','paid','expired','failed','refunded')),
  idempotency_key text unique,
  created_at      timestamptz not null default now(),
  paid_at         timestamptz
);
create index topups_user_idx on topups (user_id, created_at desc);

create table ai_usage_log (
  id                bigserial primary key,
  user_id           uuid not null references auth.users(id) on delete cascade,
  request_id        uuid not null,
  feature           text not null,
  provider          text not null default 'deepseek',
  model             text not null,
  input_tokens      int not null default 0,
  output_tokens     int not null default 0,
  cost_micro_idr    bigint not null default 0,
  charged_micro_idr bigint not null default 0,
  margin_micro_idr  bigint generated always as (charged_micro_idr - cost_micro_idr) stored,
  status            text not null default 'ok' check (status in ('ok','refunded','error')),
  created_at        timestamptz not null default now()
);
create index ai_usage_user_idx on ai_usage_log (user_id, created_at desc);

create table ai_chat_log (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  feature    text not null,
  messages   jsonb not null default '[]',
  answer     text,
  citations  jsonb not null default '[]',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days')
);
create index ai_chat_log_user_idx on ai_chat_log (user_id, created_at desc);

create table usage_limits (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  plan       text not null default 'free',
  rpm        int not null default 6,
  updated_at timestamptz not null default now()
);

-- Saldo adalah cache dari ledger; setiap baris ledger menggerakkan saldo.
create or replace function fn_apply_ledger_delta() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into credit_accounts (user_id, balance_micro_idr)
  values (new.user_id, new.delta_micro_idr)
  on conflict (user_id) do update
    set balance_micro_idr = credit_accounts.balance_micro_idr + new.delta_micro_idr,
        updated_at = now();
  return new;
end $$;

create trigger trg_credit_ledger_apply
after insert on credit_ledger
for each row execute function fn_apply_ledger_delta();

-- Pastikan baris akun ada untuk pengguna yang sedang login.
create or replace function fn_credit_ensure_account() returns bigint
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_balance bigint;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  insert into credit_accounts (user_id) values (v_uid) on conflict (user_id) do nothing;
  select balance_micro_idr into v_balance from credit_accounts where user_id = v_uid;
  return v_balance;
end $$;

-- Hold: potong saldo di depan sebelum memanggil provider.
create or replace function fn_credit_hold(p_request_id uuid, p_amount_micro_idr bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_balance bigint;
  v_key text := p_request_id::text || ':hold';
  v_existing text;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if p_amount_micro_idr <= 0 then raise exception 'amount_must_be_positive'; end if;

  select state into v_existing from credit_operations where request_id = p_request_id and user_id = v_uid;
  if v_existing is not null then
    select balance_micro_idr into v_balance from credit_accounts where user_id = v_uid;
    return v_balance;
  end if;

  perform fn_credit_ensure_account();
  select balance_micro_idr into v_balance from credit_accounts where user_id = v_uid for update;
  if v_balance < p_amount_micro_idr then
    raise exception 'insufficient_balance';
  end if;

  insert into credit_ledger (user_id, delta_micro_idr, reason, ref_id, idempotency_key, meta)
  values (v_uid, -p_amount_micro_idr, 'usage', p_request_id::text, v_key,
          jsonb_build_object('state', 'hold'));
  insert into credit_operations (request_id, user_id, hold_micro_idr, state)
  values (p_request_id, v_uid, p_amount_micro_idr, 'held');

  select balance_micro_idr into v_balance from credit_accounts where user_id = v_uid;
  return v_balance;
end $$;

-- Settle: sesuaikan dengan tagihan nyata; selisih dikembalikan (refund).
create or replace function fn_credit_settle(p_request_id uuid, p_charged_micro_idr bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_op credit_operations;
  v_refund bigint;
  v_balance bigint;
  v_key text := p_request_id::text || ':settle';
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if p_charged_micro_idr < 0 then raise exception 'charged_must_be_non_negative'; end if;

  select * into v_op from credit_operations
   where request_id = p_request_id and user_id = v_uid for update;
  if v_op.request_id is null then raise exception 'operation_not_found'; end if;

  if v_op.state = 'settled' then
    select balance_micro_idr into v_balance from credit_accounts where user_id = v_uid;
    return v_balance;
  end if;
  if v_op.state = 'refunded' then raise exception 'operation_already_refunded'; end if;
  if p_charged_micro_idr > v_op.hold_micro_idr then raise exception 'charged_exceeds_hold'; end if;

  v_refund := v_op.hold_micro_idr - p_charged_micro_idr;
  if v_refund > 0 then
    insert into credit_ledger (user_id, delta_micro_idr, reason, ref_id, idempotency_key, meta)
    values (v_uid, v_refund, 'refund', p_request_id::text, v_key,
            jsonb_build_object('state', 'settle'));
  end if;

  update credit_operations
     set state = 'settled', charged_micro_idr = p_charged_micro_idr, closed_at = now()
   where request_id = p_request_id;

  select balance_micro_idr into v_balance from credit_accounts where user_id = v_uid;
  return v_balance;
end $$;

-- Refund penuh: dipakai bila provider gagal sebelum menghasilkan keluaran.
create or replace function fn_credit_refund(p_request_id uuid) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_op credit_operations;
  v_balance bigint;
  v_key text := p_request_id::text || ':refund';
begin
  if v_uid is null then raise exception 'unauthorized'; end if;

  select * into v_op from credit_operations
   where request_id = p_request_id and user_id = v_uid for update;
  if v_op.request_id is null then raise exception 'operation_not_found'; end if;
  if v_op.state = 'refunded' then
    select balance_micro_idr into v_balance from credit_accounts where user_id = v_uid;
    return v_balance;
  end if;
  if v_op.state = 'settled' then raise exception 'operation_already_settled'; end if;

  insert into credit_ledger (user_id, delta_micro_idr, reason, ref_id, idempotency_key, meta)
  values (v_uid, v_op.hold_micro_idr, 'refund', p_request_id::text, v_key,
          jsonb_build_object('state', 'fail'));

  update credit_operations set state = 'refunded', closed_at = now() where request_id = p_request_id;

  select balance_micro_idr into v_balance from credit_accounts where user_id = v_uid;
  return v_balance;
end $$;

-- Hibah saldo (top-up/bonus/adjustment). HANYA untuk service_role (admin/CI/uji).
create or replace function fn_credit_grant(
  p_user_id uuid,
  p_amount_micro_idr bigint,
  p_reason text,
  p_idempotency_key text
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_balance bigint;
begin
  if p_amount_micro_idr = 0 then raise exception 'amount_must_be_non_zero'; end if;
  if p_reason not in ('topup','bonus','adjustment') then raise exception 'invalid_reason'; end if;
  if p_idempotency_key is not null and exists (
    select 1 from credit_ledger where idempotency_key = p_idempotency_key
  ) then
    select balance_micro_idr into v_balance from credit_accounts where user_id = p_user_id;
    return coalesce(v_balance, 0);
  end if;

  insert into credit_accounts (user_id) values (p_user_id) on conflict (user_id) do nothing;
  insert into credit_ledger (user_id, delta_micro_idr, reason, idempotency_key, meta)
  values (p_user_id, p_amount_micro_idr, p_reason, p_idempotency_key,
          jsonb_build_object('source', 'admin'));

  select balance_micro_idr into v_balance from credit_accounts where user_id = p_user_id;
  return v_balance;
end $$;

-- RLS: baca milik sendiri saja.
alter table credit_accounts   enable row level security;
alter table credit_ledger      enable row level security;
alter table credit_operations  enable row level security;
alter table topups             enable row level security;
alter table ai_usage_log       enable row level security;
alter table ai_chat_log        enable row level security;
alter table usage_limits       enable row level security;

create policy credit_accounts_own   on credit_accounts   for select using (auth.uid() = user_id);
create policy credit_ledger_own     on credit_ledger      for select using (auth.uid() = user_id);
create policy credit_operations_own on credit_operations  for select using (auth.uid() = user_id);
create policy topups_own            on topups             for select using (auth.uid() = user_id);
create policy ai_usage_own          on ai_usage_log       for select using (auth.uid() = user_id);
create policy ai_chat_own           on ai_chat_log        for select using (auth.uid() = user_id);
create policy usage_limits_own      on usage_limits       for select using (auth.uid() = user_id);

-- Tidak ada policy insert/update/delete: penulisan hanya via fungsi SECURITY DEFINER.

grant execute on function fn_credit_ensure_account() to authenticated;
grant execute on function fn_credit_hold(uuid, bigint) to authenticated;
grant execute on function fn_credit_settle(uuid, bigint) to authenticated;
grant execute on function fn_credit_refund(uuid) to authenticated;
revoke execute on function fn_credit_grant(uuid, bigint, text, text) from anon, authenticated;

-- Rekonsiliasi: saldo cache harus sama dengan jumlah ledger.
create or replace view v_credit_reconciliation as
select
  a.user_id,
  a.balance_micro_idr                                   as balance_cache,
  coalesce(sum(l.delta_micro_idr), 0)                   as balance_ledger,
  a.balance_micro_idr - coalesce(sum(l.delta_micro_idr), 0) as diff
from credit_accounts a
left join credit_ledger l on l.user_id = a.user_id
group by a.user_id, a.balance_micro_idr;
