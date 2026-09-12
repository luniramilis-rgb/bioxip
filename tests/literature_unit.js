const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

function loadLit(relative, exports, extra = {}) {
  let source = fs.readFileSync(path.join(ROOT, "functions", "_literature", relative), "utf8");
  source = source.replace(/^import\s+.*?;\s*$/gm, "").replace(/export /g, "");
  const names = exports.join(", ");
  source += `\nglobalThis.__m = { ${names} };\n`;
  const sandbox = { console, JSON, String, Number, Boolean, Object, Array, Math, RegExp, Promise, URLSearchParams, AbortSignal, ...extra };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: relative });
  return { api: sandbox.__m, sandbox };
}

(async () => {
  // --- Crossref ---
  {
    const { api } = loadLit("crossref.js", ["mapCrossrefItem", "searchCrossref"]);
    const row = api.mapCrossrefItem({
      DOI: "10.1000/ABC.1",
      title: ["Efektivitas metformin"],
      author: [{ given: "A", family: "Budi" }],
      "container-title": ["Jurnal Contoh"],
      issued: { "date-parts": [[2024, 5, 1]] },
      URL: "https://doi.org/10.1000/abc.1",
      license: [{ URL: "https://creativecommons.org/licenses/by/4.0/" }],
    });
    check("crossref: map fields", row && row.doi === "10.1000/ABC.1" && row.source === "crossref" && row.year === 2024 && row.oa.is_oa === true);
    check("crossref: title kosong → null", api.mapCrossrefItem({ URL: "https://x.test" }) === null);
    const tdm = api.mapCrossrefItem({ DOI: "10.9/tdm", title: ["T"], URL: "https://doi.org/10.9/tdm", license: [{ URL: "http://www.springer.com/tdm" }] });
    check("crossref: lisensi TDM bukan OA", tdm && tdm.oa.is_oa === false && tdm.oa.license === "http://www.springer.com/tdm");
    const cc = api.mapCrossrefItem({ DOI: "10.9/cc", title: ["T"], URL: "https://doi.org/10.9/cc", license: [{ URL: "https://creativecommons.org/licenses/by/4.0/" }] });
    check("crossref: lisensi CC = OA", cc && cc.oa.is_oa === true);

    let called = "";
    const { api: api2 } = loadLit("crossref.js", ["searchCrossref"], {
      fetch: async (url) => {
        called = String(url);
        return { ok: true, status: 200, json: async () => ({ message: { "total-results": 1, items: [{ DOI: "10.1/x", title: ["T"], URL: "https://doi.org/10.1/x" }] } }) };
      },
    });
    const out = await api2.searchCrossref("metformin", { limit: 5, indonesia: true, mailto: "a@b.c" });
    const decoded = decodeURIComponent(called);
    check("crossref: request URL", decoded.includes("query.bibliographic=metformin") && decoded.includes("query.affiliation=Indonesia") && decoded.includes("mailto=a@b.c"));
    check("crossref: hasil ternormalisasi", out.results.length === 1 && out.results[0].source === "crossref" && out.countsTowardTotal === false);
  }

  // --- DOAJ ---
  {
    const { api } = loadLit("doaj.js", ["mapDoajItem", "searchDoaj"]);
    const row = api.mapDoajItem({
      id: "doaj-1",
      bibjson: {
        title: "Diabetes di Indonesia",
        year: "2023",
        identifier: [{ type: "doi", id: "10.2/xyz" }],
        link: [{ type: "fulltext", url: "https://journal.example/xyz" }],
        journal: { title: "Jurnal Nusantara", issn: ["1234-5678"] },
        author: [{ name: "Siti" }],
        license: [{ type: "CC BY" }],
      },
    });
    check("doaj: map fields", row && row.doi === "10.2/xyz" && row.journal === "Jurnal Nusantara" && row.oa.is_oa === true && row.oa.license === "CC BY");
    check("doaj: title kosong → null", api.mapDoajItem({ bibjson: {} }) === null);

    let called = "";
    const { api: api2 } = loadLit("doaj.js", ["searchDoaj"], {
      fetch: async (url) => {
        called = String(url);
        return { ok: true, status: 200, json: async () => ({ total: 1, results: [{ bibjson: { title: "T", link: [{ type: "fulltext", url: "https://x.test/1" }] } }] }) };
      },
    });
    await api2.searchDoaj("dengue", { limit: 3, indonesia: true });
    check("doaj: request URL + filter Indonesia", called.includes("pageSize=3") && decodeURIComponent(called).includes('bibjson.journal.country:"Indonesia"'));
  }

  // --- Link-out ---
  {
    const { api } = loadLit("linkout.js", ["linkoutEntries"]);
    const base = api.linkoutEntries("tuberkulosis", {});
    check("linkout: OneSearch selalu ada", base.length === 1 && base[0].source === "onesearch" && base[0].linkout === true && base[0].url.includes("onesearch.id"));
    const withGaruda = api.linkoutEntries("tuberkulosis", { GARUDA_SEARCH_URL: "https://garuda.example/search?q=" });
    check("linkout: Garuda hanya bila env diisi", withGaruda.length === 2 && withGaruda[1].source === "garuda" && withGaruda[1].url === "https://garuda.example/search?q=tuberkulosis");
    check("linkout: query kosong → []", api.linkoutEntries("  ", {}).length === 0);
  }

  // --- Neliti OAI (harvest, bukan live search) ---
  {
    const { api } = loadLit("neliti_oai.js", ["buildOaiUrl", "parseOaiDc"]);
    const url = api.buildOaiUrl({ set: "jurnal", from: "2024-01-01" });
    check("neliti: buildOaiUrl ListRecords", url.includes("verb=ListRecords") && url.includes("metadataPrefix=oai_dc") && url.includes("set=jurnal") && url.includes("from=2024-01-01"));
    check("neliti: resumption token", api.buildOaiUrl({ resumptionToken: "abc" }).includes("resumptionToken=abc"));

    const xml = `<?xml version="1.0"?><OAI-PMH><ListRecords>
      <record><header><identifier>oai:neliti:1</identifier></header>
      <metadata><oai_dc:dc>
        <dc:title>Studi Dengue Indonesia</dc:title>
        <dc:creator>Budi</dc:creator>
        <dc:date>2024-03-01</dc:date>
        <dc:identifier>https://www.neliti.com/publications/1</dc:identifier>
        <dc:rights>CC BY-NC</dc:rights>
      </oai_dc:dc></metadata></record>
      <resumptionToken>tok123</resumptionToken>
    </ListRecords></OAI-PMH>`;
    const parsed = api.parseOaiDc(xml);
    check("neliti: parse record", parsed.records.length === 1 && parsed.records[0].title === "Studi Dengue Indonesia" && parsed.records[0].year === 2024 && parsed.records[0].source === "neliti");
    check("neliti: parse resumptionToken", parsed.resumptionToken === "tok123");
  }

  let failed = 0;
  for (const item of results) {
    if (!item.ok) failed++;
    console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? " (" + item.detail + ")" : ""}`);
  }
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
  process.exit(failed ? 1 : 0);
})();
