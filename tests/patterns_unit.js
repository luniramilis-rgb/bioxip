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
vm.runInContext(fs.readFileSync(path.join(ROOT, "web", "js", "patterns.js"), "utf8"), sandbox, { filename: "patterns.js" });

const patterns = sandbox.BIOXIP_PATTERNS || [];
const note = sandbox.BIOXIP_PATTERNS_NOTE || "";

check("patterns: minimal 3 pola", patterns.length >= 3, String(patterns.length));

const ids = patterns.map((p) => p.id);
check("patterns: id unik & terisi", ids.every(Boolean) && new Set(ids).size === ids.length, JSON.stringify(ids));

const allowedTypes = new Set(["paper", "preprint", "trial"]);
const roles = new Set(["klinis", "farmasi", "akademik"]);
for (const p of patterns) {
  const where = `${p.id}`;
  check(`patterns: ${where} label & query`, Boolean(p.label) && typeof p.query === "string" && p.query.length >= 20, p.query);
  check(`patterns: ${where} role valid`, roles.has(p.role), String(p.role));
  const types = p.filters?.types || [];
  check(`patterns: ${where} types valid`, types.every((t) => allowedTypes.has(t)), JSON.stringify(types));
}

// Guardrail: tidak ada pola yang MEMINTA diagnosis/peresepan (kata "peresepan"
// dalam konteks batasan/regulasi tetap wajar).
const forbidden = /diagnos|resepkan|buatkan resep|resep untuk saya|obat untuk pasien saya/i;
const offenders = patterns.filter((p) => forbidden.test(`${p.label} ${p.query}`)).map((p) => p.id);
check("patterns: tidak ada pola diagnosis/resep", offenders.length === 0, JSON.stringify(offenders));

// Pola tanda bahaya harus mengarah ke eskalasi, bukan daftar diagnosis.
const redFlag = patterns.find((p) => p.id === "tanda-bahaya");
check("patterns: tanda-bahaya mengarah ke rujukan/IGD", Boolean(redFlag) && /rujukan|igd|darurat/i.test(redFlag.query), redFlag?.query);
check("patterns: catatan guardrail ada", /tidak mendiagnosis/i.test(note), note);

let failed = 0;
for (const item of results) {
  if (!item.ok) failed++;
  console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? " (" + item.detail + ")" : ""}`);
}
console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
