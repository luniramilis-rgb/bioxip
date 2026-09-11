const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const FUNCTIONS = path.join(ROOT, "functions");
const catalogue = JSON.parse(fs.readFileSync(path.join(FUNCTIONS, "_drugs.json"), "utf8"));

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

function loadModule(context, file, exports) {
  let source = fs.readFileSync(path.join(FUNCTIONS, file), "utf8");
  source = source.replace(/^import\s+.*?;\s*$/gm, "");
  source = source.replace(/export default /g, "");
  source = source.replace(/export (const|function|async function) /g, "$1 ");
  const globals = exports.map((name) => `globalThis.${name} = ${name};`).join("\n");
  // Bungkus IIFE agar deklarasi const/let tidak bentrok antar-modul di konteks vm yang sama.
  const wrapped = `(function () {\n${source}\n${globals}\n})();`;
  vm.runInContext(wrapped, context, { filename: file });
}

// Fetch tiruan untuk Europe PMC, ClinicalTrials.gov, dan PubMed.
const fetchStub = async (url) => {
  const href = String(url);
  const jsonResponse = (body) => ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });

  if (href.includes("europepmc.org") || href.includes("/europepmc/")) {
    return jsonResponse({
      hitCount: 1,
      nextCursorMark: null,
      resultList: {
        result: [
          {
            id: "12345",
            source: "MED",
            pmid: "31234567",
            doi: "10.1000/xyz",
            title: "<b>Dengue</b> vaccine efficacy in children",
            abstractText: "Results: The vaccine significantly reduced hospitalization by 40%.",
            authorList: { author: [{ fullName: "Li Zhang" }] },
            journalInfo: { journal: { title: "Test Journal" }, issn: "1111-2222" },
            pubYear: "2024",
            firstPublicationDate: "2024-05-01",
            isOpenAccess: "Y",
            citedByCount: 12,
            pubTypeList: { pubType: ["journal article"] },
          },
        ],
      },
    });
  }
  if (href.includes("clinicaltrials.gov")) {
    return jsonResponse({ studies: [], totalCount: 0, nextPageToken: null });
  }
  if (href.includes("eutils.ncbi.nlm.nih.gov")) {
    return jsonResponse({ esearchresult: { idlist: [], count: 0 } });
  }
  return jsonResponse({});
};

async function main() {
  const sandbox = {
    console,
    fetch: fetchStub,
    URL,
    URLSearchParams,
    AbortSignal,
    setTimeout,
    clearTimeout,
    Response,
    Headers,
    Request,
    ReadableStream,
    TextEncoder,
    TextDecoder,
    crypto,
    Math,
    Date,
    String,
    Number,
    Array,
    Object,
    RegExp,
    JSON,
    Promise,
    Set,
    Map,
    isNaN,
    parseInt,
    parseFloat,
    globalThis: null,
    catalogue,
    DRUGS: catalogue.drugs,
    FORNAS: { edition: catalogue.edition, source_url: catalogue.source_url },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  loadModule(sandbox, "_dictionary.js", ["DICTIONARY", "expandQuery", "expandQueryEnglish", "suggest"]);
  loadModule(sandbox, "_terminology.js", [
    "TERMINOLOGY",
    "expandTerms",
    "expansionClause",
    "expansionSearchText",
    "detectQuestionType",
    "epmcFilterFor",
    "pubmedCategoryFor",
    "studyTypeWeight",
  ]);
  loadModule(sandbox, "_rank.js", ["rankResults", "rankScore", "relevanceScore", "sectionSnippet", "tokenize"]);
  loadModule(sandbox, "_drugs.js", ["DRUGS", "FORNAS", "findDrug", "findDrugsInText", "suggestDrugs"]);
  loadModule(sandbox, "_pubmed.js", ["searchPubmed", "buildQuery"]);
  loadModule(sandbox, "api/search.js", ["onRequestGet"]);

  const context = {
    request: { url: "https://bioxip.pages.dev/api/search?q=akurasi%20USG%20diagnosis%20kolesistitis&abstract=1" },
    env: {},
  };
  const response = await sandbox.onRequestGet(context);
  const body = await response.json();

  check("search onRequestGet: HTTP 200", response.status === 200, String(response.status));
  check("search: ada hasil", Array.isArray(body.results) && body.results.length >= 1, String(body.results?.length));
  check("search: judul bersih dari tag HTML", !/<[a-z/][^>]*>/i.test(body.results?.[0]?.title || ""), body.results?.[0]?.title || "");
  check("search: abstrak tersedia saat diminta", typeof body.results?.[0]?.abstract === "string", typeof body.results?.[0]?.abstract);
  check("search: total berupa angka", typeof body.total === "number", String(body.total));
  check("search: facet ada", Boolean(body.facets), JSON.stringify(body.facets || {}));

  // Tanpa parameter abstract → abstrak tidak boleh bocor.
  const plain = await sandbox.onRequestGet({
    request: { url: "https://bioxip.pages.dev/api/search?q=dengue" },
    env: {},
  });
  const plainBody = await plain.json();
  check(
    "search: abstrak disembunyikan bila tidak diminta",
    plainBody.results?.every((row) => row.abstract === undefined),
    JSON.stringify(plainBody.results?.[0] || {}),
  );

  // Kueri kosong → 400.
  const bad = await sandbox.onRequestGet({
    request: { url: "https://bioxip.pages.dev/api/search" },
    env: {},
  });
  check("search: q kosong ditolak 400", bad.status === 400, String(bad.status));

  let failed = 0;
  for (const item of results) {
    if (!item.ok) failed++;
    console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? " (" + item.detail + ")" : ""}`);
  }
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error("SMOKE ERROR:", error.message);
  process.exit(1);
});
