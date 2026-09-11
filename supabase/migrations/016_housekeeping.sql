-- Housekeeping terjadwal (dipanggil dari GitHub Actions / cron, bukan dari edge publik).
-- Membersihkan cache jawaban kedaluwarsa dan memangkas log percakapan AI secara bertahap
-- agar DELETE tidak mengunci tabel terlalu lama.

-- Percepat pemangkasan berdasarkan waktu kedaluwarsa.
create index if not exists ai_chat_log_expires_idx on ai_chat_log (expires_at);
create index if not exists answer_cache_expires_idx on answer_cache (expires_at);

create or replace function fn_housekeeping(
  p_chat_delete_limit int default 5000,
  p_cache_delete_limit int default 20000
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_chat_limit int := greatest(1, least(coalesce(p_chat_delete_limit, 5000), 50000));
  v_cache_limit int := greatest(1, least(coalesce(p_cache_delete_limit, 20000), 200000));
  v_cache_deleted int := 0;
  v_chat_deleted int := 0;
  v_cache_remaining bigint := 0;
  v_chat_remaining bigint := 0;
begin
  -- answer_cache: hapus bertahap agar backlog pertama tidak menjadi satu transaksi panjang.
  with expired as (
    select ctid from answer_cache
     where expires_at < now()
     order by expires_at asc
     limit v_cache_limit
  )
  delete from answer_cache
   where ctid in (select ctid from expired);
  get diagnostics v_cache_deleted = row_count;

  -- ai_chat_log: hapus bertahap (limit) agar transaksi tetap pendek.
  with expired as (
    select ctid from ai_chat_log
     where expires_at < now()
     order by expires_at asc
     limit v_chat_limit
  )
  delete from ai_chat_log
   where ctid in (select ctid from expired);
  get diagnostics v_chat_deleted = row_count;

  -- Sisa backlog berguna untuk observability (apakah perlu menaikkan limit).
  select count(*) into v_cache_remaining from answer_cache where expires_at < now();
  select count(*) into v_chat_remaining from ai_chat_log where expires_at < now();

  return jsonb_build_object(
    'answer_cache_deleted', v_cache_deleted,
    'answer_cache_remaining', v_cache_remaining,
    'chat_deleted', v_chat_deleted,
    'chat_remaining', v_chat_remaining,
    'chat_limit', v_chat_limit,
    'cache_limit', v_cache_limit,
    'ran_at', now()
  );
end $$;

-- Hanya layanan server (service_role) yang boleh menjalankannya.
revoke execute on function public.fn_housekeeping(int, int) from public;
revoke execute on function public.fn_housekeeping(int, int) from anon;
revoke execute on function public.fn_housekeeping(int, int) from authenticated;
grant execute on function public.fn_housekeeping(int, int) to service_role;
