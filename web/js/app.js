(() => {
  const S = window.BIOXIP_SEARCH;
  const view = document.getElementById("view");
  let TOPICS = window.BIOXIP_TOPICS || [];
  const MAX_PAGES = 5;

  const nav = { key: null, pages: [], cursors: null, upstream: 0 };
  let aiMode = false;

  function brand() {
    document.querySelectorAll("[data-brand]").forEach((el) => {
      el.textContent = window.BIOXIP.name;
    });
    document.title = `${window.BIOXIP.name} — ${window.BIOXIP.taglineID}`;
  }

  function homeHTML() {
    return `
      <section class="hero">
        <h1>Literatur medis dunia,<br/>untuk peneliti Indonesia.</h1>
        <p class="muted">Satu kotak untuk bukti, pedoman lokal, dan kartu obat. Mode AI opsional.</p>
        ${searchBarHTML(false)}
        <p id="ai-hint" class="ai-hint muted" role="status" aria-live="polite"></p>
        <div class="quick">
          <label class="check"><input type="checkbox" id="f-oa" /> Open Access saja</label>
          <label class="check"><input type="checkbox" id="f-indonesia" /> Penelitian Indonesia</label>
          <a class="muted" href="#/answer">Panduan PICO →</a>
        </div>
        ${patternsHTML()}
      </section>
      <section>
        <h2>Telusuri berdasarkan topik</h2>
        <div id="topics" class="topics"></div>
      </section>
      <section>
        <h2>Sumber yang dijelajahi</h2>
        <div id="stats" class="stats"><span class="muted">Memuat…</span></div>
      </section>`;
  }

  function searchBarHTML(ai) {
    const placeholder = ai ? "mis. metformin vs insulin untuk DM tipe 2" : "mis. obat diabetes untuk PCOS";
    return `
      <form id="search-form" class="searchbox unified">
        <input id="q" name="q" type="search" autocomplete="off" placeholder="${placeholder}" aria-label="Pertanyaan" />
        <button type="submit" id="search-submit">${ai ? "Tanya AI" : "Cari"}</button>
        <button type="button" id="ai-mode" class="ai-mode${ai ? " active" : ""}" aria-pressed="${ai}" title="Mode AI memakai saldo">✦ AI</button>
      </form>
      <div id="pattern-suggest" class="patterns suggestions" aria-live="polite"></div>`;
  }

  function renderSuggestions(value) {
    const host = document.getElementById("pattern-suggest");
    if (!host) return;
    const I = window.BIOXIP_INTENT;
    const patterns = I?.suggestPatterns ? I.suggestPatterns(value, 3) : [];
    host.innerHTML = patterns
      .map((p) => {
        const params = new URLSearchParams();
        params.set("q", p.query || "");
        (p.filters?.types || []).forEach((t) => params.set(`f-${t}`, "true"));
        if (p.filters?.oa) params.set("oa", "true");
        if (p.filters?.indonesia) params.set("indonesia", "true");
        return `<a class="pattern" href="#/search?${params.toString()}" title="${esc(p.desc || "")}"><strong>${esc(p.label)}</strong><small>${esc(p.desc || "")}</small></a>`;
      })
      .join("");
  }

  function bindSearchBar(ai) {
    aiMode = Boolean(ai);
    const toggle = document.getElementById("ai-mode");
    if (toggle) {
      toggle.addEventListener("click", async () => {
        const A = window.BIOXIP_AUTH;
        const C = window.BIOXIP_CREDITS;
        const loggedIn = Boolean(A?.getAccessToken?.() || A?.getUser?.());
        if (!loggedIn) {
          location.hash = "#/masuk";
          return;
        }
        let balance = 0;
        let isAdmin = false;
        try {
          const me = await C.me();
          balance = me.body?.balance_idr ?? 0;
          isAdmin = Boolean(me.body?.is_admin);
        } catch {
          balance = 0;
        }
        if (balance <= 0 && !isAdmin) {
          location.hash = "#/saldo";
          return;
        }
        aiMode = !aiMode;
        if (location.hash.startsWith("#/search")) {
          const current = new URLSearchParams(location.hash.split("?")[1] || "");
          if (aiMode) current.set("mode", "ai");
          else current.delete("mode");
          current.delete("page");
          location.hash = `#/search?${current.toString()}`;
          return;
        }
        const submit = document.getElementById("search-submit");
        const input = document.getElementById("q");
        if (submit) submit.textContent = aiMode ? "Tanya AI" : "Cari";
        if (input) input.placeholder = aiMode ? "mis. metformin vs insulin untuk DM tipe 2" : "mis. obat diabetes untuk PCOS";
        toggle.classList.toggle("active", aiMode);
        toggle.setAttribute("aria-pressed", String(aiMode));
        updateAiHint();
      });
    }
    const input = document.getElementById("q");
    if (input) {
      let timer = null;
      input.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => renderSuggestions(input.value), 150);
      });
    }
    renderSuggestions(document.getElementById("q")?.value || "");
    updateAiHint();
  }

  async function updateAiHint() {
    const host = document.getElementById("ai-hint");
    if (!host) return;
    const C = window.BIOXIP_CREDITS;
    const A = window.BIOXIP_AUTH;
    const loggedIn = Boolean(A?.getAccessToken?.() || A?.getUser?.());
    if (!loggedIn) {
      host.innerHTML = aiMode
        ? 'Tanya AI memerlukan akun. <a href="#/masuk">Masuk</a> dulu — pencarian tetap gratis.'
        : 'Pencarian gratis. <a href="#/masuk">Masuk</a> untuk memakai mode AI.';
      return;
    }
    let balance = 0;
    let isAdmin = false;
    try {
      const me = await C.me();
      balance = me.body?.balance_idr ?? 0;
      isAdmin = Boolean(me.body?.is_admin);
    } catch {
      balance = 0;
    }
    if (isAdmin) {
      host.innerHTML = aiMode ? "Mode admin · tanpa biaya." : "Mode admin · pencarian & AI tanpa biaya.";
      return;
    }
    if (aiMode) {
      host.innerHTML =
        balance > 0
          ? `Mode AI · sisa saldo <strong>${esc(C.formatIdr(balance))}</strong>.`
          : `Saldo <strong>Rp 0</strong> — mode AI terkunci. <a href="#/saldo">Isi saldo</a>.`;
    } else {
      host.innerHTML =
        balance > 0
          ? `Pencarian gratis · saldo <strong>${esc(C.formatIdr(balance))}</strong>.`
          : 'Pencarian gratis. <a href="#/saldo">Isi saldo</a> untuk mode AI.';
    }
  }

  function patternsHTML() {
    const list = window.BIOXIP_PATTERNS || [];
    if (!list.length) return "";
    const chips = list
      .map((p) => {
        const params = new URLSearchParams();
        params.set("q", p.query || "");
        (p.filters?.types || []).forEach((t) => params.set(`f-${t}`, "true"));
        if (p.filters?.oa) params.set("oa", "true");
        if (p.filters?.indonesia) params.set("indonesia", "true");
        const title = `${p.desc || ""}${p.role ? ` · ${p.role}` : ""}`;
        return `<a class="pattern" href="#/search?${params.toString()}" title="${esc(title)}"><strong>${esc(p.label)}</strong><small>${esc(p.desc || "")}</small></a>`;
      })
      .join("");
    return `<div class="patterns" aria-label="Pola pertanyaan siap pakai"><p class="muted">Pola siap pakai:</p>${chips}<p class="muted">${esc(window.BIOXIP_PATTERNS_NOTE || "")}</p></div>`;
  }

  function topicChips() {
    const host = document.getElementById("topics");
    if (!host) return;
    host.innerHTML = TOPICS.map(
      (t) => `<a class="topic" href="#/search?q=${encodeURIComponent(t.query)}">${esc(t.label)}<small>${esc(t.desc)}</small></a>`
    ).join("");
  }

  async function loadTopics() {
    try {
      const resp = await fetch("/data/topics.json");
      if (!resp.ok) return;
      const data = await resp.json();
      if (Array.isArray(data.topics) && data.topics.length) TOPICS = data.topics;
    } catch {
      /* pakai daftar bawaan */
    }
  }

  function copyText(value) {
    if (!value) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).catch(() => fallbackCopy(value));
      return;
    }
    fallbackCopy(value);
  }

  function fallbackCopy(value) {
    const area = document.createElement("textarea");
    area.value = value;
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand("copy");
    } catch {
      /* abaikan */
    }
    area.remove();
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1800);
  }

  async function stats() {
    const host = document.getElementById("stats");
    try {
      const resp = await fetch("/api/sources");
      if (!resp.ok) throw new Error();
      const data = await resp.json();
      const list = (data.sources || []).map((s) => s.name).join(", ");
      host.innerHTML = `<span class="muted">Mode live — menjelajah langsung: ${esc(list)}</span>`;
    } catch {
      host.innerHTML = '<span class="muted">Sumber belum tersedia.</span>';
    }
  }

  function searchFormHandler() {
    const form = document.getElementById("search-form");
    if (!form) return;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const q = document.getElementById("q").value.trim();
      if (!q) return;
      const params = new URLSearchParams();
      params.set("q", q);
      if (aiMode) params.set("mode", "ai");
      if (document.getElementById("f-oa")?.checked) params.set("oa", "true");
      if (document.getElementById("f-indonesia")?.checked) params.set("indonesia", "true");
      if (document.getElementById("f-clinical")?.checked) params.set("clinical", "true");
      if (document.getElementById("f-paper")?.checked) params.set("f-paper", "true");
      if (document.getElementById("f-preprint")?.checked) params.set("f-preprint", "true");
      if (document.getElementById("f-trial")?.checked) params.set("f-trial", "true");
      const sortEl = document.getElementById("f-sort");
      if (sortEl && sortEl.value !== "relevance") params.set("sort", sortEl.value);
      const perEl = document.getElementById("f-per");
      if (perEl && Number(perEl.value) !== 20) params.set("per_page", perEl.value);
      location.hash = `#/search?${params.toString()}`;
    });
  }

  function resultsHTML() {
    const url = new URLSearchParams(location.hash.split("?")[1] || "");
    const q = url.get("q") || "";
    const mode = url.get("mode") === "ai" ? "ai" : "search";
    return `
      ${searchBarHTML(mode === "ai").replace(`id="q" name="q" type="search"`, `id="q" name="q" type="search" value="${S.escape(q)}"`)}
      <div class="quick">
        <label class="check"><input type="checkbox" id="f-oa" ${url.get("oa") === "true" ? "checked" : ""} /> OA</label>
        <label class="check"><input type="checkbox" id="f-indonesia" ${url.get("indonesia") === "true" ? "checked" : ""} /> Indonesia</label>
        <label class="check"><input type="checkbox" id="f-clinical" ${url.get("clinical") === "true" ? "checked" : ""} /> Bukti klinis (RCT/SR)</label>
        <label class="check"><input type="checkbox" id="f-paper" ${url.get("f-paper") === "true" ? "checked" : ""} /> paper</label>
        <label class="check"><input type="checkbox" id="f-preprint" ${url.get("f-preprint") === "true" ? "checked" : ""} /> preprint</label>
        <label class="check"><input type="checkbox" id="f-trial" ${url.get("f-trial") === "true" ? "checked" : ""} /> trial</label>
        <label>Urut <select id="f-sort">
          <option value="relevance" ${url.get("sort") === "date" ? "" : "selected"}>Relevansi</option>
          <option value="date" ${url.get("sort") === "date" ? "selected" : ""}>Tanggal</option>
          <option value="citations" ${url.get("sort") === "citations" ? "selected" : ""}>Sitasi</option>
        </select></label>
        <label>Tampil <select id="f-per">
          ${[20, 50, 100].map((n) => `<option value="${n}" ${Number(url.get("per_page")) === n ? "selected" : ""}>${n}</option>`).join("")}
        </select></label>
      </div>
      ${patternsHTML()}
      ${mode === "ai" ? window.BIOXIP_AI.panelHTML() : ""}
      <div id="results"></div>
      <div id="pager"></div>`;
  }

  function currentMode() {
    const url = new URLSearchParams(location.hash.split("?")[1] || "");
    return url.get("mode") === "ai" ? "ai" : "search";
  }

  function currentFilters(url) {
    const filters = {
      oa: url.get("oa") === "true",
      indonesia: url.get("indonesia") === "true",
      clinical: url.get("clinical") === "true",
      sort: url.get("sort") || "relevance",
      perPage: Number(url.get("per_page")) || 20,
      types: [],
    };
    ["paper", "preprint", "trial"].forEach((t) => {
      if (url.get(`f-${t}`) === "true") filters.types.push(t);
    });
    return filters;
  }

  function navKey(q, filters) {
    return `${q}|${filters.types.join(",")}|${filters.oa}|${filters.indonesia}|${filters.clinical}|${filters.sort}|${filters.perPage}`;
  }

  async function runSearch() {
    const url = new URLSearchParams(location.hash.split("?")[1] || "");
    const q = url.get("q") || "";
    if (!q) return;
    const filters = currentFilters(url);
    const page = Math.min(Math.max(1, Number(url.get("page")) || 1), MAX_PAGES);
    const key = navKey(q, filters);
    if (nav.key !== key) {
      nav.key = key;
      nav.pages = [];
      nav.cursors = null;
      nav.upstream = 0;
    }

    const host = document.getElementById("results");
    if (nav.pages.length < page) {
      host.innerHTML = `<p class="muted">Menelusuri halaman ${page}…</p>`;
      try {
        const data = await S.run(q, filters, page, nav.cursors);
        nav.upstream = Number(data.total || 0);
        nav.cursors = data.pagination || null;
        nav.pages.push({ items: data.results || [], note: data.notes || [] });
      } catch (error) {
        host.innerHTML = `<p class="muted">${S.escape(error.message)}</p>`;
        return;
      }
    }

    const current = nav.pages[page - 1];
    const items = current.items;
    const loadedRows = nav.pages.reduce((sum, p) => sum + p.items.length, 0);
    const upstream = nav.upstream;
    const shownText =
      items.length && upstream > loadedRows
        ? `Total ${upstream.toLocaleString("id-ID")} hasil di sumber — ${loadedRows.toLocaleString("id-ID")} sudah dimuat.`
        : `${upstream.toLocaleString("id-ID")} hasil di sumber.`;

    host.innerHTML = `<p class="muted">${S.escape(shownText)}</p>`;
    // Hasil adaptif: obat (bila terdeteksi) → pedoman lokal → bukti.
    const drug = await drugInlineHTML(q);
    const links = items.filter((doc) => doc.doc_type === "link");
    const guidelines = items.filter((doc) => doc.source === "guideline");
    const papers = items.filter((doc) => doc.source !== "guideline" && doc.doc_type !== "link");
    const section = (title, rows) =>
      rows.length ? `<h2 class="muted">${title} (${rows.length})</h2>${rows.map((doc) => S.renderResult(doc)).join("")}` : "";
    const aiCta = `<p class="actions"><a class="btn small ghost" href="${aiHash(q)}">Buat jawaban AI →</a></p>`;
    const body = [
      drug,
      section("Pedoman lokal", guidelines),
      section("Bukti ilmiah", papers),
      section("Tautan sumber", links),
    ].join("");
    host.insertAdjacentHTML(
      "beforeend",
      `${aiCta}${body || '<p class="muted">Tidak ada hasil. Coba kata lain atau filter lebih sedikit.</p>'}`,
    );
    host.insertAdjacentHTML("beforeend", S.renderNote(current));
    renderPager(q, filters, page);
  }

  async function drugInlineHTML(query) {
    const term = String(query || "").trim();
    // Hindari panggilan untuk pertanyaan panjang (bukan nama obat).
    if (!term || term.split(/\s+/).length > 4) return "";
    try {
      const resp = await fetch(`/api/drug?q=${encodeURIComponent(term)}`);
      if (!resp.ok) return "";
      const data = await resp.json();
      const drug = data.drug;
      if (!data.matched || !drug) return "";
      const bits = [drug.inn, drug.atc, drug.kelas].filter(Boolean).map((value) => esc(value)).join(" · ");
      return `<section class="card drug-inline"><h2>${esc(drug.name)}</h2><p class="muted">${bits}</p><p><a href="#/drug?q=${encodeURIComponent(drug.slug || term)}">Lihat kartu obat lengkap →</a></p></section>`;
    } catch {
      return "";
    }
  }

  function renderPager(q, filters, page) {
    const host = document.getElementById("pager");
    const hasMore = Boolean(nav.cursors?.epmcHasMore || nav.cursors?.ctHasMore);
    const canNext = nav.pages.length < MAX_PAGES && hasMore;
    let out = `<span class="muted">Halaman ${page}${canNext || page > 1 ? ` dari maks ${MAX_PAGES}` : ""}</span>`;
    if (page > 1) out += `<a href="${hashFor(q, filters, page - 1)}">‹ Sebelumnya</a>`;
    if (canNext) out += `<a href="${hashFor(q, filters, page + 1)}">Berikutnya ›</a>`;
    if (!canNext && page >= MAX_PAGES && nav.cursors?.epmcHasMore) {
      out += `<span class="muted"> (batas demo 500 hasil)</span>`;
    }
    host.innerHTML = out;
  }

  function aiHash(q) {
    const params = new URLSearchParams();
    params.set("q", q);
    params.set("mode", "ai");
    return `#/search?${params.toString()}`;
  }

  function hashFor(q, filters, page) {
    const params = new URLSearchParams();
    params.set("q", q);
    if (filters.oa) params.set("oa", "true");
    if (filters.indonesia) params.set("indonesia", "true");
    if (filters.clinical) params.set("clinical", "true");
    if (filters.sort && filters.sort !== "relevance") params.set("sort", filters.sort);
    if (filters.types && filters.types.length) filters.types.forEach((t) => params.set(`f-${t}`, "true"));
    if (filters.perPage && filters.perPage !== 20) params.set("per_page", String(filters.perPage));
    if (page > 1) params.set("page", String(page));
    return `#/search?${params.toString()}`;
  }

  function sourcesHTML() {
    return `<h1>Sumber data</h1><p class="muted">bioXip berjalan live: setiap pencarian menjelajah langsung koleksi upstream. Tidak ada salinan index lokal; tautan selalu ke sumber asli.</p><div id="stats"></div>`;
  }

  function legalHTML() {
    return `<h1>Kebijakan</h1>
      <p><a href="#/legal/sumber">Sumber data &amp; lisensi</a></p>
      <p><a href="#/legal/privasi">Privasi</a></p>
      <p><a href="#/legal/hakcipta">Hak cipta</a></p>`;
  }

  function legalDetail(slug) {
    const texts = {
      sumber: [
        "Sumber data & lisensi",
        "bioXip menampilkan hasil langsung dari Europe PMC (PubMed, bioRxiv, medRxiv, PMC), ClinicalTrials.gov, PubChem, ChEMBL, dan Open Targets. Konten ditautkan ke sumber asli; pengguna tunduk pada ketentuan masing-masing penyedia.",
      ],
      privasi: [
        "Privasi",
        "Tidak ada akun yang diperlukan untuk mencari. Query diproses langsung oleh penyedia sumber; kami tidak menyimpan riwayat pribadi.",
      ],
      hakcipta: [
        "Hak cipta",
        "bioXip tidak meng-hosting artikel. Hak cipta tetap pada pemegangnya. Laporan pelanggaran tersedia via halaman kontak.",
      ],
    };
    const entry = texts[slug] || [slug, "Dokumen akan dilengkapi."];
    return `<h1>${entry[0]}</h1><p>${entry[1]}</p>`;
  }

  function route() {
    const auth = window.BIOXIP_AUTH;
    const redirect = auth?.handleRedirect?.();
    const raw = location.hash.slice(2) || "";
    const [pathPart, queryPart] = raw.split("?");
    const path = pathPart.split("/").filter(Boolean);
    markNav(navNameFor(path));
    window.BIOXIP_CREDITS?.refreshBadge?.();
    updateAuthNav(redirect);

    if (path.length === 0) {
      view.innerHTML = homeHTML();
      topicChips();
      stats();
      searchFormHandler();
      bindSearchBar(false);
    } else if (path[0] === "search") {
      view.innerHTML = resultsHTML();
      searchFormHandler();
      bindSearchBar(currentMode() === "ai");
      if (currentMode() === "ai") {
        const q = new URLSearchParams(queryPart || "").get("q") || "";
        window.BIOXIP_AI.prepare(q, view);
      } else {
        runSearch();
      }
    } else if (path[0] === "masuk") {
      const message = redirect?.error ? `Masuk gagal: ${redirect.error}` : "";
      view.innerHTML = window.BIOXIP_MASUK.pageHTML(message);
      window.BIOXIP_MASUK.bind();
    } else if (path[0] === "saldo") {
      view.innerHTML = window.BIOXIP_SALDO.pageHTML();
      window.BIOXIP_SALDO.load();
      window.BIOXIP_CREDITS.refreshBadge();
    } else if (path[0] === "harga") {
      view.innerHTML = hargaHTML();
    } else if (path[0] === "answer") {
      const A = window.BIOXIP_ANSWER;
      const q = new URLSearchParams(queryPart || "").get("q") || "";
      view.innerHTML = A.pageHTML(q);
      A.formHandler();
      A.load(q);
    } else if (path[0] === "drug") {
      const D = window.BIOXIP_DRUG;
      const q = new URLSearchParams(queryPart || "").get("q") || "";
      view.innerHTML = D.pageHTML(q);
      D.formHandler();
      D.load(q);
    } else if (path[0] === "interactions") {
      const I = window.BIOXIP_INTERACTIONS;
      const q = new URLSearchParams(queryPart || "").get("q") || "";
      view.innerHTML = I.pageHTML(q);
      I.formHandler();
      I.load(q);
    } else if (path[0] === "topic") {
      const topic = TOPICS.find((t) => t.slug === path[1]);
      if (topic) {
        location.replace(`#/search?q=${encodeURIComponent(topic.query)}`);
        return;
      }
      view.innerHTML = "<h1>Topik tidak ditemukan</h1>";
    } else if (path[0] === "sources") {
      view.innerHTML = sourcesHTML();
      stats();
    } else if (path[0] === "legal") {
      view.innerHTML = path[1] ? legalDetail(path[1]) : legalHTML();
    } else {
      view.innerHTML = "<h1>Halaman tidak ditemukan</h1>";
    }
    view.scrollTop = 0;
  }

  function globalEvents() {
    document.addEventListener("click", (event) => {
      const modeButton = event.target.closest("[data-mode]");
      if (modeButton) {
        const current = new URLSearchParams(location.hash.split("?")[1] || "");
        const mode = modeButton.dataset.mode;
        if (mode === "ai") current.set("mode", "ai");
        else current.delete("mode");
        current.delete("page");
        location.hash = `#/search?${current.toString()}`;
        return;
      }
      const copy = event.target.closest("[data-copy]");
      if (copy) {
        copyText(copy.dataset.copy);
        showToast("Disalin");
        return;
      }
      const copyLink = event.target.closest("[data-copy-link]");
      if (copyLink) {
        copyText(copyLink.dataset.copyLink || location.href);
        showToast("Tautan disalin");
        return;
      }
    });

    document.addEventListener("change", (event) => {
      const ids = ["f-oa", "f-indonesia", "f-clinical", "f-paper", "f-preprint", "f-trial", "f-sort", "f-per"];
      if (!ids.includes(event.target.id)) return;
      const current = new URLSearchParams(location.hash.split("?")[1] || "");
      const q = current.get("q");
      if (!q) return;
      current.delete("oa");
      current.delete("indonesia");
      current.delete("clinical");
      current.delete("f-paper");
      current.delete("f-preprint");
      current.delete("f-trial");
      current.delete("page");
      const values = {
        "f-oa": "oa",
        "f-indonesia": "indonesia",
        "f-clinical": "clinical",
        "f-paper": "f-paper",
        "f-preprint": "f-preprint",
        "f-trial": "f-trial",
      };
      for (const [id, param] of Object.entries(values)) {
        if (document.getElementById(id)?.checked) current.set(param, "true");
      }
      const perEl = document.getElementById("f-per");
      if (perEl && Number(perEl.value) !== 20) current.set("per_page", perEl.value);
      const sortEl = document.getElementById("f-sort");
      if (sortEl && sortEl.value !== "relevance") current.set("sort", sortEl.value);
      else current.delete("sort");
      location.hash = `#/search?${current.toString()}`;
    });
  }

  function esc(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }

  function navNameFor(path) {
    if (!path.length) return "home";
    if (path[0] === "search" || path[0] === "topic") return "home";
    if (path[0] === "interactions") return "drug";
    if (path[0] === "harga") return "saldo";
    if (["answer", "drug", "saldo", "sources", "legal", "masuk"].includes(path[0])) return path[0];
    return "home";
  }

  function updateAuthNav(redirect) {
    const link = document.getElementById("auth-link");
    if (link) {
      const user = window.BIOXIP_AUTH?.getUser?.();
      link.textContent = user ? user.name.split(" ")[0] : "Masuk";
      link.setAttribute("href", user ? "#/masuk" : "#/masuk");
      link.dataset.state = user ? "in" : "out";
    }
    const banner = document.getElementById("auth-banner");
    if (banner) {
      if (redirect?.signedIn) {
        banner.hidden = false;
        banner.textContent = "Berhasil masuk. Selamat menggunakan bioXip.";
        setTimeout(() => {
          banner.hidden = true;
        }, 4000);
      } else if (redirect?.error) {
        banner.hidden = false;
        banner.textContent = `Gagal masuk: ${redirect.error}`;
      } else {
        banner.hidden = true;
      }
    }
  }

  function hargaHTML() {
    const paket = [50_000, 100_000, 150_000, 500_000];
    return `
      <section class="answer-head">
        <h1>Paket saldo</h1>
        <p class="muted">Saldo dalam Rupiah, tanpa kedaluwarsa, tanpa bonus (1:1). Pencarian & data gratis; saldo hanya untuk AI.</p>
      </section>
      <section class="answer-card">
        <h3>Pilih paket</h3>
        <ul class="answer-list">
          ${paket.map((amount) => `<li><strong>${esc(window.BIOXIP_CREDITS.formatIdr(amount))}</strong></li>`).join("")}
        </ul>
        <p class="actions"><a class="btn small" href="#/saldo">Isi saldo (QRIS / VA / e-wallet)</a></p>
      </section>
      <section class="answer-card">
        <h3>Cara biaya dihitung</h3>
        <p class="muted">Biaya per permintaan AI dihitung dari tarif DeepSeek (input cache hit/miss + output) dikali markup 12×, dibulatkan ke atas ke Rp1 dengan minimum Rp100. Info biaya cukup dari sisa saldo; Anda melihat "Terpakai" setelah jawaban selesai.</p>
      </section>`;
  }

  function markNav(name) {
    document.querySelectorAll("[data-route]").forEach((el) => {
      if (el.dataset.route === name) el.setAttribute("aria-current", "page");
      else el.removeAttribute("aria-current");
    });
  }

  function initSheet() {
    const sheet = document.getElementById("sheet");
    const backdrop = document.getElementById("sheet-backdrop");
    const body = document.getElementById("sheet-body");
    if (!sheet || !backdrop || !body) return;
    const close = () => {
      sheet.hidden = true;
      backdrop.hidden = true;
      body.innerHTML = "";
    };
    window.BIOXIP_SHEET = {
      open(html) {
        body.innerHTML = html;
        sheet.hidden = false;
        backdrop.hidden = false;
        sheet.scrollTop = 0;
        const focusable = sheet.querySelector("a, button");
        focusable?.focus?.();
      },
      close,
    };
    backdrop.addEventListener("click", close);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
    });
  }

  function initSaver() {
    const toggle = document.getElementById("saver-toggle");
    const saved = localStorage.getItem("bioxip-saver") === "true";
    document.body.classList.toggle("saver", saved);
    if (toggle) {
      toggle.checked = saved;
      toggle.addEventListener("change", () => {
        document.body.classList.toggle("saver", toggle.checked);
        localStorage.setItem("bioxip-saver", String(toggle.checked));
      });
    }
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }

  brand();
  initSheet();
  initSaver();
  registerServiceWorker();
  globalEvents();
  window.addEventListener("hashchange", route);
  window.BIOXIP_AUTH?.onAuthChange?.(() => {
    window.BIOXIP_CREDITS?.refreshBadge?.(true);
    updateAuthNav();
  });
  loadTopics().finally(() => {
    route();
    window.BIOXIP_CREDITS?.refreshBadge?.();
  });
})();
