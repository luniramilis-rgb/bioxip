/** Adapter DOAJ (metadata-only, jurnal akses terbuka; punya field lisensi). */
export const SOURCE = "doaj";
const ENDPOINT = "https://doaj.org/api/search/articles";

function clean(value, limit = 0) {
  const text = String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!limit || text.length <= limit) return text;
  return text.slice(0, limit).replace(/\s+\S*$/, "") + "…";
}

export function mapDoajItem(item) {
  const b = item?.bibjson || {};
  const title = clean(b.title);
  if (!title) return null;
  const identifiers = b.identifier || [];
  const doi = identifiers.find((i) => String(i.type || "").toLowerCase() === "doi")?.id || null;
  const links = b.link || [];
  const url = (links.find((l) => String(l.type || "").toLowerCase() === "fulltext") || links[0])?.url || null;
  if (!url && !doi) return null;
  const license = (b.license && b.license[0] && b.license[0].type) || null;
  const authors = (b.author || []).map((a) => ({ given: a.name || "", family: "" }));
  return {
    id: `doaj|${doi ? `doi:${String(doi).toLowerCase()}` : item.id || title}`,
    doc_type: "paper",
    title,
    authors,
    journal: clean(b.journal?.title) || null,
    year: b.year ? Number(b.year) || null : null,
    published_on: null,
    doi,
    url: url || `https://doi.org/${doi}`,
    source: SOURCE,
    oa: { is_oa: true, license, provider: SOURCE },
    citation_count: 0,
    external_ids: { doi, issn: b.journal?.issn?.[0] || null },
    abstract: clean(b.abstract, 900),
  };
}

export async function searchDoaj(query, { limit = 10, indonesia = false } = {}) {
  const size = Math.min(Math.max(Number(limit) || 10, 1), 100);
  const q = indonesia ? `(${query}) AND bibjson.journal.country:"Indonesia"` : String(query || "");
  const resp = await fetch(`${ENDPOINT}/${encodeURIComponent(q)}?pageSize=${size}`, {
    signal: AbortSignal.timeout(8000),
    headers: { accept: "application/json", "user-agent": "bioXip/0.1" },
  });
  if (!resp.ok) throw new Error(`doaj ${resp.status}`);
  const data = await resp.json();
  const items = data.results || [];
  return {
    total: Number(data.total || items.length),
    results: items.map(mapDoajItem).filter(Boolean),
    countsTowardTotal: false,
    pagination: {},
  };
}
