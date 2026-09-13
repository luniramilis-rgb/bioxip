-- Katalog Fornas diperluas (fetch-first): simpan SELURUH field publik API e-Fornas,
-- bukan hanya identitas. Aditif: kolom baru + view publik dibuat ulang.
-- Sumber: GET https://e-fornas.kemkes.go.id/api/daftar-obat (1.254 baris SKU, 663 obat).
-- Yang ditambahkan: flag formularium, komposisi, satuan, restriksi, peresepan maksimal,
-- dan `variants` (daftar sediaan/kekuatan per obat). Lihat docs/formulary.md.

alter table public.drug_products add column if not exists fornas_id_obat text;
alter table public.drug_products add column if not exists komposisi text;
alter table public.drug_products add column if not exists satuan text;
alter table public.drug_products add column if not exists status_fpktp boolean not null default false;
alter table public.drug_products add column if not exists status_fpktl boolean not null default false;
alter table public.drug_products add column if not exists status_prb boolean not null default false;
alter table public.drug_products add column if not exists status_pp boolean not null default false;
alter table public.drug_products add column if not exists status_oen boolean not null default false;
alter table public.drug_products add column if not exists status_program boolean not null default false;
alter table public.drug_products add column if not exists status_kanker boolean not null default false;
alter table public.drug_products add column if not exists peresepan_maksimal text;
alter table public.drug_products add column if not exists restriksi_obat text;
alter table public.drug_products add column if not exists restriksi_sediaan text;
alter table public.drug_products add column if not exists restriksi_kelas text[] not null default '{}';
alter table public.drug_products add column if not exists variants jsonb not null default '[]'::jsonb;

create index if not exists drug_products_fornas_id_idx on public.drug_products (fornas_id_obat);

-- View publik: tambahkan kolom katalog baru (tetap tanpa gate `reviewed`, lihat 020).
drop view if exists public.drug_products_public;
create view public.drug_products_public as
select slug, nama, inn, us_name, atc, kelas, rute, bentuk_sediaan, kekuatan, satuan,
       komposisi, status_fornas, nie, fornas_id_obat,
       status_fpktp, status_fpktl, status_prb, status_pp, status_oen, status_program, status_kanker,
       peresepan_maksimal, restriksi_obat, restriksi_sediaan, restriksi_kelas, variants,
       source_id, source_tier, retrieved_at, valid_from, valid_to, search_tsv
  from public.drug_products
 where valid_to is null or valid_to >= current_date;

grant select on public.drug_products_public to anon, authenticated;

notify pgrst, 'reload schema';
