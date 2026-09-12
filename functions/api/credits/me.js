import { accountPayload, bearerToken, ensureAccount, fetchAccount, fetchUserEmail, isAdminEmail, json } from "../../_credits.js";

export async function onRequestGet(context) {
  try {
    const token = bearerToken(context.request);
    if (!token) return json({ error: "unauthorized" }, 401);

    const ensured = await ensureAccount(context.env, token);
    if (!ensured.ok) {
      return json({ error: "unauthorized", detail: ensured.body }, ensured.status === 401 ? 401 : 400);
    }
    const row = await fetchAccount(context.env, token);
    if (!row) return json({ error: "account_unavailable" }, 502);
    const allowlist = String(context.env.ADMIN_EMAILS || "").trim();
    const isAdmin = allowlist ? isAdminEmail(await fetchUserEmail(context.env, token), allowlist) : false;
    return json({ ...accountPayload(row), is_admin: isAdmin, ai_locked: !isAdmin && accountPayload(row).ai_locked });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}
