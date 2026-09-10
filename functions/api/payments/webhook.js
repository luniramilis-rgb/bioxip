import { json } from "../../_credits.js";
import { verifyWebhook, xenditConfig } from "../../_xendit.js";

function extractPayment(payload) {
  const data = payload?.data || payload || {};
  const externalId = data.reference_id || data.external_id || payload?.external_id || null;
  const status = String(data.status || payload?.status || "").toUpperCase();
  const paidAt = data.paid_at || data.updated || data.created || payload?.paid_at || null;
  return { externalId, status, paidAt, data };
}

async function adminRpc(env, name, args) {
  const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const text = await resp.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { ok: resp.ok, status: resp.status, body };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const config = xenditConfig(env);

  const check = verifyWebhook(env, request.headers);
  if (!check.ok) {
    return json({ error: "invalid_signature", reason: check.reason }, 401);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { externalId, status, paidAt, data } = extractPayment(payload);
  if (!externalId) return json({ error: "external_id_missing" }, 400);

  // Mode mock: bila tidak ada service role, jangan menulis apa pun.
  if (!env.SUPABASE_SERVICE_ROLE) {
    return json({ mode: config.mode, received: true, applied: false, reason: "no_service_role" });
  }

  const rows = await adminRpc(env, "fn_topup_mark_paid", {
    p_external_id: externalId,
    p_status: status,
    p_paid_at: paidAt,
    p_raw: data,
  });

  if (!rows.ok) {
    return json({ error: "webhook_processing_failed", detail: rows.body }, 502);
  }

  const result = Array.isArray(rows.body) ? rows.body[0] : rows.body;
  return json({
    received: true,
    external_id: externalId,
    status,
    applied: result?.applied ?? false,
    credited_idr: result?.credited_idr ?? 0,
    already_paid: result?.already_paid ?? false,
  });
}
