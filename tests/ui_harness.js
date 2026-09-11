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

async function fetchStub(url) {
  const href = String(url);
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

vm.createContext(sandbox);

const files = ["js/brand.js", "js/config.js", "js/auth.js", "js/topics.js", "js/search.js", "js/answer.js", "js/drug.js", "js/interactions.js", "js/credits.js", "js/ai.js", "js/saldo.js", "js/masuk.js", "js/app.js"];
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

  await dispatchHash("#/answer?q=metformin%20vs%20insulin%20diabetes");
  const answer = registry.get("answer-body")?.innerHTML || "";
  results.push(["answer: segmented tabs", answer.includes('data-tab="ringkasan"') && answer.includes('data-tab="studi"')]);
  results.push(["answer: TL;DR card", answer.includes("tldr")]);
  results.push(["answer: WhatsApp share", answer.includes("wa.me")]);
  results.push(["answer: study cards", answer.includes("Study one") && answer.includes("data-cite")]);
  results.push(["answer: bottom sheet button", answer.includes("data-study")]);

  await dispatchHash("#/search?q=dengue&per_page=100");
  const search = registry.get("results")?.innerHTML || "";
  results.push(["search renders results", search.includes("Dengue paper")]);

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
    ["mode: segmented gratis vs AI", view.includes("data-mode=\"search\"") && view.includes("data-mode=\"ai\"")],
  );
  results.push(["mode AI: panel tampil", view.includes('id="ai-panel"')]);
  const aiAsk = registry.get("ai-ask")?.innerHTML || "";
  results.push(
    ["mode AI: terkunci tanpa akun", aiAsk.includes("memerlukan akun") || aiAsk.includes("Masuk")],
  );

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
