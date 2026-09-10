const BASE = process.env.BIOXIP_BASE || "https://bioxip.pages.dev";
const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
}

async function ncbiPing() {
  const params = new URLSearchParams({
    db: "pubmed",
    term: "tuberculosis",
    retmode: "json",
    retmax: "3",
    tool: "bioxip",
    email: process.env.NCBI_EMAIL || "admin@bioxip.id",
  });
  if (process.env.NCBI_API_KEY) params.set("api_key", process.env.NCBI_API_KEY);
  const resp = await fetch(`${EUTILS}/esearch.fcgi?${params}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`esearch ${resp.status}`);
  const data = await resp.json();
  const ids = data.esearchresult?.idlist || [];
  const count = Number(data.esearchresult?.count || 0);
  return { ids, count };
}

async function productionSearch(term) {
  const resp = await fetch(`${BASE}/api/search?q=${encodeURIComponent(term)}&per_page=50`, {
    headers: { Accept: "application/json" },
  });
  const data = await resp.json();
  return { status: resp.status, data };
}

function duplicateKeys(results) {
  const seen = new Map();
  let duplicates = 0;
  for (const row of results) {
    const key = (row.doi && `doi:${String(row.doi).toLowerCase()}`) || row.external_ids?.pmid || row.id;
    if (seen.has(key)) duplicates++;
    seen.set(key, true);
  }
  return duplicates;
}

(async () => {
  const ping = await ncbiPing();
  check("NCBI E-utilities dapat diakses", ping.count > 0 && ping.ids.length > 0, `count=${ping.count}`);

  for (const term of ["tuberculosis", "dengue", "stunting", "hypertension"]) {
    const { status, data } = await productionSearch(term);
    const rows = data?.results || [];
    const sources = new Set(rows.map((r) => r.source));
    check(
      `search "${term}": sumber pubmed muncul`,
      status === 200 && sources.has("pubmed"),
      [...sources].join("/"),
    );
    check(
      `search "${term}": ada hasil europepmc juga`,
      sources.has("europepmc"),
      [...sources].join("/"),
    );
    check(`search "${term}": tidak ada duplikat DOI/PMID`, duplicateKeys(rows) === 0, `dup=${duplicateKeys(rows)}`);
  }

  let failed = 0;
  for (const item of results) {
    if (!item.ok) failed++;
    console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? " (" + item.detail + ")" : ""}`);
  }
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error("VALIDATOR ERROR:", error.message);
  process.exit(1);
});
