const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

function loadModule(relative, expose, extraGlobals = {}) {
  let source = fs.readFileSync(path.join(ROOT, relative), "utf8");
  source = source.replace(/^import\s+.*?;\s*$/gm, "").replace(/export /g, "");
  source += `\nglobalThis.__m = { ${expose} };\n`;
  const sandbox = { console, JSON, String, Number, Boolean, Object, Array, Math, RegExp, ...extraGlobals };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: relative });
  return sandbox.__m;
}

const safety = loadModule("functions/_safety.js", "classifyInput, normalizeRedFlags, mergeRedFlags");
const grounded = loadModule("functions/_grounded.js", "verifyClaims, resolveAbstain");

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

// --- resolveAbstain: jawaban berbukti tidak boleh abstain ------------------
const supported = grounded.verifyClaims([{ text: "a", citations: [1] }], 3);
const unsupported = grounded.verifyClaims([{ text: "a", citations: [] }], 3);
const noClaims = grounded.verifyClaims([], 3);

check("abstain: klaim bersitasi + LLM minta abstain → tetap menjawab", grounded.resolveAbstain(true, supported) === false);
check("abstain: klaim bersitasi → tidak abstain", grounded.resolveAbstain(false, supported) === false);
check("abstain: klaim tanpa sitasi → abstain", grounded.resolveAbstain(false, unsupported) === true);
check("abstain: tanpa klaim → abstain", grounded.resolveAbstain(false, noClaims) === true);
check("abstain: verified kosong → abstain", grounded.resolveAbstain(false, undefined) === true);

// --- verifyClaims: support_rate & unsupported -----------------------------
const mixed = grounded.verifyClaims([{ text: "a", citations: [1] }, { text: "b", citations: [] }], 3);
check("verify: support_rate 1/2", mixed.support_rate === 0.5, String(mixed.support_rate));
check("verify: unsupported terdaftar", mixed.unsupported.length === 1 && mixed.unsupported[0] === "b");
check("verify: sitasi di luar rentang ditolak", grounded.verifyClaims([{ text: "a", citations: [9] }], 3).claims[0].supported === false);

// --- mergeRedFlags: flag keselamatan tidak boleh hilang -------------------
const mergedEmpty = safety.mergeRedFlags(["nyeri dada"], []);
check("red_flag: flag keselamatan bertahan saat LLM kosong", mergedEmpty.length === 1 && mergedEmpty[0] === "nyeri dada", JSON.stringify(mergedEmpty));

const mergedAdd = safety.mergeRedFlags(["nyeri dada"], ["kejang"]);
check("red_flag: flag LLM ditambahkan", mergedAdd.includes("nyeri dada") && mergedAdd.includes("kejang"), JSON.stringify(mergedAdd));

const mergedDedup = safety.mergeRedFlags(["nyeri dada"], ["nyeri dada"]);
check("red_flag: duplikat tidak digandakan", mergedDedup.length === 1, JSON.stringify(mergedDedup));

const mergedProse = safety.mergeRedFlags([], ["Tidak ada bukti dalam konteks yang membandingkan metformin dengan sulfonilurea."]);
check("red_flag: prosa panjang dibuang", mergedProse.length === 0, JSON.stringify(mergedProse));

const mergedString = safety.mergeRedFlags([], "nyeri dada");
check("red_flag: input bukan array dibuang", mergedString.length === 0, JSON.stringify(mergedString));

const normalized = safety.normalizeRedFlags(["  sesak napas  ", 42, "", "kejang", "kejang"]);
check("red_flag: normalisasi trim + unik + tipe", normalized.length === 2 && normalized.includes("sesak napas"), JSON.stringify(normalized));

// --- classifyInput tetap mendeteksi red flag deterministik ----------------
const flagged = safety.classifyInput("Pasien dengan nyeri dada dan sesak napas");
check("safety: red flag deterministik terdeteksi", flagged.red_flags.length >= 1, JSON.stringify(flagged.red_flags));
const blocked = safety.classifyInput("Resepkan antibiotik untuk pasien saya");
check("safety: peresepan tetap diblokir", blocked.blocked === true && blocked.code === "prescription_request");

let failed = 0;
for (const item of results) {
  if (!item.ok) failed++;
  console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? " (" + item.detail + ")" : ""}`);
}
console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
