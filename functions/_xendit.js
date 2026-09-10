import pricing from "./_pricing.json";

const XENDIT_BASE = "https://api.xendit.co";
const TIMEOUT_MS = 15000;

export const PACKAGES_IDR = pricing.packages_idr;
export const CHANNELS = pricing.channels;

export function xenditConfig(env) {
  return {
    secretKey: env.XENDIT_SECRET_KEY || "",
    callbackToken: env.XENDIT_CALLBACK_TOKEN || "",
    mode: env.XENDIT_SECRET_KEY ? "live" : "mock",
  };
}

export function xenditReady(env) {
  return Boolean(xenditConfig(env).secretKey);
}

function authHeader(env) {
  return `Basic ${btoa(`${xenditConfig(env).secretKey}:`)}`;
}

export async function createXenditCharge(env, { externalId, amountIdr, channel, description }) {
  if (!xenditReady(env)) {
    // Mode mock: kembalikan instruksi lokal agar alur end-to-end dapat diuji tanpa kunci.
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const payloadByChannel = {
      QRIS: {
        qr_string: `MOCK-QRIS-${externalId}`,
        payment_url: `https://sandbox.bioxip.local/qris/${externalId}`,
      },
      VA: {
        bank_code: "BCA",
        account_number: `8808${String(Date.now()).slice(-8)}`,
        payment_url: `https://sandbox.bioxip.local/va/${externalId}`,
      },
      EWALLET: {
        ewallet_type: "OVO",
        checkout_url: `https://sandbox.bioxip.local/ewallet/${externalId}`,
      },
    };
    return {
      ok: true,
      provider: "mock",
      external_id: externalId,
      status: "PENDING",
      expires_at: expires,
      payment_url: payloadByChannel[channel]?.payment_url || null,
      raw: { mode: "mock", channel, amount_idr: amountIdr, description, detail: payloadByChannel[channel] },
    };
  }

  const resp = await fetch(`${XENDIT_BASE}/payment_requests`, {
    method: "POST",
    headers: {
      Authorization: authHeader(env),
      "Content-Type": "application/json",
      "api-version": "2024-11-11",
    },
    body: JSON.stringify({
      reference_id: externalId,
      amount: amountIdr,
      currency: "IDR",
      description,
      payment_method: { type: channel },
      metadata: { product: "bioxip-topup" },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const text = await resp.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }

  if (!resp.ok) {
    return { ok: false, provider: "xendit", status: resp.status, error: body };
  }

  const action =
    body?.actions?.find((item) => ["PRESENT", "PAY"].includes(String(item.action).toUpperCase())) || body?.actions?.[0];

  return {
    ok: true,
    provider: "xendit",
    external_id: externalId,
    status: body?.status || "PENDING",
    expires_at: body?.expires_at || new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    payment_url: action?.url || body?.payment_method?.url || null,
    raw: body,
  };
}

export function verifyWebhook(env, headers) {
  const config = xenditConfig(env);
  if (!config.callbackToken) return { ok: !config.secretKey, reason: "no_callback_token_configured" };
  const provided = headers.get("x-callback-token") || headers.get("X-Callback-Token") || "";
  return { ok: provided === config.callbackToken, reason: provided === config.callbackToken ? "ok" : "bad_token" };
}
