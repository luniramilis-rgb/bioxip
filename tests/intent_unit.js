const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "web");
const sandbox = { console, JSON, String, Number, Boolean, Object, Array, RegExp };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const file of ["js/patterns.js", "js/intent.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), sandbox, { filename: file });
}
const I = sandbox.BIOXIP_INTENT;

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

check("intent: tersedia", Boolean(I) && typeof I.classifyIntent === "function");
check("intent: kosong", I.classifyIntent("").type === "empty");
check("intent: nama obat pendek → drug", I.classifyIntent("parasetamol").type === "drug");
check("intent: interaksi", I.classifyIntent("interaksi warfarin dan amiodaron").type === "interaction");
check("intent: dosis", I.classifyIntent("penyesuaian dosis apiksaban ginjal").type === "dose");
check("intent: fornas", I.classifyIntent("apakah insulin glargine ditanggung BPJS?").type === "availability");
check("intent: pico/perbandingan", I.classifyIntent("efektivitas metformin vs sulfonilurea").type === "pico");
check("intent: safety/red flag", I.classifyIntent("nyeri dada hebat mendadak").type === "safety");
check("intent: guideline", I.classifyIntent("tatalaksana TB menurut pedoman").type === "guideline");
check("intent: pertanyaan umum", I.classifyIntent("bagaimana mekanisme kerja obat ini bekerja di tubuh?").type === "question");

const s1 = I.suggestPatterns("interaksi warfarin dan amiodaron", 3);
check("intent: saran interaksi di depan", s1.length > 0 && s1[0].id === "interaksi-obat", JSON.stringify(s1.map((p) => p.id)));
const s2 = I.suggestPatterns("nyeri dada hebat", 3);
check("intent: saran tanda bahaya di depan", s2.length > 0 && s2[0].id === "tanda-bahaya", JSON.stringify(s2.map((p) => p.id)));
check("intent: saran dibatasi limit", I.suggestPatterns("dengue", 2).length <= 2);
check("intent: saran selalu terisi", I.suggestPatterns("", 3).length >= 1);

let failed = 0;
for (const item of results) {
  if (!item.ok) failed++;
  console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? " (" + item.detail + ")" : ""}`);
}
console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
