/**
 * Pembacaan fakta obat dari Postgres (view publik) dengan cache edge + fallback.
 * Diaktifkan hanya bila env `FORMULARY_DB=on`. Saat OFF (default), semua pemanggil
 * jatuh ke katalog JSON bawaan → nol perubahan perilaku produksi.
 */
import { cacheGetJson, cacheKey, cachePutJson } from "./_cache.js";
import { rpc, select } from "./api/_db.js";

const CACHE_TTL = 3600;
const MISS_TTL = 300;

export function formularyEnabled(env) {
  return String(env?.FORMULARY_DB || "").trim().toLowerCase() === "on";
}

export function mapFormularyRow(row) {
  if (!row || !row.slug) return null;
  return {
    slug: row.slug,
    name: row.nama || row.slug,
    inn: row.inn || null,
    us_name: row.us_name || null,
    atc: row.atc || null,
    kelas: row.kelas || null,
    rute: row.rute || null,
    bentuk_sediaan: row.bentuk_sediaan || null,
    kekuatan: row.kekuatan || null,
    status_fornas: Boolean(row.status_fornas),
    source_tier: row.source_tier || null,
    aliases: [],
  };
}

function clean(value) {
  return String(value || "").trim();
}

/**
 * Bersihkan input sebelum masuk grammar filter PostgREST/LIKE: buang pemisah
 * `,()`, wildcard `%_`, escape `\`, dan kutip — mencegah manipulasi filter.
 */
function filterSafe(value) {
  return clean(value).replace(/[,()%_\\*"']/g, " ").replace(/\s+/g, " ").trim();
}

function slugify(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

async function safeSelect(env, table, params) {
  try {
    const rows = await select(env, table, params);
    return { ok: true, rows: rows || [] };
  } catch {
    return { ok: false, rows: [] };
  }
}

async function queryDrug(env, query) {
  const q = clean(query);
  if (!q) return { ok: true, drug: null };
  const safe = filterSafe(q);
  const attempts = [
    { slug: `eq.${slugify(q)}` },
    safe ? { inn: `ilike.${safe}` } : null,
    safe ? { nama: `ilike.%${safe}%` } : null,
  ].filter(Boolean);
  for (const filter of attempts) {
    const result = await safeSelect(env, "drug_products_public", { select: "*", limit: "5", ...filter });
    if (!result.ok) return { ok: false, drug: null }; // error → jangan dianggap miss
    if (result.rows.length) return { ok: true, drug: mapFormularyRow(result.rows[0]) };
  }
  return { ok: true, drug: null };
}

export async function findFormularyDrug(env, query, origin) {
  if (!formularyEnabled(env)) return null;
  const key = cacheKey("formulary", { q: clean(query).toLowerCase() }, origin);
  const cached = await cacheGetJson(key).catch(() => null);
  if (cached) return cached.miss ? null : cached.drug || null;
  const result = await queryDrug(env, query);
  if (!result.ok) return null; // kegagalan DB tidak boleh di-cache sebagai miss
  await cachePutJson(key, result.drug ? { drug: result.drug } : { miss: true }, result.drug ? CACHE_TTL : MISS_TTL).catch(() => undefined);
  return result.drug;
}

export async function suggestFormularyDrugs(env, query, origin, limit = 6) {
  if (!formularyEnabled(env)) return [];
  const q = clean(query);
  if (q.length < 2) return [];
  const key = cacheKey("formulary", { suggest: q.toLowerCase(), limit }, origin);
  const cached = await cacheGetJson(key).catch(() => null);
  if (cached) return cached.items || [];

  let ok = false;
  let rows = [];
  try {
    const result = await rpc(env, "fn_drug_search", { p_query: q, p_limit: limit });
    if (Array.isArray(result)) {
      rows = result;
      ok = true;
    }
  } catch {
    ok = false;
  }
  if (!ok) {
    const safe = filterSafe(q);
    const fallback = safe
      ? await safeSelect(env, "drug_products_public", {
          select: "slug,nama,inn,atc",
          or: `(nama.ilike.%${safe}%,inn.ilike.%${safe}%)`,
          order: "nama.asc",
          limit: String(limit),
        })
      : { ok: true, rows: [] };
    rows = fallback.rows;
    ok = fallback.ok;
  }
  const items = rows.map((row) => ({ name: row.nama, slug: row.slug, inn: row.inn || null, atc: row.atc || null }));
  if (ok) await cachePutJson(key, { items }, CACHE_TTL).catch(() => undefined);
  return items;
}

/**
 * Pencarian berperingkat (Fase 4). Mengembalikan drug ternormalisasi lengkap
 * dengan skor dari `fn_drug_search`. Dipakai untuk suggest & pencocokan longgar.
 */
export async function searchFormularyDrugs(env, query, origin, limit = 8) {
  if (!formularyEnabled(env)) return [];
  const q = clean(query);
  if (q.length < 2) return [];
  const key = cacheKey("formulary", { search: q.toLowerCase(), limit }, origin);
  const cached = await cacheGetJson(key).catch(() => null);
  if (cached) return cached.items || [];
  let rows = null;
  try {
    const result = await rpc(env, "fn_drug_search", { p_query: q, p_limit: limit });
    if (Array.isArray(result)) rows = result;
  } catch {
    rows = null;
  }
  if (rows === null) return []; // jangan cache kegagalan sebagai hasil kosong
  const items = rows.map(mapFormularyRow).filter(Boolean);
  await cachePutJson(key, { items }, CACHE_TTL).catch(() => undefined);
  return items;
}
