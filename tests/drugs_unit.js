const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const catalogue = JSON.parse(fs.readFileSync(path.join(ROOT, "functions", "_drugs.json"), "utf8"));

function loadDrugs() {
  let source = fs.readFileSync(path.join(ROOT, "functions", "_drugs.js"), "utf8");
  source = source.replace(/^import\s+.*?;\s*$/gm, "");
  source = source.replace(/export const /g, "const ").replace(/export function /g, "function ");
  source += "\nglobalThis.__d = { findDrug, findDrugsInText, suggestDrugs, DRUGS };\n";
  const sandbox = {
    console,
    Math,
    String,
    Number,
    Array,
    Object,
    RegExp,
    catalogue,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "_drugs.js" });
  return sandbox.__d;
}

const drugs = loadDrugs();
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

check("findDrug: nama Indonesia", drugs.findDrug("parasetamol")?.slug === "parasetamol");
check("findDrug: alias Inggris", drugs.findDrug("acetaminophen")?.slug === "parasetamol");
check("findDrug: slug", drugs.findDrug("amoksisilin")?.slug === "amoksisilin");

const inText = drugs.findDrugsInText("parasetamol dosis ginjal");
check(
  "findDrugsInText: menemukan obat dalam kalimat",
  inText.some((drug) => drug.slug === "parasetamol"),
  inText.map((drug) => drug.slug).join(","),
);

const mixed = drugs.findDrugsInText("interaksi metronidazol dan glibenklamid");
check(
  "findDrugsInText: menemukan dua obat",
  mixed.length >= 2,
  mixed.map((drug) => drug.slug).join(","),
);

check(
  "findDrugsInText: tidak salah cocok pada teks tanpa obat",
  drugs.findDrugsInText("bagaimana tata laksana dengue pada anak").length === 0,
  drugs.findDrugsInText("bagaimana tata laksana dengue pada anak").map((d) => d.slug).join(","),
);

check(
  "findDrugsInText: menemukan obat dengan alias Indonesia",
  drugs.findDrugsInText("dosis glibenklamid").some((drug) => drug.slug === "glibenklamid"),
);

let failed = 0;
for (const item of results) {
  if (!item.ok) failed++;
  console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? " (" + item.detail + ")" : ""}`);
}
console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
