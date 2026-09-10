/* drug card — window.BIOXIP_DRUG */
(() => {
  const S = window.BIOXIP_SEARCH;

  const FIELD_LABELS = {
    indikasi: "Indikasi",
    dosis: "Dosis umum (label)",
    kontraindikasi: "Kontraindikasi",
    peringatan: "Peringatan",
    peringatan_blackbox: "Peringatan kotak hitam (black box)",
    interaksi: "Interaksi obat",
    kehamilan: "Kehamilan",
    menyusui: "Menyusui",
    pediatri: "Pediatri",
    geriatri: "Geriatri",
  };

  function esc(value) {
    return S ? S.escape(value) : String(value ?? "");
  }

  function pageHTML(q) {
    return `
      <section class="answer-head">
        <h1>Kartu obat</h1>
        <p class="muted">Dosis, kontraindikasi, peringatan, dan interaksi dari label resmi (openFDA/DailyMed) + PubChem/ChEMBL — setiap bagian bertaut sumber.</p>
        <form id="drug-form" class="searchbox">
          <input id="drug-q" type="search" value="${esc(q)}" placeholder="mis. parasetamol, amoksisilin, oralit" />
          <button type="submit">Cari obat</button>
        </form>
      </section>
      <div id="drug-body" role="status" aria-live="polite"><p class="muted">Menyiapkan…</p></div>`;
  }

  function formHandler() {
    const form = document.getElementById("drug-form");
    if (!form) return;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const q = document.getElementById("drug-q").value.trim();
      if (!q) return;
      location.hash = `#/drug?q=${encodeURIComponent(q)}`;
    });
  }

  async function load(q) {
    const body = document.getElementById("drug-body");
    if (!body) return;
    if (!q) {
      body.innerHTML = '<p class="muted">Tulis nama obat generik, lalu tekan "Cari obat".</p>';
      return;
    }
    body.innerHTML = '<p class="muted">Mengambil data label…</p>';
    try {
      const resp = await fetch(`/api/drug?q=${encodeURIComponent(q)}`);
      if (!resp.ok) throw new Error(`gagal memuat obat: ${resp.status}`);
      const data = await resp.json();
      body.innerHTML = data.matched ? render(data) : renderSuggestions(data);
    } catch (error) {
      body.innerHTML = `<p class="muted">${esc(error.message)}</p>`;
    }
  }

  function renderSuggestions(data) {
    const items = data.suggestions || [];
    return `
      <section class="answer-card">
        <h2>Tidak ditemukan: ${esc(data.query)}</h2>
        <p class="muted">Coba salah satu obat dalam katalog Fornas berikut:</p>
        <p>${items.map((s) => `<a class="chip-btn" href="#/drug?q=${encodeURIComponent(s.name)}">${esc(s.name)}</a>`).join(" ")}</p>
      </section>`;
  }

  function render(data) {
    const drug = data.drug || {};
    const fornas = data.fornas || {};
    const chem = data.chemistry;
    const mech = data.mechanism;
    const label = data.label || {};
    const shareText = `${drug.name} (${drug.inn}) — ATC ${drug.atc}\nKartu obat bioXip\n${location.href}`;

    const fields = Object.entries(label.fields || {})
      .map(
        ([key, field]) => `
        <details class="accordion" ${key === "indikasi" || key === "dosis" ? "open" : ""}>
          <summary>${esc(FIELD_LABELS[key] || key)} <span class="chip">EN</span></summary>
          <p>${esc(field.text)}</p>
          <p class="muted">${field.truncated ? "Teks dipotong. " : ""}<a href="${esc(field.source)}" target="_blank" rel="noopener">Sumber label</a></p>
        </details>`
      )
      .join("");

    return `
      <section class="answer-card">
        <h2>${esc(drug.name)} <span class="chip">${esc(drug.atc)}</span></h2>
        <div class="pico">
          <span class="chip">INN: ${esc(drug.inn)}</span>
          <span class="chip">${esc(drug.kelas)}</span>
          <span class="chip">Rute: ${esc(drug.rute)}</span>
          <span class="chip oa">Fornas</span>
        </div>
        <p class="muted">Katalog: ${esc(fornas.edition || "-")} ·
          <a href="${esc(fornas.source_url)}" target="_blank" rel="noopener">e-Fornas Kemenkes</a></p>
        <p class="actions">
          <a class="btn small" target="_blank" rel="noopener"
             href="https://wa.me/?text=${encodeURIComponent(shareText)}">Bagikan ke WhatsApp</a>
          <button class="btn small ghost" data-copy="${esc(shareText)}">Salin ringkasan</button>
        </p>
      </section>

      ${chem ? `<section class="answer-card">
        <h3>Identitas kimia</h3>
        <p class="meta">CID ${esc(chem.cid)} · ${esc(chem.molecular_formula)} · BM ${esc(chem.molecular_weight)}</p>
        ${chem.iupac_name ? `<p class="muted">${esc(chem.iupac_name)}</p>` : ""}
        <p><a href="${esc(chem.source)}" target="_blank" rel="noopener">PubChem</a></p>
      </section>` : ""}

      ${mech ? `<section class="answer-card">
        <h3>Mekanisme (ChEMBL)</h3>
        <p class="meta">${esc(mech.pref_name || "")} · ${esc(mech.molecule_type || "")}</p>
        ${(mech.actions || []).length
          ? `<ul class="answer-list">${mech.actions
              .map((a) => `<li>${esc(a.action || "")} ${esc(a.target || "")}${a.mechanism ? " — " + esc(a.mechanism) : ""}</li>`)
              .join("")}</ul>`
          : '<p class="muted">Data mekanisme tidak tersedia di sumber.</p>'}
        <p><a href="${esc(mech.source)}" target="_blank" rel="noopener">ChEMBL</a></p>
      </section>` : ""}

      <section class="answer-studies">
        <h3>Label resmi (openFDA/DailyMed)</h3>
        ${label.available ? fields : '<p class="muted">Label tidak ditemukan di openFDA untuk obat ini — tidak ada data yang dikarang.</p>'}
        ${label.effective_time ? `<p class="muted">Versi label: ${esc(label.effective_time)}</p>` : ""}
      </section>

      <section class="tldr">
        <p class="muted">${esc(data.disclaimer || "")}</p>
        ${(data.notes || []).map((n) => `<p class="muted">${esc(n)}</p>`).join("")}
      </section>`;
  }

  window.BIOXIP_DRUG = { pageHTML, formHandler, load };
})();
