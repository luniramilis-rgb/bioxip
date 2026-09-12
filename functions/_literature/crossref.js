/** Adapter Crossref (metadata-only). API publik; sertakan mailto (polite pool). */
export const SOURCE = "crossref";
const ENDPOINT = "https://api.crossref.org/works";

function clean(value, limit = 0) {
  const text = String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!limit || text.length <= limit) return text;
  return text.slice(0, limit).replace(/\s+\S*$/, "") + "…";
}

export function mapCrossrefItem(item) {
  if (!item) return null;
  const title = clean(Array.isArray(item.title) ? item.title[0] : item.title);
  const doi = item.DOI ? String(item.DOI).toLowerCase() : null;
  const url = item.URL || (doi ? `https://doi.org/${doi}` : null);
  if (!title || !url) return null;
  const issued = item.issued?.["date-parts"]?.[0];
  const year = Array.isArray(issued) && issued[0] ? Number(issued[0]) || null : null;
  const license = item.license?.[0]?.URL || null;
  const authors = (item.author || []).map((a) => ({ given: a.given || "", family: a.family || "" }));
  return {
    id: `crossref|${doi ? `doi:${doi}` : url}`,
    doc_type: "paper",
    title,
    authors,
    journal: clean(Array.isArray(item["container-title"]) ? item["container-title"][0] : item["container-title"]) || null,
    year,
    published_on: null,
    doi: item.DOI || null,
    url,
    source: SOURCE,
    oa: { is_oa: Boolean(license), license, provider: SOURCE },
    citation_count: Number(item["is-referenced-by-count"]) || 0,
    external_ids: { doi: item.DOI || null, issn: item.ISSN?.[0] || null },
    abstract: clean(item.abstract, 900),
  };
}

export async function searchCrossref(query, { limit = 10, indonesia = false, mailto = "" } = {}) {
  const rows = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const params = new URLSearchParams({ "query.bibliographic": String(query || ""), rows: String(rows) });
  if (indonesia) params.set("query.affiliation", "Indonesia");
  if (mailto) params.set("mailto", mailto);
  const resp = await fetch(`${ENDPOINT}?${params}`, {
    signal: AbortSignal.timeout(8000),
    headers: { accept: "application/json", "user-agent": mailto ? `bioXip/0.1 (mailto:${mailto})` : "bioXip/0.1" },
  });
  if (!resp.ok) throw new Error(`crossref ${resp.status}`);
  const data = await resp.json();
  const items = data?.message?.items || [];
  return {
    total: Number(data?.message?.["total-results"] || items.length),
    results: items.map(mapCrossrefItem).filter(Boolean),
    countsTowardTotal: false,
    pagination: {},
  };
}
