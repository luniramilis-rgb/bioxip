/* halaman jawaban PICO (ekstraktif) — window.BIOXIP_ANSWER */
(() => {
  const S = window.BIOXIP_SEARCH;
  let DATA = null;
  let FILTER = "all";

  function esc(value) {
    return S ? S.escape(value) : String(value ?? "");
  }

  function pageHTML(q) {
    return `
      <section class="answer-head">
        <h1>Jawaban klinis (PICO)</h1>
        <p class="muted">Ringkasan bukti dikutip langsung dari abstrak studi — tanpa halusinasi AI. Untuk pertanyaan terapi, diagnostik, prognosis, atau etiologi.</p>
        <form id="answer-form" class="searchbox">
          <input id="answer-q" type="search" value="${esc(q)}" placeholder="mis. metformin vs insulin untuk DM tipe 2 obesitas" />
          <button type="submit">Buat ringkasan</button>
        </form>
      </section>
      <div id="answer-body"><p class="muted">Menyiapkan…</p></div>`;
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
      body.innerHTML = '<p class="muted">Tulis pertanyaan klinis di atas, lalu tekan "Buat ringkasan".</p>';
      return;
    }
    body.innerHTML = '<p class="muted">Menelusuri studi terbaik…</p>';
    try {
      const resp = await fetch(`/api/answer?q=${encodeURIComponent(q)}`);
      if (!resp.ok) throw new Error(`gagal memuat jawaban: ${resp.status}`);
      DATA = await resp.json();
      FILTER = "all";
      render();
    } catch (error) {
      body.innerHTML = `<p class="muted">${esc(error.message)}</p>`;
    }
  }

  function render() {
    const body = document.getElementById("answer-body");
    if (!body || !DATA) return;
    const stats = DATA.stats || {};
    const types = Object.keys(stats.by_type || {});
    const filterButtons = ["all", ...types]
      .map(
        (type) =>
          `<button class="chip-btn ${FILTER === type ? "active" : ""}" data-filter="${type}">${
            type === "all" ? `Semua (${stats.total})` : `${type} (${stats.by_type[type]})`
          }</button>`
      )
      .join("");

    const blocks = (DATA.summary?.blocks || [])
      .map(
        (block) =>
          `<li>${esc(block.text)} <sup class="cite">${block.cites.map((n) => `<a href="#ref-${n}">[${n}]</a>`).join(" ")}</sup></li>`
      )
      .join("");

    const studies = (DATA.studies || []).filter((s) => FILTER === "all" || s.study_type === FILTER);
    const cards = studies
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
            <p class="meta">${meta}</p>
            <p class="muted">${esc((study.authors || []).join(", "))}</p>
            ${extra ? `<p class="meta">${esc(extra)}</p>` : ""}
            <p class="actions">
              <a class="btn small ghost" target="_blank" rel="noopener" href="${esc(study.url)}">Buka sumber</a>
            </p>
          </article>`;
      })
      .join("");

    body.innerHTML = `
      <section class="answer-card">
        <h2>${esc(DATA.question)}</h2>
        ${picoChips(DATA.pico)}
        <p class="muted">Dianalisis dari ${stats.total || 0} studi${
          stats.earliest && stats.latest ? ` (${stats.earliest}–${stats.latest})` : ""
        }.</p>
        <p>${esc(DATA.summary?.intro || "")}</p>
        <ul class="answer-list">${blocks || '<li class="muted">Tidak ada kalimat abstrak yang cocok untuk dirangkum.</li>'}</ul>
        <p class="muted">${esc(DATA.disclaimer || "")}</p>
      </section>
      <section class="answer-studies">
        <div class="filters">${filterButtons}</div>
        ${cards || '<p class="muted">Tidak ada studi pada filter ini.</p>'}
      </section>`;
    bindFilters();
  }

  function picoChips(pico) {
    if (!pico) return "";
    const chips = [];
    if (pico.intervention) chips.push(`<span class="chip">I: ${esc(pico.intervention)}</span>`);
    if (pico.comparison) chips.push(`<span class="chip">C: ${esc(pico.comparison)}</span>`);
    for (const term of (pico.terms || []).slice(0, 4)) chips.push(`<span class="chip">${esc(term)}</span>`);
    return chips.length ? `<div class="pico">${chips.join(" ")}</div>` : "";
  }

  function bindFilters() {
    document.querySelectorAll("[data-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        FILTER = button.dataset.filter;
        render();
      });
    });
  }

  window.BIOXIP_ANSWER = { pageHTML, formHandler, load };
})();
