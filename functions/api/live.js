const DATA_SOURCES = [
  {
    id: "pubchem",
    name: "PubChem",
    endpoint: "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{query}/cids/JSON",
  },
  {
    id: "chembl",
    name: "ChEMBL",
    endpoint: "https://www.ebi.ac.uk/chembl/api/data/molecule/search?q={query}&format=json",
  },
  {
    id: "opentargets",
    name: "Open Targets",
    endpoint: "https://api.platform.opentargets.org/api/v4/graphql",
  },
];

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const query = (url.searchParams.get("q") || "").trim();
  if (!query) return json({ error: "param q wajib" }, 400);

  const out = {};
  const settled = await Promise.allSettled(
    DATA_SOURCES.map(async (src) => {
      if (src.id === "opentargets") {
        return fetchOpenTargets(query);
      }
      const endpoint = src.endpoint.replace("{query}", encodeURIComponent(query));
      const resp = await fetch(endpoint, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json();
    }),
  );

  settled.forEach((item, index) => {
    const id = DATA_SOURCES[index].id;
    out[id] = item.status === "fulfilled" ? item.value : { error: String(item.reason) };
  });

  return json(out);
}

async function fetchOpenTargets(query) {
  const body = JSON.stringify({
    query: `{ search(queryString: ${JSON.stringify(query)}) { total hits { id target { id approvedSymbol approvedName } } } }`,
  });
  const resp = await fetch("https://api.platform.opentargets.org/api/v4/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
