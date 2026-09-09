(() => {
  const S = window.BIOXIP_SEARCH;
  const view = document.getElementById("view");
  const TOPICS = window.BIOXIP_TOPICS || [];

  function brand() {
    document.querySelectorAll("[data-brand]").forEach((el) => {
      el.textContent = window.BIOXIP.name;
    });
    document.title = `${window.BIOXIP.name} — ${window.BIOXIP.taglineID}`;
  }

  function setHeader(q) {
    const url = new URLSearchParams(location.hash.split("?")[1] || "");
    const box = document.getElementById("q");
    if (box && box.value === "") box.value = q;
    if (url.get("indonesia") === "true") {
      const el = document.getElementById("f-indonesia");
      if (el) el.checked = true;
    }
    if (url.get("oa") === "true") {
      const el = document.getElementById("f-oa");
      if (el) el.checked = true;
    }
  }

  function homeHTML() {
    return `
      <section class="hero">
        <h1>Literatur medis dunia,<br/>untuk peneliti Indonesia.</h1>
        <p class="muted">Cari paper, preprint, dan uji klinis internasional dengan Bahasa Indonesia.</p>
        <form id="search-form" class="searchbox">
          <input id="q" name="q" type="search" autocomplete="off"
                 placeholder="mis. obat diabetes untuk PCOS" aria-label="Pertanyaan riset" />
          <button type="submit">Cari</button>
        </form>
        <div class="quick">
          <button class="btn ghost" data-sort="date">Terbaru dulu</button>
          <label class="check"><input type="checkbox" id="f-oa" /> Open Access saja</label>
          <label class="check"><input type="checkbox" id="f-indonesia" /> Penelitian Indonesia</label>
        </div>
      </section>
      <section>
        <h2>Telusuri berdasarkan topik</h2>
        <div id="topics" class="topics"></div>
      </section>
      <section>
        <h2>Indeks kami</h2>
        <div id="stats" class="stats"><span class="muted">Memuat statistik…</span></div>
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
      const total = (data.sources || []).reduce((sum, s) => sum + Number(s.active || 0), 0);
      host.innerHTML = `<strong>${total.toLocaleString("id-ID")}</strong> dokumen aktif terindeks`;
    } catch {
      host.innerHTML = '<span class="muted">Statistik belum tersedia.</span>';
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
      if (document.getElementById("f-oa").checked) params.set("oa", "true");
      if (document.getElementById("f-indonesia").checked) params.set("indonesia", "true");
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
      </div>
      <div id="filters-tip" class="muted"></div>
      <div id="results"></div>
      <div id="pager"></div>`;
  }

  async function runSearch() {
    const url = new URLSearchParams(location.hash.split("?")[1] || "");
    const q = url.get("q") || "";
    if (!q) return;
    setHeader(q);
    const filters = {
      oa: url.get("oa") === "true",
      indonesia: url.get("indonesia") === "true",
      sort: url.get("sort") || "relevance",
      types: [],
    };
    ["paper", "preprint", "trial"].forEach((t) => {
      if (url.get(`f-${t}`) === "true") filters.types.push(t);
    });
    const page = Math.max(1, Number(url.get("page")) || 1);
    const host = document.getElementById("results");
    host.innerHTML = '<p class="muted">Mencari…</p>';
    try {
      const data = await S.run(q, filters, page);
      host.innerHTML = `<p class="muted">${Number(data.total || 0).toLocaleString("id-ID")} hasil untuk "${S.escape(q)}"</p>`;
      host.insertAdjacentHTML(
        "beforeend",
        (data.results || []).map((doc) => S.resultHTML(doc)).join("") ||
          '<p class="muted">Tidak ada hasil. Coba kata lain atau filter lebih sedikit.</p>'
      );
      pager(q, filters, data.total || 0, page);
    } catch (error) {
      host.innerHTML = `<p class="muted">${S.escape(error.message)}</p>`;
    }
  }

  function pager(q, filters, total, page) {
    const host = document.getElementById("pager");
    const pages = Math.ceil(total / 20);
    if (pages <= 1) {
      host.innerHTML = "";
      return;
    }
    let out = "";
    if (page > 1) out += `<a href="${hashFor(q, filters, page - 1)}">‹ Sebelumnya</a>`;
    if (page < pages) out += `<a href="${hashFor(q, filters, page + 1)}">Berikutnya ›</a>`;
    host.innerHTML = out;
  }

  function hashFor(q, filters, page) {
    const params = new URLSearchParams();
    params.set("q", q);
    if (filters.oa) params.set("oa", "true");
    if (filters.indonesia) params.set("indonesia", "true");
    if (filters.sort && filters.sort !== "relevance") params.set("sort", filters.sort);
    if (filters.types && filters.types.length) {
      filters.types.forEach((t) => params.set(`f-${t}`, "true"));
    }
    params.set("page", String(page));
    return `#/search?${params.toString()}`;
  }

  function sourcesHTML() {
    return `<h1>Sumber data</h1><p class="muted">Kami mengindex metadata publikasi terbuka dan menautkan ke sumber aslinya.</p><div id="stats"></div>`;
  }

  function legalHTML() {
    return `<h1>Kebijakan</h1>
      <p><a href="#/legal/sumber">Sumber data &amp; lisensi</a></p>
      <p><a href="#/legal/privasi">Privasi</a></p>
      <p><a href="#/legal/hakcipta">Hak cipta &amp; DMCA</a></p>`;
  }

  function legalDetail(slug) {
    const texts = {
      sumber: [
        "Sumber data & lisensi",
        "bioXip menampilkan metadata dan abstrak dari Europe PMC (PubMed, bioRxiv, medRxiv, PMC), ClinicalTrials.gov, dan OpenAlex. Konten ditautkan ke sumber asli. Penggunaan tunduk pada ketentuan masing-masing penyedia. Jangan menyimpan atau mendistribusikan full-text non-open-access.",
      ],
      privasi: [
        "Privasi",
        "Kami tidak memerlukan akun untuk mencari. Query dicatat secara agregat untuk meningkatkan kualitas. Kami tidak menjual data pribadi.",
      ],
      hakcipta: [
        "Hak cipta & DMCA",
        "bioXip tidak meng-hosting artikel. Semua hak cipta artikel tetap pada pemegangnya. Laporan pelanggaran: lihat halaman kontak.",
      ],
    };
    const entry = texts[slug] || [slug, "Dokumen ini akan dilengkapi."];
    return `<h1>${entry[0]}</h1><p>${entry[1]}</p>`;
  }

  function route() {
    const raw = location.hash.slice(2) || "";
    const [pathPart, queryPart] = raw.split("?");
    const path = pathPart.split("/").filter(Boolean);
    document.getElementById("drawer").hidden = true;
    const q = (queryPart ? new URLSearchParams(queryPart).get("q") : "") || "";

    if (path.length === 0 || path[0] === "") {
      view.innerHTML = homeHTML();
      topicChips();
      stats();
      searchFormHandler();
    } else if (path[0] === "search") {
      view.innerHTML = resultsHTML();
      searchFormHandler();
      runSearch();
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
      const open = event.target.closest("[data-open]");
      if (open) {
        event.preventDefault();
        S.openDrawer(open.dataset.open);
        return;
      }
      if (event.target.closest("[data-close-drawer]")) {
        document.getElementById("drawer").hidden = true;
        return;
      }
      const copy = event.target.closest("[data-copy]");
      if (copy) {
        navigator.clipboard?.writeText(copy.dataset.copy).catch(() => {});
        return;
      }
      const chip = event.target.closest("[data-sort]");
      if (chip) {
        const url = new URLSearchParams(location.hash.split("?")[1] || "");
        url.set("sort", chip.dataset.sort);
        location.hash = `#/search?${url.toString()}`;
      }
    });

    document.addEventListener("change", (event) => {
      const ids = ["f-oa", "f-indonesia", "f-paper", "f-preprint", "f-trial", "f-sort"];
      if (!ids.includes(event.target.id)) return;
      const current = new URLSearchParams(location.hash.split("?")[1] || "");
      const q = current.get("q");
      if (!q) return;
      current.delete("oa");
      current.delete("indonesia");
      current.delete("f-paper");
      current.delete("f-preprint");
      current.delete("f-trial");
      if (document.getElementById("f-oa")?.checked) current.set("oa", "true");
      if (document.getElementById("f-indonesia")?.checked) current.set("indonesia", "true");
      if (document.getElementById("f-paper")?.checked) current.set("f-paper", "true");
      if (document.getElementById("f-preprint")?.checked) current.set("f-preprint", "true");
      if (document.getElementById("f-trial")?.checked) current.set("f-trial", "true");
      const sortEl = document.getElementById("f-sort");
      if (sortEl && sortEl.value !== "relevance") current.set("sort", sortEl.value);
      else current.delete("sort");
      current.delete("page");
      location.hash = `#/search?${current.toString()}`;
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") document.getElementById("drawer").hidden = true;
    });
  }

  brand();
  globalEvents();
  window.addEventListener("hashchange", route);
  route();
})();
