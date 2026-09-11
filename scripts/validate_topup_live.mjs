const SUPABASE_URL = "https://nxlcosnksgbuvtiggjpw.supabase.co";
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE;
const BASE = "https://bioxip.pages.dev";

async function createUser() {
  const email = `bioxip-pay-${Date.now()}@example.com`;
  const password = `Aa1!${Math.random().toString(36).slice(2)}xyz`;
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`createUser ${resp.status}: ${text.slice(0, 200)}`);
  return { id: JSON.parse(text).id, email, password };
}

async function signIn(email, password) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!resp.ok) throw new Error(`signIn ${resp.status}`);
  return (await resp.json()).access_token;
}

async function balance(token) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/credit_accounts?select=balance_micro_idr`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!resp.ok) return null;
  const rows = await resp.json();
  return Math.ceil(Number(rows[0]?.balance_micro_idr || 0) / 1_000_000);
}

(async () => {
  const user = await createUser();
  const token = await signIn(user.email, user.password);
  console.log(`saldo awal : Rp${await balance(token)}`);

  const topupResp = await fetch(`${BASE}/api/credits/topup`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ amount_idr: 100_000, channel: "QRIS" }),
  });
  const topup = await topupResp.json();
  console.log(`topup      : HTTP ${topupResp.status} | ${topup.external_id} | mode=${topup.mode} | status=${topup.status}`);
  console.log(`payment_url: ${topup.payment_url ? "ada" : "tidak ada"}`);

  const webhookResp = await fetch(`${BASE}/api/payments/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      external_id: topup.external_id,
      status: "SUCCEEDED",
      paid_at: new Date().toISOString(),
    }),
  });
  const webhook = await webhookResp.json();
  console.log(`webhook    : HTTP ${webhookResp.status} | applied=${webhook.applied} credited=${webhook.credited_idr} already=${webhook.already_paid}`);

  console.log(`saldo akhir: Rp${await balance(token)}`);

  const replay = await fetch(`${BASE}/api/payments/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ external_id: topup.external_id, status: "SUCCEEDED" }),
  });
  const replayBody = await replay.json();
  console.log(`webhook x2 : already_paid=${replayBody.already_paid} credited=${replayBody.credited_idr} (harus 0)`);
  console.log(`saldo tetap: Rp${await balance(token)}`);

  const ok = webhook.applied === true && (await balance(token)) === 100_000 && replayBody.already_paid === true;
  console.log(`\nKESIMPULAN: ${ok ? "ISI SALDO BERFUNGSI END-TO-END ✅" : "ADA MASALAH ❌"}`);

  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
    method: "DELETE",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  process.exit(ok ? 0 : 2);
})().catch((error) => {
  console.error("ERROR:", error.message);
  process.exit(1);
});
