const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

function loadCommonJs(relative, expose, globals = {}) {
  let source = fs.readFileSync(path.join(ROOT, relative), "utf8");
  source = source.replace(/^import\s+.*?;\s*$/gm, "").replace(/export /g, "");
  source += `\nglobalThis.__m = { ${expose} };\n`;
  const sandbox = { console, JSON, String, Number, Boolean, Object, Array, Math, RegExp, ...globals };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: relative });
  return sandbox.__m;
}

const dict = loadCommonJs("functions/_dictionary.js", "DICTIONARY");
const term = loadCommonJs("functions/_terminology.js", "expandTerms, expansionClause, expansionSearchText, containsTerm, detectQuestionType", {
  DICTIONARY: dict.DICTIONARY,
});

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });
const ids = (text) => term.expandTerms(text).entries.map((entry) => entry.id_term);

// --- pencocokan istilah pendek harus utuh (word-boundary) -------------------
check("term: 'mdr' cocok utuh", term.containsTerm("terapi MDR-TB", "mdr") === true);
check("term: 'mdr' tidak cocok di tengah kata", term.containsTerm("kamdrx", "mdr") === false);
check("term: 'asi' cocok sebagai kata", term.containsTerm("pemberian ASI eksklusif", "asi") === true);
check("term: 'asi' tidak cocok di dalam kata lain", term.containsTerm("diagnosis banding", "asi") === false);
check("term: istilah panjang cocok sebagai substring", term.containsTerm("pengobatan hipertensi", "hipertensi") === true);

// --- konsep generik tidak boleh jadi klausa tunggal ------------------------
const genericOnly = term.expandTerms("di mana saya bisa membeli obat?");
check("term: 'obat' generik tidak masuk entries", genericOnly.entries.length === 0, JSON.stringify(ids("di mana saya bisa membeli obat?")));
check("term: klausa generik tunggal kosong", term.expansionClause("di mana saya bisa membeli obat?") === "", term.expansionClause("di mana saya bisa membeli obat?"));

// --- konsep yang dulu tidak dikenali kini terpetakan -----------------------
const tb = term.expansionClause("Apa bukti terbaru terapi TB resisten obat?");
check("term: TB resisten obat → drug resistance/MDR-TB", /drug resistance|MDR-TB/i.test(tb), tb);
check("term: TB resisten obat tidak jadi klausa generik", !/^\(?"drug" OR "medication"/i.test(tb), tb);

const sglt2 = term.expansionClause("Bagaimana efektivitas SGLT2 inhibitor terhadap luaran kardiovaskular?");
check("term: SGLT2 terpetakan", /SGLT2/i.test(sglt2), sglt2);

const dengue = term.expansionClause("Bagaimana tata laksana cairan pada dengue dengan syok?");
check("term: dengue + syok terpetakan", /dengue/i.test(dengue) && /shock/i.test(dengue), dengue);

const mental = term.expansionClause("Bagaimana prognosis kesehatan mental?");
check("term: kesehatan mental terpetakan", /mental (health|disorders)/i.test(mental), mental);

const glp = term.expansionClause("Bagaimana perbandingan keamanan kardiovaskular GLP-1 agonis?");
check("term: GLP-1 terpetakan", /GLP-1|glucagon-like/i.test(glp), glp);

const ibu = term.expansionClause("Apa kesenjangan riset kesehatan ibu di Indonesia?");
check("term: kesehatan ibu terpetakan", /maternal/i.test(ibu), ibu);

// --- batas maksimum konsep (AND tidak berlebihan) --------------------------
const many = term.expandTerms("efektivitas metformin pada diabetes dengan hipertensi dan anemia pada lansia");
check("term: maksimum 3 konsep", many.entries.length <= 3, String(many.entries.length));

// --- regresi: pertanyaan generik Indonesia tanpa konsep tetap punya query ---
check("term: expansionSearchText fallback ke teks asli", term.expansionSearchText("xyzabc tak dikenal") === "xyzabc tak dikenal");

// --- klasifikasi jenis pertanyaan dasar ------------------------------------
check("term: terapi terdeteksi", term.detectQuestionType("Apa efektivitas obat X?") === "therapy");
check("term: diagnosis terdeteksi", term.detectQuestionType("Apa akurasi USG untuk kolesistitis?") === "diagnosis");
check("term: prognosis terdeteksi", term.detectQuestionType("Bagaimana luaran jangka panjang?") === "prognosis");

let failed = 0;
for (const item of results) {
  if (!item.ok) failed++;
  console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? " (" + item.detail + ")" : ""}`);
}
console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
