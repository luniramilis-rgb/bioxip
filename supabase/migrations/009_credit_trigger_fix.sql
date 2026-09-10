-- Perbaikan penting: INSERT ... ON CONFLICT memvalidasi CHECK pada baris kandidat,
-- sehingga upsert dengan delta negatif selalu gagal walau baris sudah ada.
-- Solusi: gunakan UPDATE; hanya buat baris baru bila delta non-negatif (top-up pertama).

create or replace function fn_apply_ledger_delta() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_updated int;
begin
  update credit_accounts
     set balance_micro_idr = balance_micro_idr + new.delta_micro_idr,
         updated_at = now()
   where user_id = new.user_id;
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    if new.delta_micro_idr < 0 then
      raise exception 'account_missing_for_debit' using errcode = 'P0002';
    end if;
    insert into credit_accounts (user_id, balance_micro_idr)
    values (new.user_id, new.delta_micro_idr);
  end if;

  return new;
end $$;
