const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "web");

function makeElement(id) {
  return {
    id,
    innerHTML: "",
    hidden: false,
    value: "",
    checked: false,
    scrollTop: 0,
    dataset: {},
    listeners: {},
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute() {},
    removeAttribute() {},
    addEventListener(event, cb) { (this.listeners[event] = this.listeners[event] || []).push(cb); },
    trigger(event, payload = {}) {
      for (const cb of this.listeners[event] || []) cb(payload);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() {},
    remove() { this.removed = true; },
    insertAdjacentHTML(_pos, html) { this.innerHTML += html; },
  };
}

const registry = new Map();
const handlers = {};

const documentStub = {
  title: "",
  body: makeElement("body"),
  addEventListener(event, cb) { (handlers[event] = handlers[event] || []).push(cb); },
  getElementById(id) {
    if (!registry.has(id)) registry.set(id, makeElement(id));
    return registry.get(id);
  },
  querySelectorAll() { return []; },
  querySelector() { return null; },
};

const locationStub = { hash: "#/", search: "", pathname: "/", origin: "https://bioxip.pages.dev", replace(value) { this.hash = value; }, assign() {} };

const storageMap = new Map();
const localStorageStub = {
  getItem: (key) => (storageMap.has(key) ? storageMap.get(key) : null),
  setItem: (key, value) => storageMap.set(key, String(value)),
  removeItem: (key) => storageMap.delete(key),
  clear: () => storageMap.clear(),
};

const AUTH_PAYLOAD = {
  access_token: "test-access-token",
  refresh_token: "test-refresh-token",
  expires_in: 3600,
  user: {
    id: "39d51ab2-2ddc-4fb3-9e2c-fac6b69b2296",
    email: "lunira.milis@gmail.com",
    user_metadata: { full_name: "arinulhaq d", avatar_url: "" },
    identities: [{ provider: "email" }, { provider: "google" }],
  },
};

// null = endpoint kredit mengembalikan 401 (belum masuk).
let creditBalance = null;

const ANSWER_PAYLOAD = {
  question: "metformin vs insulin diabetes",
  pico: { intervention: "metformin", comparison: "insulin", terms: ["diabetes"] },
  mode: "extractive",
  disclaimer: "bukan nasihat medis",
  stats: { total: 2, by_type: { "Meta-analisis": 1, RCT: 1 }, earliest: 2020, latest: 2024, open_access: 1 },
  summary: {
    intro: "ringkasan dari 2 studi",
    blocks: [
      { text: "Metformin menurunkan HbA1c dibanding kontrol.", cites: [1], study_type: "Meta-analisis" },
      { text: "Tidak ada perbedaan mortalitas antara kedua terapi.", cites: [2], study_type: "RCT" },
    ],
  },
  studies: [
    { ref: 1, title: "Study one", url: "https://example.org/1", source: "europepmc", study_type: "Meta-analisis", year: 2024, citation_count: 10, authors: ["A B"], oa: { is_oa: true, pdf_url: "https://example.org/1.pdf" }, abstract: "Abstract one." },
    { ref: 2, title: "Study two", url: "https://example.org/2", source: "europepmc", study_type: "RCT", year: 2020, citation_count: 2, authors: ["C D"], oa: { is_oa: false }, abstract: "Abstract two." },
  ],
  notes: [],
};

const SEARCH_PAYLOAD = {
  total: 12,
  mode: "live",
  page: 1,
  limit: 20,
  notes: [],
  pagination: { epmcHasMore: false, ctHasMore: false },
  results: [
    { id: "epmc|1", doc_type: "paper", title: "Dengue paper", url: "https://example.org/d", source: "europepmc", authors: [{ given: "A", family: "B" }], year: 2024, oa: { is_oa: true, pdf_url: "https://example.org/d.pdf" }, citation_count: 3 },
  ],
};

const DRUG_PAYLOAD = {
  matched: true,
  catalogue: true,
  outside_catalogue: false,
  drug: { slug: "parasetamol", name: "Parasetamol", inn: "paracetamol", atc: "N02BE01", kelas: "Analgesik", rute: "Oral", watchouts: ["Dosis maksimum harian perlu diverifikasi."] },
  fornas: { edition: "KMK 1199/2025", source_url: "https://e-fornas.kemkes.go.id/guest/daftar-obat" },
  rxnorm: { rxcui: "161", name: "Acetaminophen", source: "https://mor.nlm.nih.gov/RxNav" },
  chemistry: { cid: 1983, molecular_formula: "C8H9NO2", molecular_weight: 151.16, source: "https://pubchem.ncbi.nlm.nih.gov/compound/1983" },
  mechanism: { chembl_id: "CHEMBL112", pref_name: "PARACETAMOL", actions: [{ action: "inhibitor", mechanism: "COX inhibition" }], source: "https://www.ebi.ac.uk/chembl/compound_report_card/CHEMBL112/" },
  monitoring: { monitoring: ["Total dosis harian"], renal: "Ikuti label.", hepatic: "Hati-hati.", geriatric: "Perhatikan kombinasi.", deprescribing: [] },
  monitoring_reviewed: false,
  label: { available: true, label_count: 3, effective_time: "20260102", matched_term: "acetaminophen", fields: { indikasi: { text: "Indikasi teks", source: "https://example.org/label", truncated: false } } },
  safety: { blackbox: false, blackbox_excerpt: null, watchouts: ["Dosis maksimum harian perlu diverifikasi."], lasa_notes: [], missing_fields: ["interaksi"] },
  disclaimer: "bukan nasihat medis",
  notes: ["catatan"],
};

const INTER_PAYLOAD = {
  query: "metronidazol + warfarin",
  drugs: [
    { input: "metronidazol", display: "Metronidazol", catalogue: "Metronidazol", rxcui: { rxcui: "6922", name: "Metronidazole", source: "https://mor.nlm.nih.gov/RxNav" }, chembl: { actions: [{ action: "inhibitor", mechanism: "CYP2C9" }] } },
    { input: "warfarin", display: "warfarin", catalogue: null, rxcui: { rxcui: "11289", name: "warfarin", source: "https://mor.nlm.nih.gov/RxNav" }, chembl: null },
  ],
  pairs: [{ a: "Metronidazol", b: "warfarin", severity: "tinggi", mechanism: "Inhibisi CYP2C9", advice: "Pantau INR", source: "Interaksi obat umum/label", reviewed: false }],
  mentions: [{ label_of: "Metronidazol", about: "warfarin", quote: "Kutipan label.", source: "https://example.org/label", label_term: "metronidazole" }],
  notes: [],
  rxnav_note: "RxNav interaction retired",
  disclaimer: "informatif",
};

function sseResponse(events) {
  const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  let sent = false;
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => body,
    body: {
      getReader() {
        return {
          read: async () => {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: new TextEncoder().encode(body) };
          },
        };
      },
    },
  };
}

async function fetchStub(url, options) {
  const href = String(url);
  if (href.includes("/api/ai/estimate")) {
    return { ok: true, status: 200, json: async () => ({ estimate_idr: 200 }), text: async () => "{}" };
  }
  if (href.includes("/api/ai/chat")) {
    let question = "";
    try {
      question = JSON.parse(options?.body || "{}").question || "";
    } catch {
      question = "";
    }
    // Fixture khusus: klaim yang sama muncul di DUA paragraf (uji dedup footer).
    if (question.includes("duplikat")) {
      return sseResponse([
        ["meta", { estimate_idr: 200, evidence_count: 1 }],
        ["delta", { text: "Kalimat sama tanpa sumber ini muncul lagi di sini.\n\n" }],
        ["delta", { text: "Kalimat sama tanpa sumber ini muncul lagi di sini." }],
        ["citation_summary", { support_rate: 0, unsupported: ["Kalimat sama tanpa sumber ini muncul lagi di sini"] }],
        ["done", { charged_idr: 100, balance_idr: 49900, mode: "extractive", abstain: false }],
      ]);
    }
    return sseResponse([
      ["meta", { estimate_idr: 200, evidence_count: 2 }],
      ["delta", { text: "Metformin menurunkan HbA1c pada diabetes tipe 2 [1]. " }],
      ["delta", { text: "Klaim tambahan tanpa sumber ini perlu ditandai." }],
      ["citation", { n: 1, title: "Study one", source: "europepmc", url: "https://example.org/1" }],
      ["citation", { n: 2, title: "PNPK TB: paduan berbasis resistensi", source: "guideline", url: "https://kemkes.go.id/pnpk-tb", guideline: { tier: "pnk", label: "PNPK", edisi: "2024", locator: "hal. 12" } }],
      [
      "citation_summary",
      {
        support_rate: 0.5,
        unsupported: ["Klaim tambahan tanpa sumber ini perlu ditandai", "Singkat"],
        claims: [
          { text: "Metformin menurunkan HbA1c pada diabetes tipe 2", citations: [1], supported: true },
          { text: "Klaim tambahan tanpa sumber ini perlu ditandai", citations: [], supported: false },
        ],
      },

      ],
      ["done", { charged_idr: 100, balance_idr: 49900, mode: "llm", abstain: false }],
    ]);
  }
  if (href.includes("/api/credits/me") && creditBalance !== null) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ balance_idr: creditBalance, balance_micro_idr: creditBalance * 1_000_000, plan: "free", ai_locked: creditBalance <= 0 }),
      text: async () => JSON.stringify({ balance_idr: creditBalance }),
    };
  }
  if (href.includes("/auth/v1/token") || href.includes("/auth/v1/verify")) {
    return { ok: true, status: 200, json: async () => AUTH_PAYLOAD, text: async () => JSON.stringify(AUTH_PAYLOAD) };
  }
  if (href.includes("/auth/v1/otp")) {
    return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" };
  }
  if (href.includes("/auth/v1/user")) {
    return { ok: true, status: 200, json: async () => AUTH_PAYLOAD.user, text: async () => JSON.stringify(AUTH_PAYLOAD.user) };
  }
  if (url.includes("/api/credits/") || url.includes("/api/ai/")) {
    return {
      ok: false,
      status: 401,
      json: async () => ({ error: "unauthorized" }),
      text: async () => JSON.stringify({ error: "unauthorized" }),
    };
  }
  const body = url.includes("/api/answer")
    ? ANSWER_PAYLOAD
    : url.includes("/api/search")
      ? SEARCH_PAYLOAD
      : url.includes("/api/drug")
        ? DRUG_PAYLOAD
        : url.includes("/api/interactions")
          ? INTER_PAYLOAD
          : url.includes("/data/topics.json")
            ? { topics: [{ slug: "tb", label: "Tuberkulosis (TB)", query: "tuberculosis", desc: "Bukti TB" }] }
            : { sources: [] };
  return { ok: true, status: 200, json: async () => body };
}

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  AbortSignal,
  URL,
  URLSearchParams,
  TextEncoder,
  TextDecoder,
  fetch: fetchStub,
  window: null,
  document: documentStub,
  location: locationStub,
  history: { replaceState(_state, _title, url) { if (url) locationStub.hash = ""; } },
  localStorage: localStorageStub,
  sessionStorage: localStorageStub,
  navigator: { serviceWorker: { register: () => ({ catch() {} }) }, clipboard: { writeText: () => Promise.resolve() } },
};
sandbox.window = sandbox;
sandbox.window.addEventListener = (event, cb) => { (handlers[event] = handlers[event] || []).push(cb); };
sandbox.globalThis = sandbox;
sandbox.__setBalance = (value) => {
  creditBalance = value;
};

vm.createContext(sandbox);

const files = ["js/brand.js", "js/config.js", "js/auth.js", "js/topics.js", "js/patterns.js", "js/intent.js", "js/search.js", "js/answer.js", "js/drug.js", "js/interactions.js", "js/credits.js", "js/ai.js", "js/saldo.js", "js/masuk.js", "js/app.js"];
for (const file of files) {
  const code = fs.readFileSync(path.join(ROOT, file), "utf8");
  vm.runInContext(code, sandbox, { filename: file });
}

async function dispatchHash(hash) {
  locationStub.hash = hash;
  for (const cb of handlers.hashchange || []) cb();
  await new Promise((resolve) => setTimeout(resolve, 20));
}

(async () => {
  const results = [];

  await new Promise((resolve) => setTimeout(resolve, 30));
  const home = registry.get("view").innerHTML;
  results.push(["home renders hero", home.includes("Literatur medis dunia")]);
  results.push(["home topics dari JSON (fallback aman)", home.includes("Tuberkulosis (TB)") || home.includes("topics") || home.includes("topic")]);
  results.push([
    "home: tombol mode AI tampil (pola Google)",
    home.includes('id="ai-mode"') && home.includes("✦ AI"),
  ]);
  results.push(["home: status AI tampil (ai-hint)", home.includes("ai-hint")]);
  results.push(["home: wadah saran pola", home.includes('id="pattern-suggest"')]);
  const intentApi = sandbox.BIOXIP_INTENT;
  results.push([
    "R2: intent classifier tersedia",
    Boolean(intentApi) && intentApi.classifyIntent("interaksi warfarin dan amiodaron").type === "interaction" && intentApi.classifyIntent("parasetamol").type === "drug",
  ]);
  const qHome = registry.get("q");
  if (qHome) {
    qHome.value = "interaksi warfarin dan amiodaron";
    qHome.trigger("input", {});
  }
  await new Promise((resolve) => setTimeout(resolve, 220));
  const sugg = registry.get("pattern-suggest")?.innerHTML || "";
  results.push(["R3: saran pola mengikuti intent", sugg.includes("Cek interaksi obat"), sugg.slice(0, 120)]);
  const homeHint = registry.get("ai-hint")?.innerHTML || "";
  results.push([
    "home: pengguna belum masuk diarahkan ke #/masuk",
    homeHint.includes('href="#/masuk"'),
    homeHint.slice(0, 90),
  ]);

  await dispatchHash("#/answer?q=metformin%20vs%20insulin%20diabetes");
  const answer = registry.get("answer-body")?.innerHTML || "";
  results.push(["answer: segmented tabs", answer.includes('data-tab="ringkasan"') && answer.includes('data-tab="studi"')]);
  results.push(["answer: TL;DR card", answer.includes("tldr")]);
  results.push(["answer: WhatsApp share", answer.includes("wa.me")]);
  results.push(["answer: study cards", answer.includes("Study one") && answer.includes("data-cite")]);
  results.push(["answer: bottom sheet button", answer.includes("data-study")]);

  await dispatchHash("#/search?q=dengue&per_page=100");
  await new Promise((resolve) => setTimeout(resolve, 80));
  const search = registry.get("results")?.innerHTML || "";
  results.push(["search renders results", search.includes("Dengue paper")]);
  results.push(["R1: blok 'Bukti ilmiah' berlabel", search.includes("Bukti ilmiah")]);
  results.push(["R1: CTA buat jawaban AI", search.includes("Buat jawaban AI"), search.slice(0, 120)]);

  await dispatchHash("#/drug?q=parasetamol");
  const drug = registry.get("drug-body")?.innerHTML || "";
  results.push(["drug: kartu + Fornas", drug.includes("Parasetamol") && drug.includes("Fornas")]);
  results.push(["drug: banner keselamatan", drug.includes("Perlu diperhatikan")]);
  results.push(["drug: RxNorm", drug.includes("RxCUI")]);
  results.push(["drug: monitoring kurasi", drug.includes("Monitoring") && drug.includes("menunggu verifikasi")]);
  results.push(["drug: label + field kosong", drug.includes("Label resmi") && drug.includes("Tidak ditemukan di sumber")]);

  await dispatchHash("#/interactions?q=metronidazol%20%2B%20warfarin");
  const inter = registry.get("inter-body")?.innerHTML || "";
  results.push(["interactions: obat diperiksa", inter.includes("Metronidazol") && inter.includes("RxCUI")]);
  results.push(["interactions: pasangan terkurasi + severity", inter.includes("Interaksi terkurasi") && inter.includes("tinggi") && inter.includes("Pantau INR")]);
  results.push(["interactions: kutipan label", inter.includes("Disebutkan di label") && inter.includes("Kutipan label")]);

  await dispatchHash("#/search?q=dengue&mode=ai");
  const view = registry.get("view").innerHTML;
  results.push(
    ["mode: kontrol AI di bar (bukan segmented terpisah)", view.includes('id="ai-mode"') && view.includes('aria-pressed="true"')],
  );
  results.push(["mode AI: panel tampil", view.includes('id="ai-panel"')]);
  const aiAsk = registry.get("ai-ask")?.innerHTML || "";
  results.push(
    ["mode AI: terkunci tanpa akun", aiAsk.includes("memerlukan akun") || aiAsk.includes("Masuk")],
  );

  // Klaim tanpa sitasi harus ditandai langsung di dalam teks jawaban (bukan hanya %).
  const markUnsupported = sandbox.BIOXIP_AI?.markUnsupported;
  const marked = markUnsupported
    ? markUnsupported("Metformin menurunkan HbA1c pada pasien diabetes tipe 2.", ["Metformin menurunkan HbA1c"])
    : { html: "", marked: 0 };
  results.push([
    "ai: klaim tanpa sitasi ditandai inline",
    marked.marked === 1 && marked.html.includes('<mark class="unsupported"'),
    JSON.stringify(marked),
  ]);
  const clean = markUnsupported ? markUnsupported("Semua klaim di sini punya sitasi.", []) : { html: "", marked: 0 };
  results.push(["ai: tanpa klaim unsupported tidak ada mark", clean.marked === 0 && !clean.html.includes("<mark")]);
  const xss = markUnsupported
    ? markUnsupported("Klaim <script>alert(1)</script> berbahaya.", ["Klaim <script>alert(1)</script>"])
    : { html: "", marked: 0 };
  results.push([
    "ai: penandaan tetap meng-escape HTML",
    xss.html.includes("&lt;script&gt;") && !xss.html.includes("<script>"),
    xss.html,
  ]);
  // Unicode yang berubah panjang saat di-lowercase tidak boleh menggeser rentang penandaan.
  const unicode = markUnsupported
    ? markUnsupported("AAAİBBB klaim tanpa sumber yang panjang di sini.", ["klaim tanpa sumber yang panjang"])
    : { html: "", marked: 0 };
  results.push([
    "ai: penandaan tetap akurat dengan karakter Unicode",
    unicode.marked === 1 && unicode.html.includes('>klaim tanpa sumber yang panjang</mark>'),
    unicode.html,
  ]);

  // Integrasi penuh: alur SSE nyata → klaim tanpa sitasi ditandai di teks jawaban.
  storageMap.set("bioxip-access-token", "test-access-token");
  sandbox.__setBalance(50000);
  await dispatchHash("#/search?q=metformin&mode=ai");
  const runBtn = registry.get("ai-run");
  results.push([
    "ai: tombol Tanya AI siap saat saldo cukup",
    Boolean(runBtn) && (registry.get("ai-ask")?.innerHTML || "").includes("Tanya AI"),
    registry.get("ai-ask")?.innerHTML || "",
  ]);
  results.push([
    "ai: tanpa estimasi harga di UI (info = sisa saldo)",
    !(registry.get("ai-ask")?.innerHTML || "").includes("≈") && (registry.get("ai-status")?.innerHTML || "").includes("Sisa saldo"),
    (registry.get("ai-status")?.innerHTML || "").slice(0, 90),
  ]);
  runBtn?.trigger("click", {});
  await new Promise((resolve) => setTimeout(resolve, 30));
  const streamedText = registry.get("ai-text")?.innerHTML || "";
  results.push([
    "ai: klaim tanpa sitasi ditandai di jawaban ter-stream",
    streamedText.includes('<mark class="unsupported"') && streamedText.includes("Klaim tambahan tanpa sumber"),
    streamedText,
  ]);
  const streamedCites = registry.get("ai-cites")?.innerHTML || "";
  results.push([
    "ai: footer menghitung klaim ditandai secara akurat (parsial)",
    streamedCites.includes("1 dari 2 klaim tanpa sitasi ditandai") && streamedCites.includes("Singkat"),
    streamedCites.slice(0, 160),
  ]);
  results.push([
    "ai: bullet klaim kunci tampil dari claims[]",
    streamedCites.includes("Klaim kunci") && streamedCites.includes("Metformin menurunkan HbA1c") && streamedCites.includes("cite-1"),
    streamedCites.slice(0, 200),
  ]);
  results.push(["ai: tombol salin daftar sumber tampil", streamedCites.includes("Salin daftar sumber")]);
  results.push([
    "ai: badge pedoman lokal tampil di sumber",
    streamedCites.includes("PNPK") && streamedCites.includes("hal. 12"),
    streamedCites.slice(0, 200),
  ]);
  results.push(["ai: indikator kekuatan bukti tampil", streamedCites.includes("Kekuatan bukti")]);
  results.push([
    "ai: status tanpa estimasi rupiah (cukup jumlah bukti)",
    (registry.get("ai-status")?.innerHTML || "").includes("sumber bukti") &&
      !(registry.get("ai-status")?.innerHTML || "").includes("Estimasi"),
    registry.get("ai-status")?.innerHTML || "",
  ]);
  results.push([
    "ai: penanda [1] di badan jawaban menjadi tautan sitasi",
    streamedText.includes('data-ai-cite="1"') && streamedText.includes("cite-link"),
    streamedText.slice(0, 200),
  ]);
  results.push([
    "ai: sumber menaut balik ke klaim (dua arah)",
    streamedCites.includes("dirujuk klaim") && streamedCites.includes('data-ai-claim="1"'),
    streamedCites.slice(0, 220),
  ]);
  results.push([
    "ai: sitasi tidak memakai href hash / data-cite polos",
    !streamedCites.includes('href="#cite-') &&
      !streamedText.includes('href="#cite-') &&
      !streamedText.includes('data-cite="'),
  ]);

  // Klaim sama di dua paragraf tidak boleh menghasilkan hitungan mustahil ("2 dari 1").
  await dispatchHash("#/search?q=duplikat&mode=ai");
  await new Promise((resolve) => setTimeout(resolve, 10));
  registry.get("ai-run")?.trigger("click", {});
  await new Promise((resolve) => setTimeout(resolve, 30));
  const dupCites = registry.get("ai-cites")?.innerHTML || "";
  results.push([
    "ai: klaim duplikat lintas-paragraf dihitung sekali",
    dupCites.includes("1 dari 1 klaim tanpa sitasi ditandai") && !dupCites.includes("2 dari 1"),
    dupCites.slice(0, 160),
  ]);
  storageMap.delete("bioxip-access-token");
  sandbox.__setBalance(null);

  // N3: filter "Bukti klinis" tersedia di halaman hasil.
  await dispatchHash("#/search?q=tuberkulosis");
  const viewHtml = sandbox.document.getElementById("view")?.innerHTML || "";
  results.push(["search: chip filter 'Bukti klinis (RCT/SR)' tersedia", viewHtml.includes("f-clinical"), viewHtml.slice(0, 120)]);

  // Uji nyata: submit dari mode AI harus mempertahankan mode + filter.
  const formStub = registry.get("search-form");
  formStub.listeners = {};
  await dispatchHash("#/search?q=dengue&mode=ai");
  const qInput = registry.get("q");
  if (qInput) qInput.value = "dengue baru";
  registry.get("search-form").trigger("submit", { preventDefault() {} });
  const afterSubmit = locationStub.hash;
  results.push([
    "mode AI: submit mempertahankan mode=ai",
    afterSubmit.includes("mode=ai") && afterSubmit.includes("q=dengue"),
    afterSubmit,
  ]);
  results.push([
    "mode AI: submit tidak menghilangkan mode",
    !afterSubmit.startsWith("#/search?q=dengue+baru&") ||
      new URLSearchParams(afterSubmit.split("?")[1] || "").get("mode") === "ai",
  ]);

  await dispatchHash("#/saldo");
  const saldo = registry.get("saldo-body")?.innerHTML || "";
  results.push(["saldo: halaman render", saldo.includes("Belum masuk") || saldo.includes("Saldo")]);
  results.push(["saldo: catatan gratis tetap jalan", saldo.includes("gratis") || saldo.includes("Belum masuk")]);
  results.push(["saldo: tombol top-up paket", saldo.includes("data-topup") || saldo.includes("Belum masuk")]);

  await dispatchHash("#/harga");
  const harga = registry.get("view").innerHTML;
  results.push(["harga: paket tampil", harga.includes("50.000") && harga.includes("500.000")]);

  // Halaman masuk (belum login) menampilkan tombol Google + form email/OTP.
  localStorageStub.clear();
  await dispatchHash("#/masuk");
  const masuk = registry.get("view").innerHTML;
  results.push(["masuk: tombol Google", masuk.includes("auth-google") && masuk.includes("Google")]);
  results.push(["masuk: form email & OTP", masuk.includes("auth-email-form") && masuk.includes("auth-otp-form")]);
  results.push(["masuk: catatan data pasien", masuk.includes("data pasien")]);

  // Auth: token di URL (implicit flow) harus diserap → kembali ke beranda, bukan 404.
  const tokenHash =
    "#access_token=test-access-token&refresh_token=test-refresh-token&expires_in=3600&token_type=bearer";
  await dispatchHash(tokenHash);
  const afterAuth = registry.get("view").innerHTML;
  results.push([
    "auth: token di hash diserap (bukan 404)",
    !afterAuth.includes("Halaman tidak ditemukan"),
    afterAuth.slice(0, 60),
  ]);
  results.push([
    "auth: sesi tersimpan",
    storageMap.get("bioxip-access-token") === "test-access-token",
    String(storageMap.get("bioxip-access-token") || "-"),
  ]);
  results.push(["auth: URL dibersihkan", !locationStub.hash.includes("access_token"), locationStub.hash]);

  // Setelah sesi tersimpan, halaman masuk berubah menjadi kartu akun.
  await dispatchHash("#/masuk");
  const account = registry.get("view").innerHTML;
  results.push([
    "masuk: kartu akun setelah login",
    account.includes("arinulhaq") || account.includes("lunira.milis"),
    account.slice(0, 60),
  ]);
  results.push(["masuk: tombol keluar", account.includes("auth-signout") || account.includes("Keluar")]);

  // Pengguna login dengan saldo Rp0: beranda harus menjelaskan AI terkunci + arahkan isi saldo.
  sandbox.__setBalance(0);
  await dispatchHash("#/");
  await new Promise((resolve) => setTimeout(resolve, 40));
  const homeZero = registry.get("ai-hint")?.innerHTML || registry.get("view").innerHTML;
  results.push([
    "home: saldo Rp0 → AI terkunci + arahkan isi saldo",
    homeZero.includes("Isi saldo") || homeZero.includes("terkunci"),
    homeZero.slice(0, 90),
  ]);

  // Pengguna login dengan saldo tersedia: beranda menawarkan Tanya AI.
  sandbox.__setBalance(50000);
  await dispatchHash("#/");
  await new Promise((resolve) => setTimeout(resolve, 40));
  const homeFunded = registry.get("ai-hint")?.innerHTML || registry.get("view").innerHTML;
  results.push([
    "home: saldo tersedia → tampilkan saldo",
    (homeFunded.includes("saldo") || homeFunded.includes("Sisa saldo")) && registry.get("view").innerHTML.includes('id="ai-mode"'),
    homeFunded.slice(0, 90),
  ]);
  sandbox.__setBalance(null);

  let failed = 0;
  for (const [name, ok] of results) {
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  }
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error("HARNESS ERROR:", error);
  process.exit(1);
});
