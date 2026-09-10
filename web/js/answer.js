/* halaman jawaban PICO (mobile-first) — window.BIOXIP_ANSWER */
(() => {
  const S = window.BIOXIP_SEARCH;
  let DATA = null;
  let FILTER = "all";
  let TAB = "ringkasan";

  function esc(value) {
    return S ? S.escape(value) : String(value ?? "");
  }

  function pageHTML(q) {
    return `
      <section class="answer-head">
        <h1>Jawaban klinis (PICO)</h1>
        <p class="muted">Ringkasan bukti dikutip langsung dari abstrak studi — tanpa halusinasi AI.</p>
        <form id="answer-form" class="searchbox">
          <input id="answer-q" type="search" value="${esc(q)}" placeholder="mis. metformin vs insulin untuk DM tipe 2 obesitas" />
          <button type="submit">Buat</button>
        </form>
      </section>
      <div id="answer-body" role="status" aria-live="polite"><p class="muted">Menyiapkan…</p></div>`;
  }

  function formHandler() {
    const form = document.getElementById("answer-form");
    if (!form) return;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const q = document.getElementById("answer-q").value.trim();
      if (!q) return;
      location.hash = `#/answer?q=${encodeURIComponent(q)}`;
    });
  }

  async function load(q) {
    const body = document.getElementById("answer-body");
    if (!body) return;
    if (!q) {
      body.innerHTML = '<p class="muted">Tulis pertanyaan klinis di atas, lalu tekan "Buat".</p>';
      return;
    }
    body.innerHTML = '<p class="muted">Menelusuri studi terbaik…</p>';
    try {
      const resp = await fetch(`/api/answer?q=${encodeURIComponent(q)}`);
      if (!resp.ok) throw new Error(`gagal memuat jawaban: ${resp.status}`);
      DATA = await resp.json();
      FILTER = "all";
      TAB = "ringkasan";
      render();
    } catch (error) {
      body.innerHTML = `<p class="muted">${esc(error.message)}</p>`;
    }
  }

  function render() {
    const body = document.getElementById("answer-body");
    if (!body || !DATA) return;
    const stats = DATA.stats || {};
    const blocks = DATA.summary?.blocks || [];
    const tldr = blocks.slice(0, 3);
    const shareText = `${DATA.question}\n\nbioXip — ringkasan ${stats.total || 0} studi\n${location.href}`;

    body.innerHTML = `
      <div class="segmented" role="tablist" aria-label="Tampilan jawaban">
        <button role="tab" data-tab="ringkasan" aria-selected="${TAB === "ringkasan"}" class="${TAB === "ringkasan" ? "active" : ""}">Ringkasan</button>
        <button role="tab" data-tab="studi" aria-selected="${TAB === "studi"}" class="${TAB === "studi" ? "active" : ""}">Studi (${stats.total || 0})</button>
      </div>
      <div id="tab-ringkasan" ${TAB === "ringkasan" ? "" : "hidden"}>
        <section class="tldr">
          <h2>${esc(DATA.question)}</h2>
          ${picoChips(DATA.pico)}
          <p class="muted">Dianalisis dari ${stats.total || 0} studi${
            stats.earliest && stats.latest ? ` · ${stats.earliest}–${stats.latest}` : ""
          }${stats.open_access ? ` · ${stats.open_access} open access` : ""}</p>
          <ul>
            ${tldr
              .map((block) => `<li>${esc(trim(block.text))} ${citeButtons(block.cites)}</li>`)
              .join("") || '<li class="muted">Tidak ada kalimat ringkas yang cocok.</li>'}
          </ul>
          <p class="actions">
            <a class="btn small" target="_blank" rel="noopener"
               href="https://wa.me/?text=${encodeURIComponent(shareText)}">Bagikan ke WhatsApp</a>
            <button class="btn small ghost" data-copy="${esc(shareText)}">Salin ringkasan</button>
          </p>
        </section>
        <details class="accordion">
          <summary>Pembahasan lengkap (${blocks.length} poin)</summary>
          <ul class="answer-list">
            ${blocks
              .map((block) => `<li>${esc(block.text)} ${citeButtons(block.cites)}</li>`)
              .join("") || '<li class="muted">Tidak ada poin.</li>'}
          </ul>
        </details>
        <details class="accordion">
          <summary>Keterbatasan &amp; catatan</summary>
          <p>${esc(DATA.summary?.intro || "")}</p>
          <p class="muted">${esc(DATA.disclaimer || "")}</p>
          ${(DATA.notes || []).length ? `<p class="muted">Catatan sistem: ${esc(DATA.notes.join("; "))}</p>` : ""}
        </details>
      </div>
      <div id="tab-studi" ${TAB === "studi" ? "" : "hidden"}>
        <div class="filters">${filterButtons(stats)}</div>
        <div id="study-list">${studyCards()}</div>
      </div>`;

    bindTabs();
    bindFilters();
  }

  function filterButtons(stats) {
    const types = Object.keys(stats.by_type || {});
    return ["all", ...types]
      .map(
        (type) =>
          `<button class="chip-btn ${FILTER === type ? "active" : ""}" data-filter="${type}">${
            type === "all" ? `Semua (${stats.total})` : `${type} (${stats.by_type[type]})`
          }</button>`
      )
      .join("");
  }

  function studyCards() {
    const studies = (DATA.studies || []).filter((s) => FILTER === "all" || s.study_type === FILTER);
    if (!studies.length) return '<p class="muted">Tidak ada studi pada filter ini.</p>';
    return studies
      .map((study) => {
        const meta = [study.study_type, study.journal, study.year].filter(Boolean).map(esc).join(" · ");
        const extra = [
          study.citation_count ? `${study.citation_count} sitasi` : null,
          study.oa?.is_oa ? "Open Access" : null,
          study.phase && study.phase.length ? study.phase.join(", ") : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return `
          <article class="study" id="ref-${study.ref}">
            <h3><a href="${esc(study.url)}" target="_blank" rel="noopener">[${study.ref}] ${esc(study.title)}</a></h3>
            <p class="takeaway">${esc(takeawayOf(study))}</p>
            <p class="meta">${meta}</p>
            ${extra ? `<p class="meta">${esc(extra)}</p>` : ""}
            <p class="actions">
              <button class="btn small ghost" data-study="${study.ref}">Detail</button>
              ${study.url ? `<a class="btn small ghost" target="_blank" rel="noopener" href="${esc(study.url)}">Buka sumber</a>` : ""}
              ${study.oa?.pdf_url ? `<a class="btn small ghost" target="_blank" rel="noopener" href="${esc(study.oa.pdf_url)}">PDF</a>` : ""}
              <button class="btn small ghost" data-copy="${esc(citeOf(study))}">Salin sitasi</button>
            </p>
          </article>`;
      })
      .join("");
  }

  function takeawayOf(study) {
    const block = (DATA.summary?.blocks || []).find((b) => b.cites.includes(study.ref));
    if (block) return trim(block.text, 160);
    const sentence = String(study.abstract || "").split(/(?<=[.!?])\s+/)[0] || study.title;
    return trim(sentence, 160);
  }

  function trim(text, limit = 220) {
    const value = String(text || "").trim();
    return value.length > limit ? value.slice(0, limit).replace(/\s+\S*$/, "") + "…" : value;
  }

  function citeButtons(cites) {
    return cites.map((n) => `<button class="cite-btn" data-cite="${n}">[${n}]</button>`).join(" ");
  }

  function picoChips(pico) {
    if (!pico) return "";
    const chips = [];
    if (pico.intervention) chips.push(`<span class="chip">I: ${esc(pico.intervention)}</span>`);
    if (pico.comparison) chips.push(`<span class="chip">C: ${esc(pico.comparison)}</span>`);
    for (const term of (pico.terms || []).slice(0, 3)) chips.push(`<span class="chip">${esc(term)}</span>`);
    return chips.length ? `<div class="pico">${chips.join(" ")}</div>` : "";
  }

  function bindTabs() {
    document.querySelectorAll("[data-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        TAB = button.dataset.tab;
        document.querySelectorAll("[data-tab]").forEach((el) => {
          const active = el.dataset.tab === TAB;
          el.classList.toggle("active", active);
          el.setAttribute("aria-selected", String(active));
        });
        document.getElementById("tab-ringkasan").hidden = TAB !== "ringkasan";
        document.getElementById("tab-studi").hidden = TAB !== "studi";
      });
    });
  }

  function bindFilters() {
    document.querySelectorAll("[data-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        FILTER = button.dataset.filter;
        document.querySelectorAll("[data-filter]").forEach((el) =>
          el.classList.toggle("active", el.dataset.filter === FILTER)
        );
        document.getElementById("study-list").innerHTML = studyCards();
        bindStudyActions();
      });
    });
    bindStudyActions();
  }

  function bindStudyActions() {
    document.querySelectorAll("[data-study]").forEach((button) => {
      button.addEventListener("click", () => openStudy(Number(button.dataset.study)));
    });
  }

  function openStudy(ref) {
    const study = (DATA.studies || []).find((s) => s.ref === ref);
    if (!study || !window.BIOXIP_SHEET) return;
    const quote = (DATA.summary?.blocks || []).find((b) => b.cites.includes(ref));
    const html = `
      <h2>[${study.ref}] ${esc(study.title)}</h2>
      <p class="meta">${[study.study_type, study.journal, study.year].filter(Boolean).map(esc).join(" · ")}</p>
      <p class="muted">${esc((study.authors || []).join(", "))}</p>
      ${quote ? `<p class="quote">${esc(quote.text)}</p>` : ""}
      ${study.abstract ? `<p>${esc(trim(study.abstract, 600))}</p>` : ""}
      <p class="actions">
        <a class="btn" target="_blank" rel="noopener" href="${esc(study.url)}">Buka sumber</a>
        ${study.oa?.pdf_url ? `<a class="btn ghost" target="_blank" rel="noopener" href="${esc(study.oa.pdf_url)}">PDF</a>` : ""}
        <button class="btn ghost" data-copy="${esc(citeOf(study))}">Salin sitasi</button>
      </p>`;
    window.BIOXIP_SHEET.open(html);
  }

  function citeOf(study) {
    const authors = (study.authors || []).slice(0, 3).join(", ");
    return `${authors || study.source}. (${study.year || "n.d."}). ${study.title}. ${study.journal || study.source}. ${study.url || ""}`;
  }

  function handleCiteClick(ref) {
    const study = (DATA.studies || []).find((s) => s.ref === Number(ref));
    if (study) openStudy(study.ref);
  }

  document.addEventListener("click", (event) => {
    const cite = event.target.closest("[data-cite]");
    if (cite) handleCiteClick(cite.dataset.cite);
  });

  window.BIOXIP_ANSWER = { pageHTML, formHandler, load };
})();
