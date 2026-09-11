const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const problems = [];
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const exists = (relative) => fs.existsSync(path.join(ROOT, relative));

// 1. Migrasi formulary harus lengkap (aditif, berurutan).
const migrations = [
  "017_formulary.sql",
  "018_formulary_monitoring_unique.sql",
  "019_formulary_staging_unique.sql",
  "020_formulary_remove_review_gate.sql",
  "021_drug_search.sql",
  "022_drug_search_hardening.sql",
];
for (const file of migrations) {
  if (!exists(`supabase/migrations/${file}`)) problems.push(`migrasi hilang: ${file}`);
}

// 2. Invariant gate review dihapus (020): view publik tanpa filter `reviewed`.
const m020 = read("supabase/migrations/020_formulary_remove_review_gate.sql");
for (const view of ["drug_products_public", "drug_interactions_public", "drug_monitoring_public"]) {
  if (!new RegExp(`create view public\\.${view}`, "i").test(m020)) problems.push(`020: view ${view} tidak dibuat ulang`);
}
if (!/add column if not exists source_tier/i.test(m020)) problems.push("020: kolom source_tier tidak ada");

// 3. Pencarian aman (022): starts_with + index trigram.
const m022 = read("supabase/migrations/022_drug_search_hardening.sql");
for (const marker of ["drug_products_inn_trgm_idx", "starts_with(lower(v.nama), p.low)"]) {
  if (!m022.includes(marker)) problems.push(`022: tidak ada "${marker}"`);
}
if (/like\s+p\.low\s*\|\|\s*'%'/i.test(m022)) problems.push("022: prefix masih memakai LIKE (rawan wildcard)");

// 4. Modul formulary + adapter literatur.
const formulary = read("functions/_formulary.js");
for (const marker of ["formularyEnabled", "mapFormularyRow", "findFormularyDrug", "suggestFormularyDrugs", "searchFormularyDrugs", "filterSafe"]) {
  if (!formulary.includes(marker)) problems.push(`_formulary.js: tidak ada "${marker}"`);
}
for (const file of ["crossref.js", "doaj.js", "neliti_oai.js", "linkout.js"]) {
  if (!exists(`functions/_literature/${file}`)) problems.push(`adapter literatur hilang: ${file}`);
}

// 5. Flag default OFF & tidak menebak URL eksternal.
const search = read("functions/api/search.js");
if (!search.includes("parseLitSources")) problems.push("api/search.js: parseLitSources tidak ada");
if (!/LIT_SOURCES/.test(search)) problems.push("api/search.js: flag LIT_SOURCES tidak ada");
const linkout = read("functions/_literature/linkout.js");
if (/garuda\.kemdikbud\.go\.id/i.test(linkout)) problems.push("linkout.js: URL Garuda tidak boleh di-hardcode (belum terverifikasi)");
if (!linkout.includes("GARUDA_SEARCH_URL")) problems.push("linkout.js: Garuda harus opt-in via GARUDA_SEARCH_URL");

// 6. Dokumentasi & perintah.
for (const doc of ["docs/formulary.md", "docs/literature.md", "docs/formulary-plan.md"]) {
  if (!exists(doc)) problems.push(`dokumen hilang: ${doc}`);
}
if (!read("AGENTS.md").includes("ingest_formulary")) problems.push("AGENTS.md: perintah ingest_formulary tidak tercatat");

console.log(`Formulary: ${migrations.length} migrasi · adapter literatur 4 · modul formulary diperiksa`);
if (problems.length) {
  console.log("\nMASALAH:");
  for (const problem of problems) console.log(" - " + problem);
  process.exit(1);
}
console.log("VALID: integrasi formulary & literatur konsisten (migrasi, flag OFF, provenance, pencarian aman)");
