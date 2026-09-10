import { bearerToken, json } from "../../_credits.js";
import { CHANNELS, PACKAGES_IDR, createXenditCharge, xenditConfig } from "../../_xendit.js";

async function rpc(env, token, name, args) {
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
    body = { raw: text };
  }
  return { ok: resp.ok, status: resp.status, body };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const token = bearerToken(request);
  if (!token) return json({ error: "unauthorized" }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const amountIdr = Number(body.amount_idr);
  if (!PACKAGES_IDR.includes(amountIdr)) {
    return json({ error: "invalid_amount", allowed: PACKAGES_IDR }, 400);
  }
  const channel = String(body.channel || "QRIS").toUpperCase();
  if (!CHANNELS.includes(channel)) {
    return json({ error: "invalid_channel", allowed: CHANNELS }, 400);
  }

  const created = await rpc(env, token, "fn_topup_create", {
    p_amount_idr: amountIdr,
    p_channel: channel,
  });
  if (!created.ok) {
    const insufficient = String(created.body?.message || "").includes("unauthorized");
    return json({ error: insufficient ? "unauthorized" : "topup_failed", detail: created.body }, insufficient ? 401 : 502);
  }
  const topup = Array.isArray(created.body) ? created.body[0] : created.body;
  if (!topup?.topup_id) return json({ error: "topup_failed", detail: created.body }, 502);
  const topupStatus = topup.topup_status || topup.status || "pending";

  // Bila sudah punya payment_url (pending yang sama), tidak perlu memanggil provider lagi.
  if (topup.payment_url) {
    return json({
      topup_id: topup.topup_id,
      external_id: topup.external_id,
      amount_idr: Number(topup.amount_idr),
      credited_idr: Number(topup.credited_idr),
      channel: topup.channel,
      status: topupStatus,
      payment_url: topup.payment_url,
      expires_at: topup.expires_at,
      mode: xenditConfig(env).mode,
      reused: true,
    });
  }

  const charge = await createXenditCharge(env, {
    externalId: topup.external_id,
    amountIdr,
    channel,
    description: `Top-up saldo bioXip ${amountIdr}`,
  });

  if (charge.ok) {
    await rpc(env, token, "fn_topup_attach", {
      p_topup_id: topup.topup_id,
      p_payment_url: charge.payment_url,
      p_expires_at: charge.expires_at,
      p_raw: charge.raw || {},
    });
  }

  return json({
    topup_id: topup.topup_id,
    external_id: topup.external_id,
    amount_idr: amountIdr,
    credited_idr: Number(topup.credited_idr),
    channel,
    status: topupStatus,
    payment_url: charge.ok ? charge.payment_url : null,
    expires_at: charge.ok ? charge.expires_at : topup.expires_at,
    mode: xenditConfig(env).mode,
    provider_status: charge.ok ? "created" : "error",
    detail: charge.ok ? undefined : charge.error,
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const token = bearerToken(request);
  if (!token) return json({ error: "unauthorized" }, 401);

  const url = new URL(request.url);
  const topupId = url.searchParams.get("id");
  if (!topupId) return json({ error: "id_wajib" }, 400);

  const result = await rpc(env, token, "fn_topup_get", { p_topup_id: topupId });
  if (!result.ok) return json({ error: "lookup_failed", detail: result.body }, 502);
  if (!result.body?.found) return json({ error: "not_found" }, 404);
  return json(result.body);
}
