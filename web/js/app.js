(() => {
  const S = window.BIOXIP_SEARCH;
  const view = document.getElementById("view");
  const TOPICS = window.BIOXIP_TOPICS || [];
  const MAX_PAGES = 5;

  const nav = { key: null, pages: [], cursors: null, upstream: 0 };

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
        <p class="muted">Pencarian langsung ke Europe PMC (PubMed, preprint), ClinicalTrials.gov, PubChem, ChEMBL &amp; Open Targets.</p>
        <form id="search-form" class="searchbox">
          <input id="q" name="q" type="search" autocomplete="off"
                 placeholder="mis. obat diabetes untuk PCOS" aria-label="Pertanyaan riset" />
          <button type="submit">Cari</button>
        </form>
        <div class="quick">
          <label class="check"><input type="checkbox" id="f-oa" /> Open Access saja</label>
          <label class="check"><input type="checkbox" id="f-indonesia" /> Penelitian Indonesia</label>
          <a class="muted" href="#/answer">Atau buat jawaban klinis (PICO) →</a>
        </div>
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

  function topicChips() {
    const host = document.getElementById("topics");
    if (!host) return;
    host.innerHTML = TOPICS.map(
      (t) => `<a class="topic" href="#/search?q=${encodeURIComponent(t.query)}">${t.label}<small>${t.desc}</small></a>`
    ).join("");
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
      if (document.getElementById("f-oa")?.checked) params.set("oa", "true");
      if (document.getElementById("f-indonesia")?.checked) params.set("indonesia", "true");
      location.hash = `#/search?q=${encodeURIComponent(q)}&${params.toString()}`;
    });
  }

  function resultsHTML() {
    const url = new URLSearchParams(location.hash.split("?")[1] || "");
    const q = url.get("q") || "";
    return `
      <form id="search-form" class="searchbox compact">
        <input id="q" name="q" type="search" value="${S.escape(q)}" autocomplete="off" />
        <button type="submit">Cari</button>
      </form>
      <div class="quick">
        <label class="check"><input type="checkbox" id="f-oa" ${url.get("oa") === "true" ? "checked" : ""} /> OA</label>
        <label class="check"><input type="checkbox" id="f-indonesia" ${url.get("indonesia") === "true" ? "checked" : ""} /> Indonesia</label>
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
      <div id="results"></div>
      <div id="pager"></div>`;
  }

  function currentFilters(url) {
    const filters = {
      oa: url.get("oa") === "true",
      indonesia: url.get("indonesia") === "true",
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
    return `${q}|${filters.types.join(",")}|${filters.oa}|${filters.indonesia}|${filters.sort}|${filters.perPage}`;
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
    host.insertAdjacentHTML(
      "beforeend",
      items.map((doc) => S.renderResult(doc)).join("") ||
        '<p class="muted">Tidak ada hasil. Coba kata lain atau filter lebih sedikit.</p>'
    );
    host.insertAdjacentHTML("beforeend", S.renderNote(current));
    renderPager(q, filters, page);
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

  function hashFor(q, filters, page) {
    const params = new URLSearchParams();
    params.set("q", q);
    if (filters.oa) params.set("oa", "true");
    if (filters.indonesia) params.set("indonesia", "true");
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
    const raw = location.hash.slice(2) || "";
    const [pathPart, queryPart] = raw.split("?");
    const path = pathPart.split("/").filter(Boolean);
    markNav(navNameFor(path));

    if (path.length === 0) {
      view.innerHTML = homeHTML();
      topicChips();
      stats();
      searchFormHandler();
    } else if (path[0] === "search") {
      view.innerHTML = resultsHTML();
      searchFormHandler();
      runSearch();
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
      const copy = event.target.closest("[data-copy]");
      if (copy) {
        navigator.clipboard?.writeText(copy.dataset.copy).catch(() => {});
        return;
      }
    });

    document.addEventListener("change", (event) => {
      const ids = ["f-oa", "f-indonesia", "f-paper", "f-preprint", "f-trial", "f-sort", "f-per"];
      if (!ids.includes(event.target.id)) return;
      const current = new URLSearchParams(location.hash.split("?")[1] || "");
      const q = current.get("q");
      if (!q) return;
      current.delete("oa");
      current.delete("indonesia");
      current.delete("f-paper");
      current.delete("f-preprint");
      current.delete("f-trial");
      current.delete("page");
      const values = {
        "f-oa": "oa",
        "f-indonesia": "indonesia",
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
    if (["answer", "drug", "sources", "legal"].includes(path[0])) return path[0];
    return "home";
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
  route();
})();
