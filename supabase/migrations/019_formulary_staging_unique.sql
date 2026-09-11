-- Fase 2 (review): jadikan `formulary_staging` antrean current-state, bukan append-only.
-- Tanpa kunci unik, `--apply` setelah perubahan akan menumpuk baris untuk (kind, slug)
-- yang sama; baris `approved` lama lalu ikut terpublikasi dan bisa menimpa yang baru.

-- Bersihkan duplikat lebih dulu (pertahankan id terbaru per kind+slug).
delete from public.formulary_staging s
 using public.formulary_staging t
 where s.kind = t.kind and s.slug = t.slug and s.id < t.id;

create unique index if not exists formulary_staging_kind_slug_key
  on public.formulary_staging (kind, slug);

notify pgrst, 'reload schema';
