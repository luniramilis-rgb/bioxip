const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BASE = (process.env.BIOXIP_BASE || "https://bioxip.pages.dev").replace(/\/$/, "");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://nxlcosnksgbuvtiggjpw.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE || "";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54bGNvc25rc2didXZ0aWdnanB3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5NzYwOTUsImV4cCI6MjEwNDU1MjA5NX0.mMkfEn6OvJM-W-ZgkSBTpTWlFPZ6eJELSzYeIf1kiX0";

async function userSelect(token, pathname) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  return resp.ok ? resp.json() : [];
}

const results = [];
const problems = [];

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
}

function fail(message) {
  problems.push(message);
}

// --- 1. Struktur statis -----------------------------------------------------
const chat = fs.readFileSync(path.join(ROOT, "functions", "api", "ai", "chat.js"), "utf8");
for (const marker of [
  "estimateMicroIdr",
  "holdCredits",
  "settleCredits",
  "refundCredits",
  "fn_ai_log_usage",
  "fn_ai_log_chat",
  "insufficient_balance",
  "text/event-stream",
  'send("delta"',
  'send("citation"',
  'send("done"',
  "classifyInput",
  "extractiveAnswer",
  "rate_limited",
  "effectiveRpm",
  "recentRequestCount",
  "safety: providerOk ? 1.3 : 1",
]) {
  if (!chat.includes(marker)) fail(`api/ai/chat.js: tidak ada "${marker}"`);
}
if (!chat.includes("chargedMicro > estimate")) fail("api/ai/chat.js: harus menjamin tagihan tidak melebihi hold");
if (!chat.includes("refundCredits")) fail("api/ai/chat.js: harus refund saat gagal");

// Streaming token: provider dipanggil dengan stream, teks diteruskan bertahap,
// dan ada fallback bila streaming gagal / struktur klaim tidak dapat diparsing.
for (const marker of ["runProviderStream", "streamDeepseek", 'send("replace"', "AnswerExtractor", "provider_empty_stream"]) {
  if (!chat.includes(marker)) fail(`api/ai/chat.js: tidak ada penanda streaming "${marker}"`);
}
const providerSrc = fs.readFileSync(path.join(ROOT, "functions", "_provider.js"), "utf8");
for (const marker of ["stream: true", "parseOpenAiSse", "stream_options", "STREAM_TIMEOUT_MS"]) {
  if (!providerSrc.includes(marker)) fail(`_provider.js: tidak ada penanda streaming "${marker}"`);
}
const groundedSrc = fs.readFileSync(path.join(ROOT, "functions", "_grounded.js"), "utf8");
for (const marker of ["AnswerExtractor", "extractAnswerText", "this.emitted"]) {
  if (!groundedSrc.includes(marker)) fail(`_grounded.js: tidak ada "${marker}" untuk streaming`);
}
const aiUi = fs.readFileSync(path.join(ROOT, "web", "js", "ai.js"), "utf8");
if (!aiUi.includes("onReplace")) fail("ai.js: harus menangani event replace (ganti teks saat parse gagal)");
if (!aiUi.includes("caret")) fail("ai.js: indikator menulis (caret) tidak ditemukan");

const pricing = fs.readFileSync(path.join(ROOT, "functions", "_pricing.js"), "utf8");
if (!pricing.includes("safety")) fail("_pricing.js: estimate harus mendukung faktor keamanan (safety)");

const migration = fs.readFileSync(path.join(ROOT, "supabase", "migrations", "010_ai_logging.sql"), "utf8");
for (const marker of [
  "fn_ai_log_usage",
  "fn_ai_log_chat",
  "security definer",
  "grant execute on function fn_ai_log_usage",
  "auth.uid()",
]) {
  if (!migration.includes(marker)) fail(`010_ai_logging.sql: tidak ada "${marker}"`);
}
if (!migration.includes("insert into ai_usage_log")) fail("010_ai_logging.sql: tidak menulis ai_usage_log");
if (!migration.includes("insert into ai_chat_log")) fail("010_ai_logging.sql: tidak menulis ai_chat_log");

const estimate = fs.readFileSync(path.join(ROOT, "functions", "api", "ai", "estimate.js"), "utf8");
if (!estimate.includes("estimatePayload") || !estimate.includes("401")) {
  fail("api/ai/estimate.js: harus memakai estimatePayload dan menolak tanpa token");
}

// --- 1b. Titik masuk AI di UI (beranda & halaman hasil) ---------------------
const app = fs.readFileSync(path.join(ROOT, "web", "js", "app.js"), "utf8");
const ai = fs.readFileSync(path.join(ROOT, "web", "js", "ai.js"), "utf8");
if (!app.includes("data-home-mode")) fail("app.js: beranda harus punya segmented mode AI (data-home-mode)");
if (!app.includes("ai-hint")) fail("app.js: beranda harus menampilkan status AI (ai-hint)");
if (!app.includes("Tanya AI")) fail("app.js: label 'Tanya AI' tidak ditemukan di UI");
if (!app.includes("function updateAiHint")) fail("app.js: harus ada updateAiHint (status saldo/AI)");
if (!app.includes("Isi saldo")) fail("app.js: status saldo kosong harus mengarahkan 'Isi saldo'");
if (!ai.includes("#/masuk")) fail("ai.js: panel AI terkunci harus menautkan ke #/masuk (login)");
if (!ai.includes("#/saldo")) fail("ai.js: panel AI harus menautkan ke #/saldo (isi saldo)");
for (const marker of ["Tanya AI terkunci", "Saldo Anda"]) {
  if (!ai.includes(marker)) fail(`ai.js: pesan saldo tidak jelas ("${marker}")`);
}

// --- 2. Uji live mock (butuh service role) ---------------------------------
async function admin(pathname, init = {}) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/admin/${pathname}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await resp.text();
  return { ok: resp.ok, status: resp.status, body: text ? JSON.parse(text) : null };
}

async function grantCredits(userId, amountIdr) {
  const micro = amountIdr * 1_000_000;
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_credit_grant`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_user_id: userId,
      p_amount_micro_idr: micro,
      p_reason: "topup",
      p_idempotency_key: `ai-test-${userId}`,
    }),
  });
  return { ok: resp.ok, status: resp.status, body: await resp.text() };
}

async function signIn(email, password) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await resp.json();
  return body.access_token || null;
}

async function setUserRpm(userId, rpm) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/usage_limits`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({ user_id: userId, rpm }),
  });
  return resp.ok;
}

async function readSse(response) {
  const text = await response.text();
  const events = [];
  for (const block of text.split("\n\n")) {
    const eventMatch = block.match(/^event:\s*(.+)$/m);
    const dataMatch = block.match(/^data:\s*(.+)$/m);
    if (eventMatch && dataMatch) {
      let data = null;
      try {
        data = JSON.parse(dataMatch[1]);
      } catch {
        data = dataMatch[1];
      }
      events.push({ event: eventMatch[1].trim(), data });
    }
  }
  return events;
}

async function liveTests() {
  if (!SERVICE_KEY) {
    console.log("INFO  SUPABASE_SERVICE_ROLE tidak diset → uji live dilewati.");
    return;
  }

  const email = `bioxip-ai-${Date.now()}@example.com`;
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
    const noBalance = await fetch(`${BASE}/api/ai/chat`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ question: "Bagaimana efektivitas metformin pada diabetes tipe 2?" }),
    });
    check("live: 402 tanpa saldo", noBalance.status === 402, String(noBalance.status));

    const granted = await grantCredits(userId, 50_000);
    check("live: grant Rp50.000", granted.ok, String(granted.status));

    const unsafe = await fetch(`${BASE}/api/ai/chat`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ question: "Resepkan antibiotik untuk pasien saya" }),
    });
    check("live: 422 input tidak aman", unsafe.status === 422, String(unsafe.status));

    const estimateResp = await fetch(`${BASE}/api/ai/estimate?max_tokens=1024&q=metformin`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const estimateBody = await estimateResp.json();
    check(
      "live: estimasi Rp wajar",
      estimateResp.status === 200 && estimateBody.estimate_idr >= 100 && estimateBody.estimate_idr <= 2000,
      String(estimateBody.estimate_idr),
    );

    const chatResp = await fetch(`${BASE}/api/ai/chat`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        question: "Apa bukti terbaru terapi TB resisten obat?",
        use_provider: false,
        max_tokens: 512,
      }),
    });
    const events = await readSse(chatResp);
    const names = events.map((event) => event.event);
    const done = events.find((event) => event.event === "done");
    check("live: SSE meta & delta", names.includes("meta") && names.includes("delta"), names.join(","));
    check("live: SSE citation", names.includes("citation"), names.join(","));
    check("live: SSE done", Boolean(done), names.join(","));
    check(
      "live: tagihan > 0 dan tidak melebihi estimasi",
      done?.data?.charged_idr > 0 && done?.data?.charged_idr <= (done?.data?.estimate_idr || 10 ** 9),
      `charged=${done?.data?.charged_idr} balance=${done?.data?.balance_idr}`,
    );

    const balanceRows = await userSelect(token, "credit_accounts?select=balance_micro_idr");
    const balanceIdr = Math.ceil(Number(balanceRows[0]?.balance_micro_idr || 0) / 1_000_000);
    check(
      "live: saldo berkurang sesuai tagihan",
      balanceIdr === 50_000 - Number(done?.data?.charged_idr || 0),
      `sisa=${balanceIdr} charged=${done?.data?.charged_idr}`,
    );

    const usageRows = await userSelect(
      token,
      "ai_usage_log?select=charged_micro_idr,margin_micro_idr,status&order=created_at.desc&limit=1",
    );
    check(
      "live: ai_usage_log tercatat dengan margin",
      usageRows.length >= 1 && Number(usageRows[0].charged_micro_idr) > 0 && Number(usageRows[0].margin_micro_idr) > 0,
      JSON.stringify(usageRows[0] || {}),
    );

    const rpmSet = await setUserRpm(userId, 1);
    check("live: set rpm user = 1", rpmSet);
    const limited = await fetch(`${BASE}/api/ai/chat`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ question: "Apa bukti terapi hipertensi?", use_provider: false, max_tokens: 256 }),
    });
    check("live: 429 rate limit per-user", limited.status === 429, String(limited.status));
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
