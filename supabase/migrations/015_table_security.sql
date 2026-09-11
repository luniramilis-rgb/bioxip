-- Pertahanan berlapis: RLS sudah memblokir baris (anon hanya melihat []), tetapi
-- tabel yang dibuat setelah migrasi 004 masih VISIBLE bagi anon (Supabase memberi
-- ALL ke anon/authenticated secara default). Cabut akses anon agar skema tidak bocor;
-- peran `authenticated` tetap punya SELECT (dibatasi RLS) karena edge membaca dengan
-- JWT pengguna. Penulisan tetap hanya via fungsi SECURITY DEFINER / service_role.

revoke all on table public.credit_accounts from anon;
revoke all on table public.credit_ledger from anon;
revoke all on table public.credit_operations from anon;
revoke all on table public.topups from anon;
revoke all on table public.ai_usage_log from anon;
revoke all on table public.ai_chat_log from anon;
revoke all on table public.usage_limits from anon;
revoke all on table public.answer_cache from anon, authenticated;

-- Pastikan tabel BARU di masa depan tidak otomatis terbuka untuk anon.
alter default privileges in schema public revoke all on tables from anon;

-- Cek cepat (jalankan manual bila perlu):
--   select relname, array_to_string(relacl, ' | ') from pg_class
--    where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname;
