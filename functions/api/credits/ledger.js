import { bearerToken, json } from "../../_credits.js";

export async function onRequestGet(context) {
  try {
    const token = bearerToken(context.request);
    if (!token) return json({ error: "unauthorized" }, 401);

    const url = new URL(context.request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
    const resp = await fetch(
      `${context.env.SUPABASE_URL}/rest/v1/credit_ledger?select=delta_micro_idr,reason,ref_id,created_at&order=created_at.desc&limit=${limit}`,
      {
        headers: {
          apikey: context.env.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
    );
    if (!resp.ok) return json({ error: "unauthorized" }, resp.status === 401 ? 401 : 502);
    const rows = await resp.json();
    return json({
      items: rows.map((row) => ({
        delta_micro_idr: Number(row.delta_micro_idr),
        delta_idr: Math.round(Number(row.delta_micro_idr) / 1000) / 1000,
        reason: row.reason,
        ref_id: row.ref_id,
        created_at: row.created_at,
      })),
    });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}
