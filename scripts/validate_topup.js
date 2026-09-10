const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BASE = (process.env.BIOXIP_BASE || "https://bioxip.pages.dev").replace(/\/$/, "");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://nxlcosnksgbuvtiggjpw.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE || "";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54bGNvc25rc2didXZ0aWdnanB3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5NzYwOTUsImV4cCI6MjEwNDU1MjA5NX0.mMkfEn6OvJM-W-ZgkSBTpTWlFPZ6eJELSzYeIf1kiX0";

const results = [];
const problems = [];

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
}

function fail(message) {
  problems.push(message);
}

// --- 1. Struktur statis ------------------------------------------------------
const topup = fs.readFileSync(path.join(ROOT, "functions", "api", "credits", "topup.js"), "utf8");
for (const marker of ["fn_topup_create", "fn_topup_attach", "PACKAGES_IDR", "CHANNELS", "xenditConfig"]) {
  if (!topup.includes(marker)) fail(`api/credits/topup.js: tidak ada "${marker}"`);
}
const webhook = fs.readFileSync(path.join(ROOT, "functions", "api", "payments", "webhook.js"), "utf8");
for (const marker of ["verifyWebhook", "fn_topup_mark_paid", "SUPABASE_SERVICE_ROLE", "already_paid"]) {
  if (!webhook.includes(marker)) fail(`api/payments/webhook.js: tidak ada "${marker}"`);
}
const migration = fs.readFileSync(path.join(ROOT, "supabase", "migrations", "011_topups.sql"), "utf8");
for (const marker of [
  "fn_topup_create",
  "fn_topup_get",
  "fn_topup_attach",
  "fn_topup_mark_paid",
  "revoke execute on function fn_topup_mark_paid",
  "credit_ledger",
  "'topup'",
]) {
  if (!migration.includes(marker)) fail(`011_topups.sql: tidak ada "${marker}"`);
}
if (!migration.includes("p_amount_idr not in (50000, 100000, 150000, 500000)")) {
  fail("011_topups.sql: validasi paket harus di server");
}
if (!migration.includes("security definer")) fail("011_topups.sql: RPC harus SECURITY DEFINER");

const xendit = fs.readFileSync(path.join(ROOT, "functions", "_xendit.js"), "utf8");
if (!xendit.includes("mode: env.XENDIT_SECRET_KEY ? \"live\" : \"mock\"")) fail("_xendit.js: mode mock/live tidak jelas");
if (!xendit.includes("payment_requests")) fail("_xendit.js: belum memakai Payment Requests API Xendit");

// --- 2. Uji live (mock) ------------------------------------------------------
async function admin(pathname, init = {}) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/admin/${pathname}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
  });
  const text = await resp.text();
  return { ok: resp.ok, status: resp.status, body: text ? JSON.parse(text) : null };
}

async function signIn(email, password) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await resp.json();
  return body.access_token || null;
}

async function userSelect(token, pathname) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  return resp.ok ? resp.json() : [];
}

async function liveTests() {
  if (!SERVICE_KEY) {
    console.log("INFO  SUPABASE_SERVICE_ROLE tidak diset → uji live dilewati.");
    return;
  }

  const email = `bioxip-topup-${Date.now()}@example.com`;
  const password = `Aa1!${Math.random().toString(36).slice(2)}xyz`;
  const created = await admin("users", {
    method: "POST",
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!created.ok) {
    check("live: buat user uji", false, String(created.status));
    return;
  }
  const userId = created.body.id;
  const token = await signIn(email, password);
  check("live: sign in user uji", Boolean(token));
  if (!token) return;

  try {
    const before = await userSelect(token, "credit_accounts?select=balance_micro_idr");
    check("live: saldo awal 0", (before[0]?.balance_micro_idr ?? 0) === 0, JSON.stringify(before[0] || {}));

    const invalid = await fetch(`${BASE}/api/credits/topup`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ amount_idr: 12345, channel: "QRIS" }),
    });
    check("live: tolak nominal tidak valid (400)", invalid.status === 400, String(invalid.status));

    const invalidChannel = await fetch(`${BASE}/api/credits/topup`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ amount_idr: 100000, channel: "BITCOIN" }),
    });
    check("live: tolak kanal tidak valid (400)", invalidChannel.status === 400, String(invalidChannel.status));

    const create = await fetch(`${BASE}/api/credits/topup`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ amount_idr: 100000, channel: "QRIS" }),
    });
    const createdBody = await create.json();
    check(
      "live: buat topup QRIS (mock)",
      create.status === 200 && Boolean(createdBody.topup_id) && createdBody.mode === "mock",
      `status=${create.status} mode=${createdBody.mode}`,
    );

    const reuse = await fetch(`${BASE}/api/credits/topup`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ amount_idr: 100000, channel: "QRIS" }),
    });
    const reuseBody = await reuse.json();
    check("live: topup pending yang sama dipakai ulang", reuseBody.topup_id === createdBody.topup_id, reuseBody.topup_id);

    const pending = await fetch(`${BASE}/api/credits/topup?id=${createdBody.topup_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const pendingBody = await pending.json();
    check("live: status topup pending", pendingBody.status === "pending", JSON.stringify(pendingBody));

    // Simulasi webhook Xendit: langsung ke RPC service_role (mode mock tanpa callback token).
    const paid = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_topup_mark_paid`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_external_id: createdBody.external_id,
        p_status: "SUCCEEDED",
        p_paid_at: new Date().toISOString(),
        p_raw: { simulated: true },
      }),
    });
    const paidBody = await paid.json();
    const paidRow = Array.isArray(paidBody) ? paidBody[0] : paidBody;
    check("live: webhook kredit topup", paid.ok && paidRow?.applied === true, JSON.stringify(paidRow));

    const replay = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_topup_mark_paid`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_external_id: createdBody.external_id,
        p_status: "SUCCEEDED",
        p_paid_at: new Date().toISOString(),
        p_raw: { simulated: true },
      }),
    });
    const replayBody = await replay.json();
    const replayRow = Array.isArray(replayBody) ? replayBody[0] : replayBody;
    check("live: webhook idempotent (tidak dobel)", replayRow?.already_paid === true, JSON.stringify(replayRow));

    const after = await userSelect(token, "credit_accounts?select=balance_micro_idr");
    const balanceIdr = Math.ceil(Number(after[0]?.balance_micro_idr || 0) / 1_000_000);
    check("live: saldo bertambah Rp100.000 (sekali)", balanceIdr === 100_000, String(balanceIdr));

    const ledger = await userSelect(token, "credit_ledger?select=reason,delta_micro_idr&reason=eq.topup");
    check("live: ledger topup tepat 1 baris", ledger.length === 1, String(ledger.length));

    const webhookNoToken = await fetch(`${BASE}/api/payments/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ external_id: createdBody.external_id, status: "SUCCEEDED" }),
    });
    check(
      "live: webhook tanpa tanda tangan ditolak/aman",
      [200, 401].includes(webhookNoToken.status),
      String(webhookNoToken.status),
    );

    const unauth = await fetch(`${BASE}/api/credits/topup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount_idr: 100000, channel: "QRIS" }),
    });
    check("live: topup tanpa token 401", unauth.status === 401, String(unauth.status));
  } finally {
    await admin(`users/${userId}`, { method: "DELETE" });
  }
}

(async () => {
  await liveTests();

  let failed = 0;
  for (const item of results) {
    if (!item.ok) failed++;
    console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? " (" + item.detail + ")" : ""}`);
  }
  if (problems.length) {
    console.log("\nMASALAH:");
    for (const problem of problems) console.log(" - " + problem);
  }
  const total = failed + problems.length;
  console.log(total ? `\n${total} MASALAH` : "\nALL PASS");
  process.exit(total ? 1 : 0);
})().catch((error) => {
  console.error("VALIDATOR ERROR:", error.message);
  process.exit(1);
});
