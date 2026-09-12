const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

function loadRank() {
  let source = fs.readFileSync(path.join(ROOT, "functions", "_rank.js"), "utf8");
  source = source.replace(/^import\s+.*?;\s*$/gm, "");
  source = source.replace(/export function /g, "function ");
  source += "\nglobalThis.__rank = { rankResults, rankScore, relevanceScore, sectionSnippet, tokenize };\n";
  const sandbox = {
    console,
    Math,
    Date,
    String,
    Number,
    RegExp,
    Array,
    Object,
    studyTypeWeight: (docType) => ({ paper: 1, trial: 0.88, preprint: 0.66, local: 0.7 }[docType] ?? 0.6),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "_rank.js" });
  return sandbox.__rank;
}

function loadTerminology() {
  let source = fs.readFileSync(path.join(ROOT, "functions", "_terminology.js"), "utf8");
  source = source.replace(/^import\s+.*?;\s*$/gm, "");
  source = source.replace(/export (const|function) /g, "$1 ");
  source += "\nglobalThis.__term = { detectQuestionType, expandTerms, epmcFilterFor, pubmedCategoryFor, studyTypeWeight };\n";
  const sandbox = {
    console,
    Math,
    String,
    RegExp,
    Array,
    Object,
    DICTIONARY: [{ id_term: "demam berdarah", en_terms: '"dengue" OR "dengue fever"', kind: "disease" }],
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "_terminology.js" });
  return sandbox.__term;
}

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

const rank = loadRank();
const term = loadTerminology();

// --- rank: relevansi ---------------------------------------------------------
const rows = [
  { title: "Dengue vaccine efficacy in children", abstract: "dengue vaccine reduced hospitalization", doc_type: "paper", year: 2024, published_on: "2024-01-01", citation_count: 40, oa: { is_oa: true } },
  { title: "Unrelated cardiology study", abstract: "statin therapy outcomes", doc_type: "paper", year: 2024, published_on: "2024-01-01", citation_count: 40, oa: { is_oa: true } },
];
const ranked = rank.rankResults(rows, "dengue vaccine", "relevance");
check("rank: hasil relevan di peringkat pertama", ranked[0].title.includes("Dengue"), ranked[0].title);

// --- rank: kualitas & kebaruan ----------------------------------------------
const recency = rank.rankResults(
  [
    { title: "metformin diabetes", abstract: "metformin", doc_type: "preprint", year: 2005, published_on: "2005-01-01", citation_count: 0, oa: { is_oa: false } },
    { title: "metformin diabetes", abstract: "metformin", doc_type: "paper", year: 2025, published_on: "2025-01-01", citation_count: 100, oa: { is_oa: true } },
  ],
  "metformin diabetes",
  "relevance"
);
check("rank: paper baru berbukti mengalahkan preprint lama", recency[0].doc_type === "paper", recency[0].doc_type);

// --- rank: local-first -------------------------------------------------------
const localFirst = rank.rankResults(
  [
    { title: "dengue study", abstract: "dengue", doc_type: "paper", year: 2024, published_on: "2024-01-01", citation_count: 10, source: "europepmc" },
    { title: "dengue study", abstract: "dengue", doc_type: "paper", year: 2024, published_on: "2024-01-01", citation_count: 10, source: "neliti" },
  ],
  "dengue study",
  "relevance"
);
check("rank: sumber lokal (neliti) diprioritaskan saat setara", localFirst[0].source === "neliti", localFirst[0].source);

const officialFirst = rank.rankResults(
  [
    { title: "hipertensi", abstract: "hipertensi", doc_type: "paper", year: 2024, published_on: "2024-01-01", citation_count: 10, source: "europepmc" },
    { title: "hipertensi", abstract: "hipertensi", doc_type: "paper", year: 2024, published_on: "2024-01-01", citation_count: 10, source: "guideline", source_tier: "official" },
  ],
  "hipertensi",
  "relevance"
);
check("rank: source_tier official paling diprioritaskan", officialFirst[0].source_tier === "official", String(officialFirst[0].source_tier));

// --- rank: sort --------------------------------------------------------------
const byDate = rank.rankResults(
  [
    { title: "a", published_on: "2019-01-01", doc_type: "paper" },
    { title: "b", published_on: "2024-01-01", doc_type: "paper" },
  ],
  "x",
  "date"
);
check("rank: sort date", byDate[0].published_on === "2024-01-01", byDate[0].published_on);

const byCites = rank.rankResults(
  [
    { title: "a", citation_count: 3, doc_type: "paper" },
    { title: "b", citation_count: 50, doc_type: "paper" },
  ],
  "x",
  "citations"
);
check("rank: sort citations", byCites[0].citation_count === 50, String(byCites[0].citation_count));

// --- sectionSnippet ---------------------------------------------------------
const abstract =
  "Background: Dengue is common in tropical areas. Methods: We enrolled 1,000 children. " +
  "Results: The vaccine significantly reduced hospitalization by 40%. " +
  "Conclusions: Dengue vaccination was effective in children.";
const snippet = rank.sectionSnippet(abstract, "dengue vaccine efficacy", 2);
check("snippet: memuat kalimat hasil/kesimpulan", /significantly reduced|Conclusions/i.test(snippet), snippet.slice(0, 90));
check("snippet: tidak didominasi bagian pendahuluan/metode", !/^Background:|^Methods:/.test(snippet.trim()), snippet.slice(0, 40));
check("snippet: panjang wajar", snippet.length > 40 && snippet.length <= 700, String(snippet.length));

const emptySnippet = rank.sectionSnippet("", "x", 2);
check("snippet: abstrak kosong aman", emptySnippet === "", JSON.stringify(emptySnippet));

// --- tokenize ----------------------------------------------------------------
check("tokenize: buang token pendek", rank.tokenize("di of the dengue vaccine").every((t) => t.length > 3), JSON.stringify(rank.tokenize("di of the dengue vaccine")));

// --- terminology -------------------------------------------------------------
check("kategori: terapi", term.detectQuestionType("Apa efektivitas metformin dibanding insulin?") === "therapy");
check("kategori: diagnosis", term.detectQuestionType("Bagaimana sensitivitas dan spesifisitas USG?") === "diagnosis");
check("kategori: prognosis", term.detectQuestionType("Bagaimana prognosis dan mortalitas pasien?") === "prognosis");
check("kategori: etiologi", term.detectQuestionType("Apa faktor risiko penyakit ini?") === "etiology");
check("kategori: harm", term.detectQuestionType("Apa efek samping dan keamanan obat ini?") === "harm");
check("filter EPMC diagnosis", term.epmcFilterFor("diagnosis").includes("Sensitivity and Specificity"));
check("filter PubMed mapping", term.pubmedCategoryFor("harm") === "therapy" && term.pubmedCategoryFor("diagnosis") === "diagnosis");
const expanded = term.expandTerms("demam berdarah dengue");
check("ekspansi istilah Indonesia", expanded.english.some((t) => /dengue/i.test(t)), JSON.stringify(expanded.english));

let failed = 0;
for (const item of results) {
  if (!item.ok) failed++;
  console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? " (" + item.detail + ")" : ""}`);
}
console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
