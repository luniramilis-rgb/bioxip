/**
 * Cache jawaban AI (L2) di Supabase Postgres.
 * L1 (Cloudflare Cache API) cepat tetapi per-colo dan bisa meleset;
 * L2 menjamin pertanyaan populer tidak memanggil LLM berulang kali.
 */

export function answerHash(text) {
  let hash = 0x811c9dc5;
  const value = String(text || "");
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function headers(env) {
  const key = env.SUPABASE_SERVICE_ROLE;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

function configured(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE);
}

export async function answerCacheGet(env, hash) {
  if (!configured(env) || !hash) return null;
  try {
    const resp = await fetch(
      `${env.SUPABASE_URL}/rest/v1/answer_cache?select=payload,expires_at&query_hash=eq.${encodeURIComponent(hash)}&limit=1`,
      { headers: { ...headers(env), Accept: "application/json" }, signal: AbortSignal.timeout(5000) },
    );
    if (!resp.ok) return null;
    const rows = await resp.json();
    const row = rows?.[0];
    if (!row?.payload) return null;
    if (row.expires_at && Date.parse(row.expires_at) < Date.now()) return null;

    // Catat pemakaian cache (best-effort, tidak memblokir respons).
    fetch(`${env.SUPABASE_URL}/rest/v1/rpc/fn_answer_cache_hit`, {
      method: "POST",
      headers: headers(env),
      body: JSON.stringify({ p_query_hash: hash }),
      signal: AbortSignal.timeout(3000),
    }).catch(() => null);

    return row.payload;
  } catch {
    return null;
  }
}

export async function answerCachePut(env, hash, payload, ttlSeconds) {
  if (!configured(env) || !hash || !payload?.answer) return false;
  const ttl = Math.max(60, Math.floor(ttlSeconds));
  try {
    const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/answer_cache`, {
      method: "POST",
      headers: {
        ...headers(env),
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        query_hash: hash,
        query_text: String(payload.question || "").slice(0, 300),
        payload,
        model: payload.model || null,
        expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
      }),
      signal: AbortSignal.timeout(5000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/** Bersihkan entri kedaluwarsa (dipanggil dari housekeeping). */
export async function answerCachePrune(env) {
  if (!configured(env)) return false;
  try {
    const resp = await fetch(
      `${env.SUPABASE_URL}/rest/v1/answer_cache?expires_at=lt.${encodeURIComponent(new Date().toISOString())}`,
      { method: "DELETE", headers: headers(env), signal: AbortSignal.timeout(10000) },
    );
    return resp.ok;
  } catch {
    return false;
  }
}
