/**
 * Pembacaan pedoman lokal (guideline) dari Postgres via RPC `fn_guideline_search`.
 * Diaktifkan hanya bila env `GUIDELINE_DB=on`; default OFF → nol perubahan produksi.
 */
import { cacheGetJson, cacheKey, cachePutJson } from "./_cache.js";
import { rpc } from "./api/_db.js";

const CACHE_TTL = 3600;

const TIER_LABEL = {
  pnk: "PNPK",
  permenkes: "Permenkes",
  profesi: "Pedoman Profesi",
  regulator: "Regulator",
  epidemiologi: "Epidemiologi",
};

// Deteksi topik dari pertanyaan (untuk memanggil p_topik).
const TOPIC_HINTS = [
  [/tuberkulosis|\btb\b|\boat\b|rifampisin|isoniazid/i, "tb"],
  [/dengue|demam berdarah|\bdbd\b/i, "dbd"],
  [/\bhiv\b|aids|antiretroviral|\barv\b|odha/i, "hiv"],
];

export function guidelineEnabled(env) {
  return String(env?.GUIDELINE_DB || "").trim().toLowerCase() === "on";
}

export function detectGuidelineTopic(text) {
  const low = String(text || "").toLowerCase();
  for (const [pattern, topic] of TOPIC_HINTS) if (pattern.test(low)) return topic;
  return null;
}

export function mapGuidelineRow(row) {
  if (!row || row.id === undefined || row.id === null) return null;
  const label = TIER_LABEL[row.tier] || row.tier || "Pedoman";
  const year = row.berlaku_dari ? Number(String(row.berlaku_dari).slice(0, 4)) || null : null;
  return {
    id: `guideline|${row.id}`,
    doc_type: "guideline",
    title: row.ringkasan || label,
    authors: [],
    journal: row.sumber || label,
    year,
    published_on: row.berlaku_dari || null,
    doi: null,
    url: row.url || row.sumber_url || null,
    source: "guideline",
    source_tier: "official",
    oa: { is_oa: false, provider: "guideline" },
    citation_count: 0,
    external_ids: {},
    guideline: {
      tier: row.tier || null,
      label,
      edisi: row.edisi || null,
      locator: row.locator || null,
      sumber: row.sumber || null,
      score: typeof row.score === "number" ? row.score : null,
    },
  };
}

/** Ubah baris guideline hasil pencarian → item evidence untuk grounding AI. */
export function toEvidence(rows, offset = 0) {
  return (rows || []).map((row, index) => ({
    n: offset + index + 1,
    id: row.id,
    title: row.title,
    source: "guideline",
    journal: row.guideline?.sumber || row.journal || "Pedoman",
    year: row.year || null,
    url: row.url || null,
    snippet: row.title,
    guideline: row.guideline || null,
  }));
}

export async function searchGuidelines(env, query, origin, { topik = null, limit = 5 } = {}) {
  if (!guidelineEnabled(env)) return [];
  const q = String(query || "").trim();
  if (!q && !topik) return [];
  const key = cacheKey("guideline", { q: q.toLowerCase(), topik: topik || "", limit }, origin);
  const cached = await cacheGetJson(key).catch(() => null);
  if (cached) return cached.items || [];
  let rows = null;
  try {
    const result = await rpc(env, "fn_guideline_search", { p_query: q || null, p_topik: topik || null, p_limit: limit });
    if (Array.isArray(result)) rows = result;
  } catch {
    rows = null;
  }
  if (rows === null) return []; // jangan cache kegagalan
  const items = rows.map(mapGuidelineRow).filter(Boolean);
  await cachePutJson(key, { items }, CACHE_TTL).catch(() => undefined);
  return items;
}
