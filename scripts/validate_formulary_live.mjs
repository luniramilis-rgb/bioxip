// Uji live integrasi formulary (butuh kredensial Supabase). Opsional di CI.
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/validate_formulary_live.mjs
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const ANON = process.env.SUPABASE_ANON_KEY || "";

if (!SUPABASE_URL || !ANON) {
  console.log("INFO  SUPABASE_URL / SUPABASE_ANON_KEY tidak diset → uji live formulary dilewati.");
  process.exit(0);
}

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

async function get(path, headers = {}) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: ANON, ...headers } });
  let body = null;
  try {
    body = await resp.json();
  } catch {
    body = null;
  }
  return { status: resp.status, body };
}

async function rpc(name, args) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  let body = null;
  try {
    body = await resp.json();
  } catch {
    body = null;
  }
  return { status: resp.status, body };
}

const view = await get("drug_products_public?select=slug&limit=2000");
check("anon baca view publik", view.status === 200, String(view.status));

const base = await get("drug_products?select=slug&limit=1");
check("anon ditolak di tabel dasar", base.status === 401 || base.status === 403, String(base.status));

const hit = await rpc("fn_drug_search", { p_query: "parasetamol", p_limit: 5 });
const slugs = Array.isArray(hit.body) ? hit.body.map((row) => row.slug) : [];
check("RPC fn_drug_search: parasetamol ditemukan", hit.status === 200 && slugs.includes("parasetamol"), JSON.stringify(slugs));

const wildcard = await rpc("fn_drug_search", { p_query: "%", p_limit: 5 });
check("RPC fn_drug_search: wildcard '%' tidak membocorkan semua", wildcard.status === 200 && Array.isArray(wildcard.body) && wildcard.body.length === 0, String(wildcard.status));

const interactions = await get("drug_interactions_public?select=a_slug&limit=2000");
const monitoring = await get("drug_monitoring_public?select=drug_slug&limit=2000");
const drugCount = Array.isArray(view.body) ? view.body.length : 0;
check("coverage: obat ≥ 500", drugCount >= 500, String(drugCount));
check("coverage: interaksi ≥ 10", Array.isArray(interactions.body) && interactions.body.length >= 10, String(interactions.body?.length));
check("coverage: monitoring ≥ 100", Array.isArray(monitoring.body) && monitoring.body.length >= 100, String(monitoring.body?.length));

let failed = 0;
for (const item of results) {
  if (!item.ok) failed++;
  console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? " (" + item.detail + ")" : ""}`);
}
console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
