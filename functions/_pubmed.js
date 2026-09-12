const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const TIMEOUT_MS = 10000;
// NCBI E-utilities: 3 req/detik tanpa API key, 10 req/detik dengan API key.
const MIN_INTERVAL_NO_KEY_MS = 350;
const MIN_INTERVAL_WITH_KEY_MS = 100;

let lastCall = 0;

const CATEGORY_FILTERS = {
  therapy:
    '(randomized controlled trial[pt] OR controlled clinical trial[pt] OR meta-analysis[pt] OR systematic review[pt])',
  diagnosis:
    '(sensitivity and specificity[MeSH Terms] OR diagnosis[sh] OR diagnostic imaging[sh] OR predictive value of tests[MeSH Terms])',
  prognosis: '(prognosis[sh] OR survival analysis[MeSH Terms] OR cohort studies[MeSH Terms])',
  etiology: '(etiology[sh] OR risk factors[MeSH Terms] OR causality[MeSH Terms])',
};

export function minInterval(env) {
  return env?.NCBI_API_KEY ? MIN_INTERVAL_WITH_KEY_MS : MIN_INTERVAL_NO_KEY_MS;
}

async function throttle(env) {
  const now = Date.now();
  const wait = Math.max(0, lastCall + minInterval(env) - now);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCall = Date.now();
}

export function buildQuery(term, category) {
  const base = (term || "").trim();
  if (!base) return base;
  const filter = category ? CATEGORY_FILTERS[category] : null;
  return filter ? `${base} AND ${filter}` : base;
}

export async function searchPubmed(term, options = {}) {
  const { retmax = 25, category = null, env = {} } = options;
  const query = buildQuery(term, category);
  if (!query) return { total: 0, results: [] };

  const common = {
    db: "pubmed",
    retmode: "json",
    tool: "bioxip",
    email: env.NCBI_EMAIL || "admin@bioxip.id",
  };
  if (env.NCBI_API_KEY) common.api_key = env.NCBI_API_KEY;

  await throttle(env);
  const searchResp = await fetch(
    `${EUTILS}/esearch.fcgi?${new URLSearchParams({
      ...common,
      term: query,
      retmax: String(retmax),
      sort: "relevance",
    })}`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (!searchResp.ok) throw new Error(`pubmed esearch ${searchResp.status}`);
  const searchData = await searchResp.json();
  const ids = searchData.esearchresult?.idlist || [];
  const total = Number(searchData.esearchresult?.count || 0);
  if (!ids.length) return { total, results: [] };

  await throttle(env);
  const summaryResp = await fetch(
    `${EUTILS}/esummary.fcgi?${new URLSearchParams({ ...common, id: ids.join(",") })}`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (!summaryResp.ok) throw new Error(`pubmed esummary ${summaryResp.status}`);
  const summaryData = await summaryResp.json();
  const result = summaryData.result || {};
  const uids = result.uids || ids;

  const results = uids.map((uid) => mapSummary(uid, result[uid])).filter(Boolean);
  return { total, results };
}

function mapSummary(uid, item) {
  if (!item) return null;
  const doi = (item.articleids || []).find((a) => a.idtype === "doi")?.value || null;
  const published = parsePubDate(item.pubdate);
  return {
    id: `pubmed|${uid}`,
    doc_type: "paper",
    title: item.title || "",
    authors: (item.authors || []).map((a) => ({ given: "", family: a.name || "" })),
    journal: item.fulljournalname || item.source || null,
    year: published ? Number(published.slice(0, 4)) : null,
    published_on: published,
    doi,
    url: `https://pubmed.ncbi.nlm.nih.gov/${uid}/`,
    source: "pubmed",
    oa: { is_oa: false, provider: "pubmed" },
    citation_count: 0,
    external_ids: { pmid: uid, doi },
  };
}

/** "2024 May" / "2024" / "2024 May 12" → "2024-05-01". */
function parsePubDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const yearMatch = text.match(/\b(19|20)\d{2}\b/);
  if (!yearMatch) return null;
  const year = yearMatch[0];
  const months = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const monthMatch = text.toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/);
  const dayMatch = text.match(/\b(\d{1,2})\b(?!\s*$)/);
  const month = monthMatch ? months[monthMatch[1]] : "01";
  const day = dayMatch && Number(dayMatch[1]) <= 31 ? String(dayMatch[1]).padStart(2, "0") : "01";
  return `${year}-${month}-${day}`;
}
