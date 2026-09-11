// Housekeeping bioXip: panggil RPC fn_housekeeping via service_role.
// Dipakai oleh .github/workflows/housekeeping.yml (terjadwal) dan bisa dijalankan manual:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE=... node scripts/housekeeping.mjs
// Argumen opsional: [chat_limit] [cache_limit] (default 5000 dan 20000).

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE || "";
const IN_CI = process.env.GITHUB_ACTIONS === "true" || process.env.CI === "true";
const CHAT_LIMIT = Number(process.argv[2] || 5000);
const CACHE_LIMIT = Number(process.argv[3] || 20000);

if (!SUPABASE_URL || !SERVICE_KEY) {
  if (IN_CI) {
    console.error("GAGAL housekeeping: SUPABASE_URL / SUPABASE_SERVICE_ROLE tidak diset di CI.");
    process.exit(1);
  }
  console.log("INFO  SUPABASE_URL / SUPABASE_SERVICE_ROLE tidak diset → housekeeping dilewati (dianggap mode lokal).");
  process.exit(0);
}

const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_housekeeping`, {
  method: "POST",
  headers: {
    // Kunci API baru (secret) BUKAN JWT → hanya header `apikey`.
    apikey: SERVICE_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ p_chat_delete_limit: CHAT_LIMIT, p_cache_delete_limit: CACHE_LIMIT }),
});

const text = await resp.text();
if (!resp.ok) {
  console.error(`GAGAL housekeeping (HTTP ${resp.status}): ${text}`);
  process.exit(1);
}

// Bila backlog masih tersisa, minta run berikutnya menaikkan limit (terlihat di log).
let remaining = 0;
try {
  const body = JSON.parse(text);
  remaining = Number(body?.chat_remaining || 0) + Number(body?.answer_cache_remaining || 0);
} catch {
  /* respons non-JSON tetap dianggap sukses bila HTTP 200 */
}
console.log(`VALID: housekeeping dijalankan → ${text}`);
if (remaining > 0) console.log(`INFO  backlog tersisa ${remaining} baris → akan dipangkas pada run berikutnya.`);
