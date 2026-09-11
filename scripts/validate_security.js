const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const problems = [];

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

// 1. Migrasi keamanan harus mencabut EXECUTE dari PUBLIC (default Postgres) —
//    `revoke ... from anon` saja tidak cukup karena PUBLIC tetap memberi akses.
const migration = read("supabase/migrations/014_function_security.sql");
if (!/revoke execute on function %s from public/i.test(migration)) {
  problems.push("014_function_security.sql: harus mencabut EXECUTE dari PUBLIC (loop revoke)");
}
if (!/revoke execute on function %s from anon/i.test(migration)) {
  problems.push("014_function_security.sql: harus mencabut EXECUTE dari anon");
}
if (!/alter default privileges in schema public revoke execute on functions from public/i.test(migration)) {
  problems.push("014_function_security.sql: default privileges untuk fungsi baru harus dicabut dari PUBLIC");
}
for (const grant of [
  "fn_credit_grant(uuid, bigint, text, text) to service_role",
  "fn_topup_mark_paid(text, text, timestamptz, jsonb) to service_role",
  "fn_answer_cache_hit(text) to service_role",
  "fn_credit_hold(uuid, bigint) to authenticated",
  "fn_credit_settle(uuid, bigint) to authenticated",
  "fn_credit_refund(uuid) to authenticated",
  "fn_ai_log_usage(",
  "fn_ai_log_chat(",
]) {
  if (!migration.includes(grant)) problems.push(`014_function_security.sql: grant hilang → ${grant}`);
}
if (!migration.includes("revoke all on table public.answer_cache from anon, authenticated")) {
  problems.push("014_function_security.sql: answer_cache harus dicabut dari anon/authenticated");
}

// 1b. Housekeeping (016): fungsi pembersih hanya boleh dipanggil service_role dan
//     pemangkasan harus dibatasi (batching) agar tidak mengunci tabel.
const housekeeping = read("supabase/migrations/016_housekeeping.sql");
for (const marker of [
  "create or replace function fn_housekeeping",
  "p_chat_delete_limit",
  "p_cache_delete_limit",
  "security definer",
  "revoke execute on function public.fn_housekeeping(int, int) from public",
  "revoke execute on function public.fn_housekeeping(int, int) from anon",
  "revoke execute on function public.fn_housekeeping(int, int) from authenticated",
  "grant execute on function public.fn_housekeeping(int, int) to service_role",
]) {
  if (!housekeeping.includes(marker)) problems.push(`016_housekeeping.sql: tidak ada "${marker}"`);
}
if (/grant execute on function public\.fn_housekeeping[^;]*to anon/i.test(housekeeping)) {
  problems.push("016_housekeeping.sql: fn_housekeeping tidak boleh di-grant ke anon");
}
if (/delete\s+from\s+answer_cache\s+where\s+expires_at\s*<\s*now\(\)\s*;/i.test(housekeeping)) {
  problems.push("016_housekeeping.sql: DELETE answer_cache tidak boleh tanpa batas (harus dibatch)");
}

// 1c. Formulary (017): tabel dasar tertutup; anon hanya membaca view publik.
const formulary = read("supabase/migrations/017_formulary.sql");
const formularyTables = [
  "fact_sources",
  "drug_products",
  "drug_doses",
  "drug_interactions",
  "drug_monitoring",
  "drug_crosswalk",
  "formulary_staging",
  "formulary_meta",
];
for (const table of formularyTables) {
  if (!new RegExp(`alter table public\\.${table} enable row level security`, "i").test(formulary)) {
    problems.push(`017_formulary.sql: RLS belum diaktifkan untuk ${table}`);
  }
}
if (!/revoke all on table public\.fact_sources[\s\S]*?from anon, authenticated/i.test(formulary)) {
  problems.push("017_formulary.sql: tabel dasar harus dicabut dari anon/authenticated");
}
for (const view of ["drug_products_public", "drug_doses_public", "drug_interactions_public", "drug_monitoring_public"]) {
  if (!new RegExp(`grant select on[\\s\\S]*?public\\.${view}`, "i").test(formulary)) {
    problems.push(`017_formulary.sql: view ${view} harus di-grant SELECT ke anon/authenticated`);
  }
}
if (/grant\s+(?:all|select|insert|update|delete)[^;]*on table public\.(?:drug_products|drug_doses|drug_interactions|drug_monitoring)\b[^;]*to\s+(?:anon|authenticated)/i.test(formulary)) {
  problems.push("017_formulary.sql: tabel dasar tidak boleh di-grant langsung ke anon/authenticated");
}
if (!/generated always as \(to_tsvector\('simple'/i.test(formulary)) {
  problems.push("017_formulary.sql: kolom search_tsv (tsvector generated) tidak ditemukan");
}
if (!/notify pgrst, 'reload schema'/i.test(formulary)) {
  problems.push("017_formulary.sql: harus notify pgrst reload schema");
}

// 1d. Gate review dihapus (020): view publik TIDAK boleh memfilter `reviewed`,
//     dan wajib menyertakan provenance `source_tier`.
const reviewGate = read("supabase/migrations/020_formulary_remove_review_gate.sql");
for (const view of ["drug_products_public", "drug_doses_public", "drug_interactions_public", "drug_monitoring_public"]) {
  if (!new RegExp(`create view public\\.${view}`, "i").test(reviewGate)) {
    problems.push(`020_formulary_remove_review_gate.sql: view ${view} harus dibuat ulang`);
  }
}
const viewBodies = reviewGate.split(/create view/i).slice(1);
for (const body of viewBodies) {
  if (/\breviewed\b/i.test(body)) {
    problems.push("020_formulary_remove_review_gate.sql: view publik masih memfilter `reviewed`");
    break;
  }
}
if (!/add column if not exists source_tier/i.test(reviewGate)) {
  problems.push("020_formulary_remove_review_gate.sql: kolom source_tier tidak ditemukan");
}

// 2. Fungsi paling sensitif harus muncul di migrasi keamanan (agar tidak terlewat).
for (const fn of ["fn_credit_grant", "fn_topup_mark_paid", "fn_answer_cache_hit"]) {
  if (!migration.includes(fn)) problems.push(`014_function_security.sql: tidak menyebut ${fn}`);
}

// 3. Edge tidak boleh memakai service_role dari sisi klien.
const webFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".js")) webFiles.push(full);
  }
})(path.join(ROOT, "web"));
for (const file of webFiles) {
  const source = fs.readFileSync(file, "utf8");
  if (/SERVICE_ROLE|service_role/i.test(source)) {
    problems.push(`${path.relative(ROOT, file)}: memuat service_role di kode klien`);
  }
}

// 4. Service role hanya dipakai di edge (webhook) — bukan di endpoint publik lain.
const webhook = read("functions/api/payments/webhook.js");
if (!webhook.includes("SUPABASE_SERVICE_ROLE")) {
  problems.push("api/payments/webhook.js: seharusnya memakai service_role untuk mengkredit saldo");
}
const publicEndpoints = ["functions/api/search.js", "functions/api/drug.js", "functions/api/interactions.js", "functions/api/answer.js"];
for (const file of publicEndpoints) {
  if (/SERVICE_ROLE/.test(read(file))) {
    problems.push(`${file}: endpoint publik tidak boleh memakai service_role`);
  }
}

// 5. Guardrail input harus tetap menolak data pasien.
const safety = read("functions/_safety.js");
for (const marker of ["PATIENT_DATA", "\\b\\d{16}\\b", "pasien saya", "tanggal lahir"]) {
  if (!safety.includes(marker)) problems.push(`_safety.js: guardrail "${marker}" hilang`);
}

// 6. Kunci API Supabase (publishable `sb_publishable_...` / secret `sb_secret_...`)
//    BUKAN JWT, sehingga ditolak bila dikirim di header Authorization: Bearer.
//    Kunci hanya boleh lewat `apikey`; Bearer khusus access token user.
const edgeFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".js")) edgeFiles.push(full);
  }
})(path.join(ROOT, "functions"));
const apiKeyAsBearer = /Authorization:\s*`Bearer \$\{env\.SUPABASE_(?:ANON_KEY|SERVICE_ROLE)\}`/;
for (const file of edgeFiles) {
  const source = fs.readFileSync(file, "utf8");
  if (apiKeyAsBearer.test(source)) {
    problems.push(`${path.relative(ROOT, file)}: kunci API dikirim sebagai Authorization Bearer (harus lewat header apikey saja)`);
  }
}
// Skrip operasional/validator juga tidak boleh mengirim kunci API sebagai Bearer.
const scriptFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(?:js|mjs)$/.test(entry.name)) scriptFiles.push(full);
  }
})(path.join(ROOT, "scripts"));
const scriptKeyAsBearer = /Authorization:\s*`Bearer \$\{(?:SERVICE|SERVICE_KEY|ANON|ANON_KEY)\}`/;
for (const file of scriptFiles) {
  const source = fs.readFileSync(file, "utf8");
  // Kecualikan pola Bearer token user (variabel bernama token/accessToken).
  if (scriptKeyAsBearer.test(source)) {
    problems.push(`${path.relative(ROOT, file)}: kunci API dikirim sebagai Authorization Bearer (harus lewat header apikey saja)`);
  }
}
const authClient = read("web/js/auth.js");
if (/Bearer \$\{options\.token \|\| ANON\}/.test(authClient)) {
  problems.push("web/js/auth.js: kunci anon dikirim sebagai Bearer saat tidak ada token user");
}
if (/Authorization:\s*`Bearer \$\{env\.SUPABASE_SERVICE_ROLE\}`/.test(read("functions/_answercache.js"))) {
  problems.push("functions/_answercache.js: service key dikirim sebagai Authorization Bearer");
}

// 7. Harvester (Python) juga menulis via service_role → kunci hanya di header `apikey`.
const harvesterFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".py")) harvesterFiles.push(full);
  }
})(path.join(ROOT, "harvester"));
for (const file of harvesterFiles) {
  const source = fs.readFileSync(file, "utf8");
  if (/Bearer/.test(source)) {
    problems.push(`${path.relative(ROOT, file)}: kunci API dikirim sebagai Authorization Bearer (harus header apikey)`);
  }
}

console.log(`Keamanan: ${migration.split("\n").length} baris migrasi · ${webFiles.length} berkas klien · ${edgeFiles.length} berkas edge diperiksa`);
if (problems.length) {
  console.log("\nMASALAH:");
  for (const problem of problems) console.log(" - " + problem);
  process.exit(1);
}
console.log("VALID: fungsi sensitif tertutup dari PUBLIC/anon, service_role tidak bocor ke klien");
