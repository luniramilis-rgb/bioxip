const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

const sandbox = { console, JSON, String, Number, Boolean, Object, Array, RegExp };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "web", "js", "search.js"), "utf8"), sandbox, { filename: "search.js" });
const S = sandbox.BIOXIP_SEARCH;

const doc = {
  title: "Efektivitas metformin",
  authors: [{ given: "Andi", family: "Budi" }, { given: "Siti", family: "Rahma" }],
  year: 2024,
  journal: "Jurnal Contoh",
  url: "https://example.org/1",
  source: "europepmc",
};

const vancouver = S.formatCitation(doc, "vancouver");
check("format: Vancouver memuat penulis, judul, jurnal, tahun", vancouver.includes("Budi, Rahma") && vancouver.includes("Efektivitas metformin") && vancouver.includes("Jurnal Contoh") && vancouver.includes("2024"), vancouver);

const apa = S.formatCitation(doc, "apa");
check("format: APA memuat (tahun) setelah penulis", /Budi, Rahma\. \(2024\)\./.test(apa), apa);
check("format: APA memuat URL", apa.includes("https://example.org/1"), apa);

const minimal = S.formatCitation({ title: "Tanpa metadata", source: "doaj", url: "https://x.test" }, "vancouver");
check("format: metadata minim tetap aman", minimal.includes("Tanpa metadata") && minimal.includes("n.d.") && !minimal.includes(".."), minimal);

let failed = 0;
for (const item of results) {
  if (!item.ok) failed++;
  console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? " (" + item.detail + ")" : ""}`);
}
console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
