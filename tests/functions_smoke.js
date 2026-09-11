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
let upstreamCalls = 0;
let degradedMode = false;
const fetchStub = async (url) => {
  const href = String(url);
  upstreamCalls += 1;
  const jsonResponse = (body) => ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });

  if (degradedMode) {
    if (href.includes("clinicaltrials.gov")) return jsonResponse({ studies: [], totalCount: 0, nextPageToken: null });
    if (href.includes("eutils.ncbi.nlm.nih.gov")) return jsonResponse({ esearchresult: { idlist: [], count: 0 } });
    return jsonResponse({ hitCount: 0, nextCursorMark: null, resultList: { result: [] } });
  }

  if (href.includes("europepmc.org") || href.includes("/europepmc/")) {
    const makeHit = (index) => ({
      id: String(12345 + index),
      source: "MED",
      pmid: String(31234567 + index),
      doi: `10.1000/xyz-${index}`,
      title: `<b>Dengue</b> vaccine efficacy in children (part ${index + 1})`,
      abstractText: "Results: The vaccine significantly reduced hospitalization by 40%.",
      authorList: { author: [{ fullName: "Li Zhang" }] },
      journalInfo: { journal: { title: "Test Journal" }, issn: "1111-2222" },
      pubYear: "2024",
      firstPublicationDate: "2024-05-01",
      isOpenAccess: "Y",
      citedByCount: 12,
      pubTypeList: { pubType: ["journal article"] },
    });
    return jsonResponse({
      hitCount: 3,
      nextCursorMark: null,
      resultList: { result: [makeHit(0), makeHit(1), makeHit(2)] },
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
  sandbox.__setDegraded = (value) => {
    degradedMode = Boolean(value);
  };
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
  loadModule(sandbox, "_cache.js", ["cacheKey", "cacheGetJson", "cachePutJson", "resetMemoryCache"]);
  loadModule(sandbox, "_drugs.js", ["DRUGS", "FORNAS", "findDrug", "findDrugsInText", "suggestDrugs"]);
  loadModule(sandbox, "_pubmed.js", ["searchPubmed", "buildQuery"]);
  loadModule(sandbox, "_literature/crossref.js", ["searchCrossref", "mapCrossrefItem"]);
  loadModule(sandbox, "_literature/doaj.js", ["searchDoaj", "mapDoajItem"]);
  loadModule(sandbox, "_literature/linkout.js", ["linkoutEntries"]);
  loadModule(sandbox, "_middleware.js", ["onRequest"]);
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

  // Fase 5: link-out opsional via LIT_SOURCES (default OFF → tidak muncul).
  const noLit = await sandbox.onRequestGet({
    request: { url: "https://bioxip.pages.dev/api/search?q=tuberkulosis%20indonesia&no_cache=1" },
    env: {},
  });
  const noLitBody = await noLit.json();
  check("lit: linkout tidak muncul saat flag OFF", !(noLitBody.results || []).some((row) => row.source === "onesearch"));

  const lit = await sandbox.onRequestGet({
    request: { url: "https://bioxip.pages.dev/api/search?q=tuberkulosis%20indonesia&per_page=5&no_cache=1" },
    env: { LIT_SOURCES: "linkout" },
  });
  const litBody = await lit.json();
  check(
    "lit: linkout OneSearch muncul saat flag ON",
    (litBody.results || []).some((row) => row.source === "onesearch" && row.linkout === true),
    JSON.stringify((litBody.results || []).map((row) => row.source)),
  );

  // Cache: permintaan identik kedua harus dilayani cache (tanpa memanggil upstream lagi).
  sandbox.resetMemoryCache();
  const before = upstreamCalls;
  const first = await sandbox.onRequestGet({
    request: { url: "https://bioxip.pages.dev/api/search?q=cache-test&per_page=5" },
    env: {},
  });
  const firstBody = await first.json();
  const afterFirst = upstreamCalls;
  const second = await sandbox.onRequestGet({
    request: { url: "https://bioxip.pages.dev/api/search?q=cache-test&per_page=5" },
    env: {},
  });
  const secondBody = await second.json();
  check("cache: permintaan pertama mengisi cache", firstBody.cache === "miss", String(firstBody.cache));
  check("cache: permintaan kedua dilayani cache", secondBody.cache === "hit", String(secondBody.cache));
  check(
    "cache: upstream tidak dipanggil ulang saat cache hit",
    upstreamCalls === afterFirst,
    `before=${before} afterFirst=${afterFirst} afterSecond=${upstreamCalls}`,
  );

  const bypass = await sandbox.onRequestGet({
    request: { url: "https://bioxip.pages.dev/api/search?q=cache-test&per_page=5&no_cache=1" },
    env: {},
  });
  const bypassBody = await bypass.json();
  check("cache: no_cache=1 melewati cache", bypassBody.cache === "bypass", String(bypassBody.cache));

  // no_cache tidak boleh mengisi cache: permintaan normal berikutnya tetap "miss".
  const afterBypass = await sandbox.onRequestGet({
    request: { url: "https://bioxip.pages.dev/api/search?q=bypass-not-stored&per_page=5&no_cache=1" },
    env: {},
  });
  await afterBypass.json();
  const normalAfter = await sandbox.onRequestGet({
    request: { url: "https://bioxip.pages.dev/api/search?q=bypass-not-stored&per_page=5" },
    env: {},
  });
  const normalAfterBody = await normalAfter.json();
  check("cache: no_cache tidak mengisi cache", normalAfterBody.cache === "miss", String(normalAfterBody.cache));

  // Cursor pagination harus jadi bagian kunci cache (beda cursor = beda entri).
  sandbox.resetMemoryCache();
  const pageOne = await sandbox.onRequestGet({
    request: { url: "https://bioxip.pages.dev/api/search?q=cursor-test&per_page=5&page=1" },
    env: {},
  });
  await pageOne.json();
  const pageTwoA = await sandbox.onRequestGet({
    request: { url: "https://bioxip.pages.dev/api/search?q=cursor-test&per_page=5&page=2&epmc_cursor=CURSOR-A" },
    env: {},
  });
  const pageTwoABody = await pageTwoA.json();
  const pageTwoB = await sandbox.onRequestGet({
    request: { url: "https://bioxip.pages.dev/api/search?q=cursor-test&per_page=5&page=2&epmc_cursor=CURSOR-B" },
    env: {},
  });
  const pageTwoBBody = await pageTwoB.json();
  check(
    "cache: cursor berbeda tidak berbagi entri cache",
    pageTwoABody.cache === "miss" && pageTwoBBody.cache === "miss",
    `A=${pageTwoABody.cache} B=${pageTwoBBody.cache}`,
  );
  const pageTwoAAgain = await sandbox.onRequestGet({
    request: { url: "https://bioxip.pages.dev/api/search?q=cursor-test&per_page=5&page=2&epmc_cursor=CURSOR-A" },
    env: {},
  });
  const pageTwoAAgainBody = await pageTwoAAgain.json();
  check(
    "cache: cursor sama dilayani cache pada permintaan berikutnya",
    pageTwoAAgainBody.cache === "hit",
    String(pageTwoAAgainBody.cache),
  );

  // Respons cacat (hasil < 3 / ada notes) tidak boleh disimpan ke cache.
  sandbox.resetMemoryCache();
  sandbox.__setDegraded(true);
  const degraded = await sandbox.onRequestGet({
    request: { url: "https://bioxip.pages.dev/api/search?q=degraded-test&per_page=5" },
    env: {},
  });
  const degradedBody = await degraded.json();
  const degradedAgain = await sandbox.onRequestGet({
    request: { url: "https://bioxip.pages.dev/api/search?q=degraded-test&per_page=5" },
    env: {},
  });
  const degradedAgainBody = await degradedAgain.json();
  sandbox.__setDegraded(false);
  check(
    "cache: respons degraded tidak disimpan",
    (degradedBody.results || []).length < 3 && degradedAgainBody.cache === "miss",
    `hasil=${(degradedBody.results || []).length} kedua=${degradedAgainBody.cache}`,
  );

  // Middleware: hanya respons 200 tanpa no_cache yang boleh ditandai cacheable.
  async function middlewareHeaders(url, status = 200) {
    const response = await sandbox.onRequest({
      request: { method: "GET", url },
      env: {},
      next: async () =>
        new Response(JSON.stringify({ ok: true }), { status, headers: { "Content-Type": "application/json" } }),
    });
    return response.headers.get("Cache-Control") || "";
  }

  const cacheable = await middlewareHeaders("https://bioxip.pages.dev/api/search?q=x", 200);
  check("middleware: search normal ditandai cacheable", cacheable.includes("max-age"), cacheable);
  const bypassHeaders = await middlewareHeaders("https://bioxip.pages.dev/api/search?q=x&no_cache=1", 200);
  check("middleware: no_cache=1 tidak cacheable", bypassHeaders.includes("no-store"), bypassHeaders);
  const errorHeaders = await middlewareHeaders("https://bioxip.pages.dev/api/search?q=x", 500);
  check("middleware: respons non-200 tidak cacheable", errorHeaders.includes("no-store"), errorHeaders);
  const aiHeaders = await middlewareHeaders("https://bioxip.pages.dev/api/ai/chat", 200);
  check("middleware: endpoint AI tetap no-store", aiHeaders.includes("no-store"), aiHeaders);

  let failed = 0;
  for (const item of results) {
    if (!item.ok) failed++;
    console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? " (" + item.detail + ")" : ""}`);
  }  console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error("SMOKE ERROR:", error.message);
  process.exit(1);
});
