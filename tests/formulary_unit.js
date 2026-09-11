const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

function loadFormulary() {
  const state = { selectImpl: async () => [], rpcImpl: async () => [], cache: new Map(), calls: [], rpcCalls: [] };
  let source = fs.readFileSync(path.join(ROOT, "functions", "_formulary.js"), "utf8");
  source = source.replace(/^import\s+.*?;\s*$/gm, "").replace(/export /g, "");
  source += "\nglobalThis.__f = { formularyEnabled, mapFormularyRow, findFormularyDrug, suggestFormularyDrugs, searchFormularyDrugs };\n";
  const sandbox = {
    console,
    JSON,
    String,
    Number,
    Boolean,
    Object,
    Array,
    Math,
    RegExp,
    Promise,
    select: async (env, table, params) => {
      state.calls.push({ table, params });
      return state.selectImpl(env, table, params);
    },
    rpc: async (env, name, args) => {
      state.rpcCalls.push({ name, args });
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
  vm.runInContext(source, sandbox, { filename: "_formulary.js" });
  return { api: sandbox.__f, state };
}

const row = {
  slug: "parasetamol",
  nama: "Parasetamol",
  inn: "paracetamol",
  us_name: "acetaminophen",
  atc: "N02BE01",
  kelas: "Analgesik",
  rute: "Oral",
  bentuk_sediaan: "TABLET",
  kekuatan: "500 MILIGRAM",
  status_fornas: true,
  source_tier: "official",
};

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

(async () => {
  // --- flag ---
  {
    const { api } = loadFormulary();
    check("flag: default OFF", api.formularyEnabled({}) === false);
    check("flag: 'off' OFF", api.formularyEnabled({ FORMULARY_DB: "off" }) === false);
    check("flag: 'on' ON", api.formularyEnabled({ FORMULARY_DB: "on" }) === true);
    check("flag: 'ON' case-insensitive", api.formularyEnabled({ FORMULARY_DB: "ON" }) === true);
  }

  // --- mapping ---
  {
    const { api } = loadFormulary();
    const mapped = api.mapFormularyRow(row);
    check("map: fields", mapped.slug === "parasetamol" && mapped.name === "Parasetamol" && mapped.inn === "paracetamol" && mapped.atc === "N02BE01");
    check("map: source_tier + status", mapped.source_tier === "official" && mapped.status_fornas === true);
    check("map: row tanpa slug → null", api.mapFormularyRow({ nama: "x" }) === null);
  }

  // --- find: flag OFF tidak menyentuh DB ---
  {
    const { api, state } = loadFormulary();
    const drug = await api.findFormularyDrug({ FORMULARY_DB: "off" }, "parasetamol", "https://x.test");
    check("find: OFF → null", drug === null);
    check("find: OFF tidak query DB", state.calls.length === 0);
  }

  // --- find: slug hit ---
  {
    const inst = loadFormulary();
    inst.state.selectImpl = async (env, table, params) => (params.slug ? [row] : []);
    const drug = await inst.api.findFormularyDrug({ FORMULARY_DB: "on" }, "parasetamol", "https://x.test");
    check("find: slug hit", Boolean(drug) && drug.slug === "parasetamol");
    check("find: slug hit query slug", inst.state.calls[0] && String(inst.state.calls[0].params.slug) === "eq.parasetamol");
  }

  // --- find: fallback inn lalu nama ---
  {
    const inst = loadFormulary();
    inst.state.selectImpl = async (env, table, params) => (params.inn ? [row] : []);
    const drug = await inst.api.findFormularyDrug({ FORMULARY_DB: "on" }, "paracetamol", "https://x.test");
    check("find: fallback ke inn", Boolean(drug) && drug.slug === "parasetamol");

    const inst2 = loadFormulary();
    inst2.state.selectImpl = async (env, table, params) => (params.nama ? [row] : []);
    const drug2 = await inst2.api.findFormularyDrug({ FORMULARY_DB: "on" }, "parase", "https://x.test");
    check("find: fallback ke nama", Boolean(drug2) && drug2.slug === "parasetamol");
  }

  // --- find: DB error → null (pemanggil fallback ke JSON) ---
  {
    const inst = loadFormulary();
    inst.state.selectImpl = async () => {
      throw new Error("db down");
    };
    const drug = await inst.api.findFormularyDrug({ FORMULARY_DB: "on" }, "parasetamol", "https://x.test");
    check("find: DB error → null", drug === null);
  }

  // --- find: cache hit & negative cache ---
  {
    const key = "key:formulary:" + JSON.stringify({ q: "parasetamol" });

    const inst = loadFormulary();
    inst.state.cache.set(key, { drug: { slug: "cached" } });
    const drug = await inst.api.findFormularyDrug({ FORMULARY_DB: "on" }, "parasetamol", "https://x.test");
    check("find: cache hit", Boolean(drug) && drug.slug === "cached");

    const inst2 = loadFormulary();
    inst2.state.cache.set(key, { miss: true });
    const drug2 = await inst2.api.findFormularyDrug({ FORMULARY_DB: "on" }, "parasetamol", "https://x.test");
    check("find: negative cache → null", drug2 === null);
    check("find: negative cache tidak query", inst2.state.calls.length === 0);
  }

  // --- suggest ---
  {
    const inst = loadFormulary();
    const off = await inst.api.suggestFormularyDrugs({ FORMULARY_DB: "off" }, "para", "https://x.test");
    check("suggest: OFF → []", off.length === 0);

    const inst2 = loadFormulary();
    inst2.state.rpcImpl = async () => {
      throw new Error("rpc tidak tersedia");
    };
    inst2.state.selectImpl = async () => [{ slug: "parasetamol", nama: "Parasetamol", inn: "paracetamol", atc: "N02BE01" }];
    const items = await inst2.api.suggestFormularyDrugs({ FORMULARY_DB: "on" }, "para", "https://x.test");
    check("suggest: fallback ILIKE saat RPC gagal", items.length === 1 && items[0].name === "Parasetamol" && items[0].slug === "parasetamol");

    const short = await inst2.api.suggestFormularyDrugs({ FORMULARY_DB: "on" }, "p", "https://x.test");
    check("suggest: query <2 huruf → []", short.length === 0);

    // Fase 4: suggest memakai RPC (FTS/trigram) lebih dulu, tanpa query select.
    const inst3 = loadFormulary();
    inst3.state.rpcImpl = async () => [row];
    const viaRpc = await inst3.api.suggestFormularyDrugs({ FORMULARY_DB: "on" }, "para", "https://x.test");
    check("suggest: pakai RPC lebih dulu", viaRpc.length === 1 && viaRpc[0].name === "Parasetamol" && inst3.state.calls.length === 0);
  }

  // --- search (Fase 4): FTS/trigram via RPC ---
  {
    const inst = loadFormulary();
    const off = await inst.api.searchFormularyDrugs({ FORMULARY_DB: "off" }, "paracetamol", "https://x.test");
    check("search: OFF → []", off.length === 0);

    const inst2 = loadFormulary();
    inst2.state.rpcImpl = async () => [row];
    const items = await inst2.api.searchFormularyDrugs({ FORMULARY_DB: "on" }, "metformin", "https://x.test");
    check("search: RPC items ternormalisasi", items.length === 1 && items[0].slug === "parasetamol" && items[0].source_tier === "official");
    check("search: memanggil fn_drug_search", inst2.state.rpcCalls[0] && inst2.state.rpcCalls[0].name === "fn_drug_search" && inst2.state.rpcCalls[0].args.p_query === "metformin");

    const inst3 = loadFormulary();
    inst3.state.rpcImpl = async () => {
      throw new Error("rpc down");
    };
    const none = await inst3.api.searchFormularyDrugs({ FORMULARY_DB: "on" }, "metformin", "https://x.test");
    check("search: RPC error → []", none.length === 0);
    check("search: error tidak di-cache", inst3.state.cache.size === 0);
  }

  // --- hardening input & negative-cache ---
  {
    const inst = loadFormulary();
    await inst.api.findFormularyDrug({ FORMULARY_DB: "on" }, "para%_,x(", "https://x.test");
    check("filter: wildcard/pemisah dibersihkan", inst.state.calls[1] && inst.state.calls[1].params.inn === "ilike.para x");

    const instErr = loadFormulary();
    instErr.state.selectImpl = async () => {
      throw new Error("db down");
    };
    const failed = await instErr.api.findFormularyDrug({ FORMULARY_DB: "on" }, "x", "https://x.test");
    check("find: error DB → null & tidak di-cache", failed === null && instErr.state.cache.size === 0);

    const instErr2 = loadFormulary();
    instErr2.state.rpcImpl = async () => {
      throw new Error("rpc down");
    };
    instErr2.state.selectImpl = async () => {
      throw new Error("db down");
    };
    const sugErr = await instErr2.api.suggestFormularyDrugs({ FORMULARY_DB: "on" }, "para", "https://x.test");
    check("suggest: error → [] & tidak di-cache", sugErr.length === 0 && instErr2.state.cache.size === 0);
  }

  let failed = 0;
  for (const item of results) {
    if (!item.ok) failed++;
    console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? " (" + item.detail + ")" : ""}`);
  }
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
  process.exit(failed ? 1 : 0);
})();
