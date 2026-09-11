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

console.log(`Keamanan: ${migration.split("\n").length} baris migrasi · ${webFiles.length} berkas klien diperiksa`);
if (problems.length) {
  console.log("\nMASALAH:");
  for (const problem of problems) console.log(" - " + problem);
  process.exit(1);
}
console.log("VALID: fungsi sensitif tertutup dari PUBLIC/anon, service_role tidak bocor ke klien");
