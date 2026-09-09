alter table documents enable row level security;
alter table term_map enable row level security;

create policy docs_public_read on documents for select
  using (status = 'active');

create policy term_map_public_read on term_map for select
  using (true);

grant execute on function fn_bioxip_search(text, text[], int, int, boolean, boolean, text, int, int) to anon, authenticated;
