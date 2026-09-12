const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

function loadGuideline() {
  const state = { rpcImpl: async () => [], cache: new Map(), calls: [] };
  let source = fs.readFileSync(path.join(ROOT, "functions", "_guideline.js"), "utf8");
  source = source.replace(/^import\s+.*?;\s*$/gm, "").replace(/export /g, "");
  source += "\nglobalThis.__g = { guidelineEnabled, detectGuidelineTopic, mapGuidelineRow, searchGuidelines, toEvidence };\n";
  const sandbox = {
    console, JSON, String, Number, Boolean, Object, Array, Math, RegExp, Promise,
    rpc: async (env, name, args) => {
      state.calls.push({ name, args });
      return state.rpcImpl(env, name, args);
    },
    cacheKey: (ns, params) => `key:${ns}:${JSON.stringify(params)}`,
    cacheGetJson: async (key) => (state.cache.has(key) ? state.cache.get(key) : null),
    cachePutJson: async (key, value) => {
      state.cache.set(key, value);
      return "memory";
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "_guideline.js" });
  return { api: sandbox.__g, state };
}

const row = {
  id: 7,
  tier: "pnk",
  topik: "tb",
  ringkasan: "Terapi TB mengikuti paduan berbasis resistensi.",
  kelas: null,
  locator: "hal. 12",
  url: "https://kemkes.go.id/pnpk-tb",
  sumber: "PNPK Tuberkulosis",
  edisi: "2024",
  berlaku_dari: "2024-01-01",
  score: 0.9,
};

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

(async () => {
  {
    const { api } = loadGuideline();
    check("flag: default OFF", api.guidelineEnabled({}) === false);
    check("flag: on", api.guidelineEnabled({ GUIDELINE_DB: "on" }) === true);
    check("topik: tb/hiv/dbd terdeteksi", api.detectGuidelineTopic("terapi tuberkulosis") === "tb" && api.detectGuidelineTopic("ODHA antiretroviral") === "hiv" && api.detectGuidelineTopic("demam berdarah") === "dbd");
    check("topik: tak dikenal → null", api.detectGuidelineTopic("statin lipid") === null);
  }

  {
    const { api } = loadGuideline();
    const mapped = api.mapGuidelineRow(row);
    check("map: id & jenis", mapped.id === "guideline|7" && mapped.doc_type === "guideline" && mapped.source === "guideline");
    check("map: source_tier official (prioritas reranker)", mapped.source_tier === "official");
    check("map: badge tier/locator/edisi", mapped.guideline.tier === "pnk" && mapped.guideline.label === "PNPK" && mapped.guideline.locator === "hal. 12" && mapped.guideline.edisi === "2024");
    check("map: judul = ringkasan & url", mapped.title === row.ringkasan && mapped.url === row.url);
    check("map: row tanpa id → null", api.mapGuidelineRow({ ringkasan: "x" }) === null);
  }

  {
    const inst = loadGuideline();
    const off = await inst.api.searchGuidelines({ GUIDELINE_DB: "off" }, "tuberkulosis", "https://x.test");
    check("search: OFF → []", off.length === 0 && inst.state.calls.length === 0);
  }

  {
    const inst = loadGuideline();
    inst.state.rpcImpl = async () => [row];
    const items = await inst.api.searchGuidelines({ GUIDELINE_DB: "on" }, "terapi tuberkulosis", "https://x.test", { topik: "tb" });
    check("search: RPC items", items.length === 1 && items[0].source === "guideline");
    check("search: memanggil fn_guideline_search + topik", inst.state.calls[0].name === "fn_guideline_search" && inst.state.calls[0].args.p_topik === "tb");
  }

  {
    const inst = loadGuideline();
    inst.state.rpcImpl = async () => {
      throw new Error("rpc down");
    };
    const none = await inst.api.searchGuidelines({ GUIDELINE_DB: "on" }, "tuberkulosis", "https://x.test");
    check("search: error → [] & tidak di-cache", none.length === 0 && inst.state.cache.size === 0);
  }

  {
    const inst = loadGuideline();
    const empty = await inst.api.searchGuidelines({ GUIDELINE_DB: "on" }, "   ", "https://x.test");
    check("search: query kosong tanpa topik → []", empty.length === 0 && inst.state.calls.length === 0);
  }

  {
    const { api } = loadGuideline();
    const rows = [api.mapGuidelineRow(row)];
    const ev = api.toEvidence(rows, 2);
    check("evidence: bentuk item grounding", ev.length === 1 && ev[0].n === 3 && ev[0].source === "guideline" && ev[0].snippet === row.ringkasan);
    check("evidence: meta badge diteruskan", ev[0].guideline && ev[0].guideline.locator === "hal. 12");
  }

  let failed = 0;
  for (const item of results) {
    if (!item.ok) failed++;
    console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? " (" + item.detail + ")" : ""}`);
  }
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
  process.exit(failed ? 1 : 0);
})();
