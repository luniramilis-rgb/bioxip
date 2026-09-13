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
const dict = loadModule("functions/_dictionary.js", "DICTIONARY");
const term = loadModule("functions/_terminology.js", "detectQuestionType, expandTerms", {
  DICTIONARY: dict.DICTIONARY,
});
const grounded = loadModule(
  "functions/_grounded.js",
  "verifyClaims, resolveAbstain, sanitizeOverview, hasOverviewDose, isMechanismQuestion, normalizeConfidence, extractiveAnswer, validateSynthesis, postProcessAnswer, synthesisMode, systemPromptFor",
  { detectQuestionType: term.detectQuestionType, expandTerms: term.expandTerms },
);

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
// Hybrid: penjelasan umum tanpa sitasi tetap dianggap menjawab (bukan dead-end).
// Hybrid: saat pipeline TIDAK meminta abstain, penjelasan umum tetap menjawab.
check("abstain: ada penjelasan umum tanpa klaim → tidak abstain", grounded.resolveAbstain(false, noClaims, "Penjelasan umum.") === false);
check("abstain: penjelasan umum kosong + tanpa klaim → abstain", grounded.resolveAbstain(false, noClaims, "   ") === true);
// Kontrak prompt: permintaan abstain dihormati bila tak ada klaim bersitasi.
check("abstain: permintaan abstain + tanpa klaim → abstain", grounded.resolveAbstain(true, noClaims, "Konteks tidak cukup.") === true);
check("abstain: permintaan abstain tapi ada klaim bersitasi → tetap menjawab", grounded.resolveAbstain(true, supported, "") === false);
check("abstain: klaim bersitasi menang walau penjelasan kosong", grounded.resolveAbstain(true, supported, "") === false);

// --- sanitizeOverview: lapisan A bebas [n] & angka dosis -------------------
const citeStrip = grounded.sanitizeOverview("Parasetamol bekerja sentral [1]. PGE2 turun [2, 3].");
check("overview: penanda [n] dibuang", !citeStrip.text.includes("[") && citeStrip.text.includes("Parasetamol"), citeStrip.text);

const doseDrop = grounded.sanitizeOverview("Parasetamol menurunkan demam. Berikan 500 mg tiap 6 jam. Hati-hati hepatotoksisitas.");
check("overview: kalimat dosis dibuang + flagged", doseDrop.flagged === true && !/500|mg/i.test(doseDrop.text) && /hepatotoksisitas/i.test(doseDrop.text), doseDrop.text);

const prescribeDrop = grounded.sanitizeOverview("Saya resepkan parasetamol untuk pasien. Mekanisme berpusat di hipotalamus.");
check("overview: kalimat peresepan dibuang", prescribeDrop.flagged === true && !/resepkan/i.test(prescribeDrop.text), prescribeDrop.text);

const clean = grounded.sanitizeOverview("Mekanisme antipiretik berpusat di hipotalamus melalui penurunan PGE2.");
check("overview: teks bersih tidak diubah", clean.flagged === false && clean.text.startsWith("Mekanisme antipiretik"), clean.text);

const longText = "Kalimat penjelasan yang panjang sekali tanpa dosis. ".repeat(60);
const capped = grounded.sanitizeOverview(longText);
check("overview: teks kepanjangan dipotong + flagged", capped.flagged === true && capped.text.length <= 1400, String(capped.text.length));

check("overview: deteksi dosis", grounded.hasOverviewDose("Berikan 500 mg") === true);
check("overview: tanpa dosis aman", grounded.hasOverviewDose("Bekerja di hipotalamus") === false);
check("overview: satuan panjang terdeteksi", grounded.hasOverviewDose("Berikan 500 miligram") === true);
check("overview: sendok terdeteksi", grounded.hasOverviewDose("Berikan 1 sendok") === true);
check("overview: dosis per-hari tanpa satuan terdeteksi", grounded.hasOverviewDose("Diberikan 2 per hari") === true);

const statDrop = grounded.sanitizeOverview("Mekanisme berpusat di hipotalamus. Menurunkan demam 30% pada uji klinis.");
check("overview: klaim kuantitatif (%) dibuang + flagged", statDrop.flagged === true && !/%/.test(statDrop.text) && /hipotalamus/i.test(statDrop.text), statDrop.text);

// --- klasifikasi mekanisme & keyakinan -------------------------------------
check("mekanisme: pertanyaan mekanisme dikenali", grounded.isMechanismQuestion("mekanisme parasetamol menurunkan demam") === true);
check("mekanisme: pertanyaan terapi bukan mekanisme", grounded.isMechanismQuestion("efektivitas metformin vs insulin untuk DM tipe 2") === false);
check("keyakinan: nilai valid dipertahankan", grounded.normalizeConfidence("tinggi") === "tinggi");
check("keyakinan: nilai tak dikenal → sedang", grounded.normalizeConfidence("wkwk") === "sedang");

// --- extractiveAnswer lintas bahasa (kueri ID vs snippet EN) ---------------
const xling = grounded.extractiveAnswer("mekanisme parasetamol menurunkan demam", [
  { n: 1, snippet: "Paracetamol reduces fever by inhibiting prostaglandin synthesis in the hypothalamus of the brain." },
]);
check("ekstraktif: kueri Indonesia cocok kalimat Inggris", xling.abstain === false && xling.claims.length === 1, JSON.stringify(xling.claims));

const xlingEmpty = grounded.extractiveAnswer("mekanisme parasetamol menurunkan demam", []);
check("ekstraktif: konteks kosong → abstain retrieval_empty", xlingEmpty.abstain === true && xlingEmpty.reason === "retrieval_empty", xlingEmpty.reason);

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

// --- sintesis bersitasi: validasi [n] terhadap claims terverifikasi ---------
const synth = grounded.validateSynthesis("Parasetamol menekan PGE2 [1]. Klaim asing [9].", new Set([1]));
check("synthesis: [n] valid dipertahankan", synth.text.includes("[1]") && synth.cited === 1, synth.text);
check("synthesis: [n] tak dikenal dihapus + flagged", !synth.text.includes("[9]") && synth.unknownCites === 1 && synth.flagged === true, JSON.stringify(synth));
const synthDose = grounded.validateSynthesis("Berikan 500 mg tiap 6 jam.", new Set([1]));
check("synthesis: kalimat dosis tanpa sitasi dibuang", synthDose.text === "" && synthDose.flagged === true, synthDose.text);

const partialCite = grounded.validateSynthesis("Parasetamol menekan PGE2 [1, 9].", new Set([1]));
check("synthesis: penanda campuran menyisakan sitasi valid", partialCite.text.includes("[1]") && !partialCite.text.includes("[9]") && partialCite.flagged === true, partialCite.text);

const citedDoseLine = grounded.validateSynthesis("Parasetamol menekan PGE2 [1]. Berikan 500 mg tiap 6 jam.", new Set([1]));
check("synthesis: dosis tanpa sitasi dibuang di baris bersitasi", citedDoseLine.text.includes("[1]") && !/\b500\b|\bmg\b/i.test(citedDoseLine.text) && citedDoseLine.flagged === true, citedDoseLine.text);

const citedDoseKept = grounded.validateSynthesis("Berikan 500 mg tiap 6 jam [1].", new Set([1]));
check("synthesis: dosis bersitasi dipertahankan", /\b500\b/.test(citedDoseKept.text) && citedDoseKept.flagged === false, citedDoseKept.text);

const citedPost = grounded.postProcessAnswer({
  mode: "cited",
  answer: "## Ringkasan\n\nParasetamol menekan PGE2 di hipotalamus [1].",
  claims: [{ text: "Parasetamol menekan PGE2", citations: [1] }],
  evidenceCount: 2,
  confidence: "tinggi",
});
check("synthesis: mode cited terjaga", citedPost.answer_mode === "cited" && citedPost.overview === false && citedPost.abstain === false, citedPost.answer_mode);
check("synthesis: heading markdown dipertahankan", citedPost.answer.includes("## Ringkasan") && citedPost.answer.includes("[1]"), citedPost.answer);

const fallbackPost = grounded.postProcessAnswer({
  mode: "cited",
  answer: "Klaim tanpa bukti sama sekali [9].",
  claims: [],
  evidenceCount: 0,
  confidence: "rendah",
});
check("synthesis: tanpa sitasi valid → jawaban dibuang (bukan diklaim bersitasi)", fallbackPost.answer_mode === "overview" && fallbackPost.answer === "", `${fallbackPost.answer_mode}|${fallbackPost.answer}`);

const abstainPost = grounded.postProcessAnswer({
  mode: "cited",
  answer: "Konteks tidak menyediakan bukti yang cukup.",
  claims: [],
  evidenceCount: 0,
  confidence: "rendah",
  requestedAbstain: true,
});
check("synthesis: permintaan abstain dihormati", abstainPost.abstain === true, String(abstainPost.abstain));

const uncitedLine = grounded.validateSynthesis("# Judul\n\nParasetamol menekan PGE2 [1].\n\nObat ini dikontraindikasikan pada kehamilan.", new Set([1]));
check("synthesis: baris tanpa sitasi dibuang, heading dipertahankan", uncitedLine.text.includes("# Judul") && uncitedLine.text.includes("[1]") && !uncitedLine.text.includes("kontraindikasi"), uncitedLine.text);

check("synthesis: mode default cited", grounded.synthesisMode({}) === "cited");
check("synthesis: env hybrid dihormati", grounded.synthesisMode({ AI_SYNTHESIS: "hybrid" }) === "hybrid");
check("synthesis: prompt cited memuat aturan sitasi", /SINTESIS BERSITASI/.test(grounded.systemPromptFor("cited")), "");
check("synthesis: prompt hybrid tetap ada", /PENJELASAN UMUM/.test(grounded.systemPromptFor("hybrid")), "");

let failed = 0;
for (const item of results) {
  if (!item.ok) failed++;
  console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? " (" + item.detail + ")" : ""}`);
}
console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
