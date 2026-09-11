/**
 * Uji produksi jalur AI: memastikan streaming token benar-benar bertahap.
 * Butuh SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE.
 *   node scripts/validate_ai_live.mjs "pertanyaan uji"
 */
const SUPABASE_URL = process.env.SUPABASE_URL || "https://nxlcosnksgbuvtiggjpw.supabase.co";
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE;
const BASE = (process.env.BIOXIP_BASE || "https://bioxip.pages.dev").replace(/\/$/, "");

if (!ANON || !SERVICE) {
  console.log("Lewati: SUPABASE_ANON_KEY dan SUPABASE_SERVICE_ROLE wajib diisi.");
  process.exit(0);
}

const QUESTION = process.argv[2] || "Apa bukti efektivitas vaksin dengue pada anak?";
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

async function admin(pathname, init = {}) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/admin/${pathname}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
  });
  const text = await resp.text();
  return { ok: resp.ok, status: resp.status, body: text ? JSON.parse(text) : null };
}

async function signIn(email, password) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return resp.ok ? (await resp.json()).access_token : null;
}

async function grant(userId, idr) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_credit_grant`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      p_user_id: userId,
      p_amount_micro_idr: idr * 1_000_000,
      p_reason: "topup",
      p_idempotency_key: `ai-live-${userId}`,
    }),
  });
  return resp.ok;
}

/** Baca SSE sambil mencatat waktu kemunculan tiap event. */
async function readStream(resp) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];
  const started = Date.now();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim();
      const dataLine = block.match(/^data:\s*(.+)$/m)?.[1];
      if (!event || !dataLine) continue;
      let data = null;
      try {
        data = JSON.parse(dataLine);
      } catch {
        data = dataLine;
      }
      events.push({ event, data, at: Date.now() - started });
    }
  }
  return events;
}

(async () => {
  const email = `bioxip-ailive-${Date.now()}@example.com`;
  const password = `Aa1!${Math.random().toString(36).slice(2)}xyz`;
  const created = await admin("users", {
    method: "POST",
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  check("live: buat user uji", created.ok, String(created.status));
  if (!created.ok) throw new Error("gagal membuat user uji");
  const userId = created.body.id;

  try {
    const token = await signIn(email, password);
    check("live: sign in", Boolean(token));
    if (!token) throw new Error("gagal sign in");
    check("live: grant Rp50.000", await grant(userId, 50_000));

    const started = Date.now();
    const resp = await fetch(`${BASE}/api/ai/chat`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ question: QUESTION, max_tokens: 1024 }),
    });
    const events = await readStream(resp);
    const total = Date.now() - started;

    const deltas = events.filter((e) => e.event === "delta");
    const done = events.find((e) => e.event === "done");
    const providerError = events.find((e) => e.event === "provider_error" || e.event === "provider_parse_error");
    const firstDelta = deltas[0]?.at ?? null;
    const text = deltas.map((e) => e.data.text).join("");

    check("live: HTTP 200", resp.status === 200, String(resp.status));
    check("live: mode llm", done?.data?.mode === "llm", String(done?.data?.mode));
    check("live: ada potongan delta", deltas.length >= 2, String(deltas.length));
    check(
      "live: token pertama datang jauh sebelum selesai (streaming nyata)",
      firstDelta !== null && firstDelta < total * 0.7,
      `pertama=${firstDelta}ms total=${total}ms`,
    );
    check("live: teks jawaban terbaca", text.length > 40, String(text.length));
    check("live: biaya > 0", Number(done?.data?.charged_idr) > 0, String(done?.data?.charged_idr));
    check("live: tidak ada error provider", !providerError, JSON.stringify(providerError?.data || {}));

    console.log(`\npertanyaan : ${QUESTION}`);
    console.log(`jawaban    : ${text.slice(0, 200).replace(/\n/g, " ")}…`);
    console.log(`token      : ${deltas.length} potongan · pertama ${firstDelta}ms · total ${total}ms`);
  } finally {
    await admin(`users/${userId}`, { method: "DELETE" });
  }

  let failed = 0;
  for (const item of results) {
    if (!item.ok) failed++;
    console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? " (" + item.detail + ")" : ""}`);
  }
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error("LIVE AI ERROR:", error.message);
  process.exit(1);
});
