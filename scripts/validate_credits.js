const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const problems = [];

const sql008 = fs.readFileSync(path.join(ROOT, "supabase", "migrations", "008_credits.sql"), "utf8");
const sql009 = fs.readFileSync(path.join(ROOT, "supabase", "migrations", "009_credit_trigger_fix.sql"), "utf8");
const pricing = JSON.parse(fs.readFileSync(path.join(ROOT, "functions", "_pricing.json"), "utf8"));

const requiredSql = [
  "create table credit_accounts",
  "create table credit_ledger",
  "create table credit_operations",
  "create table topups",
  "create table ai_usage_log",
  "create table ai_chat_log",
  "create table usage_limits",
  "create or replace function fn_credit_ensure_account",
  "create or replace function fn_credit_hold",
  "create or replace function fn_credit_settle",
  "create or replace function fn_credit_refund",
  "create or replace function fn_credit_grant",
  "check (balance_micro_idr >= 0)",
  "create unique index credit_ledger_idem_idx",
  "create policy credit_accounts_own",
  "create policy credit_ledger_own",
  "create or replace view v_credit_reconciliation",
  "revoke execute on function fn_credit_grant",
];
for (const needle of requiredSql) {
  if (!sql008.includes(needle)) problems.push(`008_credits.sql: tidak ada "${needle}"`);
}

for (const needle of ["create or replace function fn_apply_ledger_delta", "update credit_accounts", "row_count", "account_missing_for_debit"]) {
  if (!sql009.includes(needle)) problems.push(`009_credit_trigger_fix.sql: tidak ada "${needle}"`);
}

if (pricing.markup !== 12) problems.push(`_pricing.json: markup harus 12 (sekarang ${pricing.markup})`);
if (pricing.min_charge_idr !== 100) problems.push("_pricing.json: min_charge_idr harus 100");
if (pricing.micro_per_idr !== 1_000_000) problems.push("_pricing.json: micro_per_idr harus 1.000.000");
for (const key of ["usd_idr", "price_in_hit_usd_per_million", "price_in_miss_usd_per_million", "price_out_usd_per_million"]) {
  if (!(pricing[key] > 0)) problems.push(`_pricing.json: ${key} harus > 0`);
}
if (!(pricing.price_in_miss_usd_per_million > pricing.price_in_hit_usd_per_million)) {
  problems.push("_pricing.json: harga cache miss harus lebih besar dari cache hit");
}

const endpoints = ["functions/api/credits/me.js", "functions/api/credits/ledger.js", "functions/_credits.js", "functions/_pricing.js"];
for (const file of endpoints) {
  if (!fs.existsSync(path.join(ROOT, file))) problems.push(`file hilang: ${file}`);
}

// Uji rumus (patokan terdokumentasi) memakai konstanta yang sama.
const perThousand = (usdPerMillion) => Math.round(((usdPerMillion * pricing.usd_idr) / 1000) * pricing.micro_per_idr);
const priceInMiss = perThousand(pricing.price_in_miss_usd_per_million);
const priceOut = perThousand(pricing.price_out_usd_per_million);
const cost = Math.ceil((4000 * priceInMiss) / 1000) + Math.ceil((1000 * priceOut) / 1000);
const charged = Math.max(cost * pricing.markup, pricing.min_charge_idr * pricing.micro_per_idr);
const chargedIdr = Math.ceil(charged / pricing.micro_per_idr);
if (!(chargedIdr >= 400 && chargedIdr <= 600)) {
  problems.push(`rumus: 4k input tanpa cache + 1k output seharusnya ±Rp400–600 (dapat Rp${chargedIdr})`);
}

console.log(`Kredit: ${requiredSql.length} penanda SQL · markup ${pricing.markup}× · contoh tagihan Rp${chargedIdr}`);
if (problems.length) {
  console.log("\nMASALAH:");
  for (const problem of problems) console.log(" - " + problem);
  process.exit(1);
}
console.log("VALID: skema ledger, fungsi debit/refund, RLS, view rekonsiliasi, harga, dan rumus tagihan");
