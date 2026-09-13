/** Adapter OpenAlex (metadata + abstrak terbalik; gratis, tanpa API key). */
export const SOURCE = "openalex";
const ENDPOINT = "https://api.openalex.org/works";

function clean(value, limit = 0) {
  const text = String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!limit || text.length <= limit) return text;
  return text.slice(0, limit).replace(/\s+\S*$/, "") + "…";
}

/** OpenAlex memberi abstrak sebagai inverted index; rekonstruksi ke teks. */
export function reconstructAbstract(inverted) {
  if (!inverted || typeof inverted !== "object") return "";
  const words = [];
  for (const [word, positions] of Object.entries(inverted)) {
    for (const position of positions || []) words[Number(position)] = word;
  }
  return words.filter(Boolean).join(" ");
}

export function mapOpenAlexWork(work) {
  if (!work) return null;
  const title = clean(work.title || work.display_name);
  if (!title) return null;
  const doi = work.doi ? String(work.doi).replace(/^https?:\/\/doi\.org\//i, "").toLowerCase() : null;
  const primary = work.primary_location || {};
  const url = primary.landing_page_url || primary.pdf_url || (doi ? `https://doi.org/${doi}` : work.id || null);
  if (!url) return null;
  const authors = (work.authorships || [])
    .slice(0, 6)
    .map((authorship) => ({ given: authorship.author?.display_name || "", family: "" }))
    .filter((author) => author.given);
  const oa = work.open_access || {};
  return {
    id: `openalex|${work.id || doi || title}`,
    doc_type: "paper",
    title,
    authors,
    journal: clean(primary.source?.display_name) || null,
    year: work.publication_year ? Number(work.publication_year) || null : null,
    published_on: work.publication_date || null,
    doi,
    url,
    source: SOURCE,
    oa: { is_oa: Boolean(oa.is_oa), license: oa.license || null, provider: SOURCE },
    citation_count: Number(work.cited_by_count || 0),
    external_ids: { doi, openalex: work.id || null },
    abstract: clean(reconstructAbstract(work.abstract_inverted_index), 900),
  };
}

export async function searchOpenAlex(query, { limit = 10, indonesia = false, mailto } = {}) {
  const size = Math.min(Math.max(Number(limit) || 10, 1), 100);
  const params = new URLSearchParams({ search: String(query || ""), "per-page": String(size) });
  // Batasi field agar respons tidak membawa payload besar (abstrak terbalik) yang tak terpakai.
  params.set(
    "select",
    "id,doi,title,display_name,publication_year,publication_date,authorships,primary_location,open_access,cited_by_count,abstract_inverted_index",
  );
  if (mailto) params.set("mailto", mailto);
  if (indonesia) params.set("filter", "authorships.institutions.country_code:ID");
  const resp = await fetch(`${ENDPOINT}?${params.toString()}`, {
    signal: AbortSignal.timeout(8000),
    headers: { accept: "application/json", "user-agent": "bioXip/0.1" },
  });
  if (!resp.ok) throw new Error(`openalex ${resp.status}`);
  const data = await resp.json();
  const items = data.results || [];
  return {
    total: Number(data.meta?.count || items.length),
    results: items.map(mapOpenAlexWork).filter(Boolean),
    countsTowardTotal: false,
    pagination: {},
  };
}
