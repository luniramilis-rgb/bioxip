-- KEAMANAN KRITIS: fungsi di schema public otomatis mendapat EXECUTE untuk PUBLIC
-- (dan Supabase juga memberi anon). Akibatnya `revoke ... from anon` saja TIDAK cukup —
-- anon tetap bisa memanggil fn_credit_grant / fn_topup_mark_paid dan mencetak kredit gratis.
-- Migrasi ini mencabut EXECUTE dari PUBLIC + anon untuk SEMUA fungsi, lalu memberikannya
-- kembali hanya kepada peran yang tepat.

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  loop
    execute format('revoke execute on function %s from public', r.signature);
    execute format('revoke execute on function %s from anon', r.signature);
  end loop;
end $$;

-- Cegah fungsi BARU ikut terbuka ke PUBLIC/anon pada migrasi berikutnya.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;

-- Hanya layanan server (webhook/edge dengan service_role) yang boleh:
grant execute on function public.fn_credit_grant(uuid, bigint, text, text) to service_role;
grant execute on function public.fn_topup_mark_paid(text, text, timestamptz, jsonb) to service_role;
grant execute on function public.fn_answer_cache_hit(text) to service_role;

-- Pengguna terautentikasi (memakai JWT pengguna; fungsi memakai auth.uid()):
grant execute on function public.fn_credit_ensure_account() to authenticated;
grant execute on function public.fn_credit_hold(uuid, bigint) to authenticated;
grant execute on function public.fn_credit_settle(uuid, bigint) to authenticated;
grant execute on function public.fn_credit_refund(uuid) to authenticated;
grant execute on function public.fn_topup_create(bigint, text) to authenticated;
grant execute on function public.fn_topup_get(uuid) to authenticated;
grant execute on function public.fn_topup_attach(uuid, text, timestamptz, jsonb) to authenticated;
grant execute on function public.fn_ai_log_usage(uuid, text, text, text, int, int, bigint, bigint, text) to authenticated;
grant execute on function public.fn_ai_log_chat(uuid, text, jsonb, text, jsonb) to authenticated;

-- fn_apply_ledger_delta() hanya dipakai trigger → tidak perlu EXECUTE untuk siapa pun.
-- fn_usage_limit_for() tidak dipakai di edge → biarkan tanpa grant.

-- Pertahanan berlapis: cache jawaban tidak perlu terlihat oleh klien sama sekali.
revoke all on table public.answer_cache from anon, authenticated;
