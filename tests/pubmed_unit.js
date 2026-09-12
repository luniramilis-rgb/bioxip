const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

const source = fs
  .readFileSync(path.join(ROOT, "functions", "_pubmed.js"), "utf8")
  .replace(/^import\s+.*?;\s*$/gm, "")
  .replace(/export /g, "");
const sandbox = { console, JSON, String, Number, Boolean, Object, Array, RegExp, URLSearchParams, AbortSignal, fetch: async () => ({ ok: true, json: async () => ({}) }) };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(`${source}\nglobalThis.__p = { minInterval, buildQuery };`, sandbox, { filename: "_pubmed.js" });
const { minInterval, buildQuery } = sandbox.__p;

check("pubmed: interval tanpa key = 350ms", minInterval({}) === 350, String(minInterval({})));
check("pubmed: interval dengan key = 100ms", minInterval({ NCBI_API_KEY: "x" }) === 100, String(minInterval({ NCBI_API_KEY: "x" })));

const therapy = buildQuery("metformin diabetes", "therapy");
check("pubmed: filter terapi ditambahkan", therapy.includes("randomized controlled trial") && therapy.startsWith("metformin diabetes AND"));
check("pubmed: tanpa kategori tidak menambah filter", buildQuery("metformin diabetes") === "metformin diabetes");
check("pubmed: kategori tak dikenal tidak menambah filter", buildQuery("x", "kategori-aneh") === "x");
check("pubmed: istilah kosong tetap kosong", buildQuery("   ") === "");

let failed = 0;
for (const item of results) {
  if (!item.ok) failed++;
  console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? " (" + item.detail + ")" : ""}`);
}
console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
