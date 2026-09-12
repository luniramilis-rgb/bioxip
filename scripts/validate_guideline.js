const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const problems = [];
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const exists = (relative) => fs.existsSync(path.join(ROOT, relative));

const MIGRATION = "supabase/migrations/023_guideline.sql";
if (!exists(MIGRATION)) {
  problems.push(`migrasi hilang: ${MIGRATION}`);
} else {
  const sql = read(MIGRATION);
  const markers = [
    "create table if not exists public.guideline_recs",
    "references public.fact_sources(id)",
    "check (char_length(ringkasan) <= 300)",
    "search_tsv tsvector generated always as (to_tsvector('simple'",
    "unique (source_id, topik, locator)",
    "create or replace view public.guideline_recs_public",
    "create or replace function public.fn_guideline_search",
    "alter table public.guideline_recs enable row level security",
    "revoke all on table public.guideline_recs from anon, authenticated",
    "grant select on public.guideline_recs_public to anon, authenticated",
    "revoke execute on function public.fn_guideline_search(text, text, int) from public",
    "grant execute on function public.fn_guideline_search(text, text, int) to anon, authenticated",
  ];
  for (const marker of markers) {
    if (!sql.includes(marker)) problems.push(`023_guideline.sql: tidak ada "${marker}"`);
  }
  // Hemat storage: jangan menyalin dokumen penuh.
  if (/full_text|fulltext|bytea|content_pdf|documento?\b/i.test(sql)) {
    problems.push("023_guideline.sql: indikasi penyimpanan dokumen penuh (harus pointer + ringkasan)");
  }
  // Pencarian aman: hindari LIKE dengan input pengguna (rawan wildcard).
  if (/like\s+p\.low/i.test(sql)) {
    problems.push("023_guideline.sql: prefix memakai LIKE (rawan wildcard); pakai starts_with()");
  }
  // Ringan: tidak membuat tabel staging topik/sumber baru (pakai faktur yang ada).
  for (const forbidden of ["guideline_sources", "guideline_topics", "guideline_staging", "guideline_links"]) {
    if (new RegExp(`create table[^;]*${forbidden}`, "i").test(sql)) {
      problems.push(`023_guideline.sql: tabel ${forbidden} tidak diperlukan (pakai fact_sources/formulary_staging)`);
    }
  }
}

if (!exists("docs/guideline.md")) problems.push("dokumen kontrak hilang: docs/guideline.md");

// L2: pembacaan guideline di edge (flag GUIDELINE_DB) + integrasi di /api/search.
if (!exists("functions/_guideline.js")) {
  problems.push("modul hilang: functions/_guideline.js");
} else {
  const mod = read("functions/_guideline.js");
  for (const marker of ["guidelineEnabled", "detectGuidelineTopic", "searchGuidelines", "GUIDELINE_DB", "fn_guideline_search"]) {
    if (!mod.includes(marker)) problems.push(`_guideline.js: tidak ada "${marker}"`);
  }
}
const search = read("functions/api/search.js");
for (const marker of ["guidelineEnabled(env)", "searchGuidelines(env", "guidelineRows"]) {
  if (!search.includes(marker)) problems.push(`api/search.js: integrasi guideline "${marker}" tidak ditemukan`);
}

// 024: p_query diberi default agar pencarian bisa dipanggil hanya dengan p_topik.
const MIGRATION_DEFAULT = "supabase/migrations/024_guideline_search_default.sql";
if (!exists(MIGRATION_DEFAULT)) {
  problems.push(`migrasi hilang: ${MIGRATION_DEFAULT}`);
} else {
  const sql = read(MIGRATION_DEFAULT);
  for (const marker of ["create or replace function public.fn_guideline_search", "p_query text default null", "grant execute on function public.fn_guideline_search(text, text, int) to anon, authenticated"]) {
    if (!sql.includes(marker)) problems.push(`024_guideline_search_default.sql: tidak ada "${marker}"`);
  }
}

console.log("Guideline: skema 023 (1 tabel + view + RPC) diperiksa");
if (problems.length) {
  console.log("\nMASALAH:");
  for (const problem of problems) console.log(" - " + problem);
  process.exit(1);
}
console.log("VALID: skema guideline hemat (pointer+ringkasan), RLS benar, pencarian aman");
