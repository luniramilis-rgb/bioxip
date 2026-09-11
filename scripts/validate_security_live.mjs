/**
 * Uji produksi keamanan: memastikan anon TIDAK dapat memanggil fungsi sensitif
 * dan tidak dapat membaca tabel operasional. Butuh SUPABASE_ANON_KEY.
 *   node scripts/validate_security_live.mjs
 */
const SUPABASE_URL = process.env.SUPABASE_URL || "https://nxlcosnksgbuvtiggjpw.supabase.co";
const ANON = process.env.SUPABASE_ANON_KEY;
const BASE = (process.env.BIOXIP_BASE || "https://bioxip.pages.dev").replace(/\/$/, "");

if (!ANON) {
  console.log("Lewati: SUPABASE_ANON_KEY wajib diisi.");
  process.exit(0);
}

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

async function anonRpc(name, args) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const text = await resp.text();
  return { status: resp.status, body: text ? text.slice(0, 120) : "" };
}

async function anonSelect(table) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, Accept: "application/json" },
  });
  return { status: resp.status };
}

// Fungsi yang HANYA boleh dipanggil server (service_role).
const serviceOnly = [
  ["fn_credit_grant", { p_user_id: "00000000-0000-0000-0000-000000000000", p_amount_micro_idr: 1, p_reason: "topup", p_idempotency_key: null }],
  ["fn_topup_mark_paid", { p_external_id: "uji", p_status: "SUCCEEDED", p_paid_at: null, p_raw: {} }],
  ["fn_answer_cache_hit", { p_query_hash: "uji" }],
];

for (const [name, args] of serviceOnly) {
  const { status, body } = await anonRpc(name, args);
  check(
    `anon ditolak: ${name}`,
    status === 401 || status === 403 || /permission denied/i.test(body),
    `HTTP ${status} ${body}`,
  );
}

// Fungsi pengguna: anon boleh "memanggil" tetapi harus ditolak karena tidak ada JWT.
for (const [name, args] of [
  ["fn_credit_hold", { p_request_id: "00000000-0000-0000-0000-000000000000", p_amount_micro_idr: 100 }],
  ["fn_credit_settle", { p_request_id: "00000000-0000-0000-0000-000000000000", p_charged_micro_idr: 0 }],
  ["fn_credit_refund", { p_request_id: "00000000-0000-0000-0000-000000000000" }],
]) {
  const { status, body } = await anonRpc(name, args);
  const denied = status === 401 || status === 403 || /unauthorized|permission denied/i.test(body);
  check(`anon tidak bisa memakai: ${name}`, denied, `HTTP ${status} ${body}`);
}

// Tabel operasional tidak boleh terbaca anon.
for (const table of ["answer_cache", "credit_accounts", "credit_ledger", "topups", "ai_usage_log", "ai_chat_log"]) {
  const { status } = await anonSelect(table);
  check(`anon tidak bisa membaca tabel: ${table}`, status === 404 || status === 401 || status === 403, `HTTP ${status}`);
}

// Endpoint AI/topup tanpa token harus 401.
for (const path of ["/api/ai/chat", "/api/ai/estimate", "/api/credits/me", "/api/credits/topup"]) {
  const resp = await fetch(`${BASE}${path}`, {
    method: path === "/api/ai/estimate" || path === "/api/credits/me" ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: path === "/api/ai/estimate" || path === "/api/credits/me" ? undefined : JSON.stringify({ question: "uji" }),
  });
  check(`endpoint tanpa token 401: ${path}`, resp.status === 401, String(resp.status));
}

let failed = 0;
for (const item of results) {
  if (!item.ok) failed++;
  console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? " (" + item.detail + ")" : ""}`);
}
console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
