import { microToIdr } from "./_pricing.js";

export function bearerToken(request) {
  const header = request.headers.get("Authorization") || request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

async function rpc(env, token, name, args = {}) {
  const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const text = await resp.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: resp.ok, status: resp.status, body };
}

export async function ensureAccount(env, token) {
  return rpc(env, token, "fn_credit_ensure_account");
}

export function holdCredits(env, token, requestId, amountMicro) {
  return rpc(env, token, "fn_credit_hold", {
    p_request_id: requestId,
    p_amount_micro_idr: amountMicro,
  });
}

export function settleCredits(env, token, requestId, chargedMicro) {
  return rpc(env, token, "fn_credit_settle", {
    p_request_id: requestId,
    p_charged_micro_idr: chargedMicro,
  });
}

export function refundCredits(env, token, requestId) {
  return rpc(env, token, "fn_credit_refund", { p_request_id: requestId });
}

export async function fetchAccount(env, token) {
  const resp = await fetch(
    `${env.SUPABASE_URL}/rest/v1/credit_accounts?select=balance_micro_idr,plan,updated_at&limit=1`,
    {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    },
  );
  if (!resp.ok) return null;
  const rows = await resp.json();
  const row = rows[0];
  if (!row) return { balance_micro_idr: 0, plan: "free", updated_at: null };
  return row;
}

export function accountPayload(row) {
  const balanceIdr = microToIdr(Number(row?.balance_micro_idr || 0));
  return {
    balance_idr: balanceIdr,
    balance_micro_idr: Number(row?.balance_micro_idr || 0),
    plan: row?.plan || "free",
    ai_locked: balanceIdr <= 0,
    currency: "IDR",
    updated_at: row?.updated_at || null,
  };
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
