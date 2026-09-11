/**
 * Pembacaan fakta obat dari Postgres (view publik) dengan cache edge + fallback.
 * Diaktifkan hanya bila env `FORMULARY_DB=on`. Saat OFF (default), semua pemanggil
 * jatuh ke katalog JSON bawaan → nol perubahan perilaku produksi.
 */
import { cacheGetJson, cacheKey, cachePutJson } from "./_cache.js";
import { select } from "./api/_db.js";

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

function slugify(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

async function queryDrug(env, query) {
  const q = clean(query);
  if (!q) return null;
  const fields = { select: "*", limit: "1" };
  // 1) slug persis → 2) INN persis → 3) nama mengandung.
  let rows = await select(env, "drug_products_public", { ...fields, slug: `eq.${slugify(q)}` }).catch(() => null);
  if (!rows || !rows.length) {
    rows = await select(env, "drug_products_public", { ...fields, inn: `ilike.${q}` }).catch(() => null);
  }
  if (!rows || !rows.length) {
    rows = await select(env, "drug_products_public", { ...fields, limit: "5", nama: `ilike.%${q}%` }).catch(() => null);
  }
  if (!rows || !rows.length) return null;
  return mapFormularyRow(rows[0]);
}

export async function findFormularyDrug(env, query, origin) {
  if (!formularyEnabled(env)) return null;
  const key = cacheKey("formulary", { q: clean(query).toLowerCase() }, origin);
  const cached = await cacheGetJson(key).catch(() => null);
  if (cached) return cached.miss ? null : cached.drug || null;
  const drug = await queryDrug(env, query).catch(() => null);
  await cachePutJson(key, drug ? { drug } : { miss: true }, drug ? CACHE_TTL : MISS_TTL).catch(() => undefined);
  return drug;
}

export async function suggestFormularyDrugs(env, query, origin, limit = 6) {
  if (!formularyEnabled(env)) return [];
  const q = clean(query);
  if (q.length < 2) return [];
  const key = cacheKey("formulary", { suggest: q.toLowerCase(), limit }, origin);
  const cached = await cacheGetJson(key).catch(() => null);
  if (cached) return cached.items || [];
  const rows = await select(env, "drug_products_public", {
    select: "slug,nama,inn,atc",
    or: `(nama.ilike.%${q}%,inn.ilike.%${q}%)`,
    order: "nama.asc",
    limit: String(limit),
  }).catch(() => []);
  const items = (rows || []).map((row) => ({ name: row.nama, slug: row.slug, inn: row.inn || null, atc: row.atc || null }));
  await cachePutJson(key, { items }, CACHE_TTL).catch(() => undefined);
  return items;
}
