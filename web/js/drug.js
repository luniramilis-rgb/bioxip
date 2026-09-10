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
        <p class="muted">Dosis, kontraindikasi, peringatan, dan interaksi dari label resmi (openFDA/DailyMed) + PubChem/ChEMBL/RxNorm — setiap bagian bertaut sumber.</p>
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
    const fornas = data.fornas;
    const chemistry = data.chemistry;
    const mechanism = data.mechanism;
    const label = data.label || {};
    const safety = data.safety || {};
    const shareText = `${drug.name}${drug.inn ? ` (${drug.inn})` : ""}${drug.atc ? ` — ATC ${drug.atc}` : ""}\nKartu obat bioXip\n${location.href}`;

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

    const missing = (safety.missing_fields || []).map((key) => FIELD_LABELS[key] || key);
    const missingLine = missing.length
      ? `<p class="muted">Tidak ditemukan di sumber: ${esc(missing.join(", "))}.</p>`
      : "";

    return `
      ${renderSafety(safety)}

      <section class="answer-card">
        <h2>${esc(drug.name)} ${drug.atc ? `<span class="chip">${esc(drug.atc)}</span>` : ""}</h2>
        <div class="pico">
          ${drug.inn ? `<span class="chip">INN: ${esc(drug.inn)}</span>` : ""}
          ${drug.kelas ? `<span class="chip">${esc(drug.kelas)}</span>` : ""}
          ${drug.rute ? `<span class="chip">Rute: ${esc(drug.rute)}</span>` : ""}
          ${data.outside_catalogue ? '<span class="chip">di luar Fornas</span>' : '<span class="chip oa">Fornas</span>'}
        </div>
        ${fornas ? `<p class="muted">Katalog: ${esc(fornas.edition)} ·
          <a href="${esc(fornas.source_url)}" target="_blank" rel="noopener">e-Fornas Kemenkes</a></p>` : ""}
        ${data.rxnorm ? `<p class="muted">RxNorm (NLM): <a href="${esc(data.rxnorm.source)}" target="_blank" rel="noopener">${esc(data.rxnorm.name)} (RxCUI ${esc(data.rxnorm.rxcui)})</a></p>` : ""}
        ${data.outside_catalogue ? '<p class="muted">Obat ini belum masuk katalog Fornas bioXip; identitas dinormalisasi lewat RxNorm.</p>' : ""}
        <p class="actions">
          <a class="btn small" target="_blank" rel="noopener"
             href="https://wa.me/?text=${encodeURIComponent(shareText)}">Bagikan ke WhatsApp</a>
          <a class="btn small ghost" href="#/interactions?q=${encodeURIComponent(drug.name)}">Cek interaksi</a>
          <button class="btn small ghost" data-copy="${esc(shareText)}">Salin ringkasan</button>
          ${label.source ? `<button class="btn small ghost" data-copy-link="${esc(label.source)}">Salin tautan label</button>` : ""}
        </p>
      </section>

      ${chemistry ? `<section class="answer-card">
        <h3>Identitas kimia</h3>
        <p class="meta">CID ${esc(chemistry.cid)} · ${esc(chemistry.molecular_formula)} · BM ${esc(chemistry.molecular_weight)}</p>
        ${chemistry.iupac_name ? `<p class="muted">${esc(chemistry.iupac_name)}</p>` : ""}
        <p><a href="${esc(chemistry.source)}" target="_blank" rel="noopener">PubChem</a></p>
      </section>` : ""}

      ${mechanism ? `<section class="answer-card">
        <h3>Mekanisme (ChEMBL)</h3>
        <p class="meta">${esc(mechanism.pref_name || "")} · ${esc(mechanism.molecule_type || "")}</p>
        ${(mechanism.actions || []).length
          ? `<ul class="answer-list">${mechanism.actions
              .map((a) => `<li>${esc(a.action || "")} ${esc(a.target || "")}${a.mechanism ? " — " + esc(a.mechanism) : ""}</li>`)
              .join("")}</ul>`
          : '<p class="muted">Data mekanisme tidak tersedia di sumber.</p>'}
        <p><a href="${esc(mechanism.source)}" target="_blank" rel="noopener">ChEMBL</a></p>
      </section>` : ""}

      <section class="answer-studies">
        <h3>Label resmi (openFDA/DailyMed)</h3>
        ${label.available ? fields : '<p class="muted">Label tidak ditemukan di openFDA untuk obat ini — tidak ada data yang dikarang.</p>'}
        ${missingLine}
        ${label.effective_time ? `<p class="muted">Versi label: ${esc(label.effective_time)}</p>` : ""}
        ${label.label_count ? `<p class="muted">Digabung dari ${esc(label.label_count)} label.</p>` : ""}
        ${label.matched_term ? `<p class="muted">Nama di label: ${esc(label.matched_term)}</p>` : ""}
      </section>

      ${renderMonitoring(data.monitoring, data.monitoring_reviewed)}

      <section class="tldr">
        <p class="muted">${esc(data.disclaimer || "")}</p>
        ${(data.notes || []).map((n) => `<p class="muted">${esc(n)}</p>`).join("")}
      </section>`;
  }

  function renderMonitoring(monitoring, reviewed) {
    if (!monitoring) return "";
    const rows = [
      ["Ginjal", monitoring.renal],
      ["Hati", monitoring.hepatic],
      ["Lansia", monitoring.geriatric],
    ].filter(([, value]) => value);
    return `
      <section class="answer-studies">
        <h3>Monitoring &amp; penyesuaian (kurasi)
          <span class="chip ${reviewed ? "reviewed" : "review-pending"}">${reviewed ? "terverifikasi" : "menunggu verifikasi apoteker"}</span>
        </h3>
        ${(monitoring.monitoring || []).length
          ? `<ul class="answer-list">${monitoring.monitoring.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>`
          : ""}
        ${rows.length ? `<p class="meta">${rows.map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(" · ")}</p>` : ""}
        ${(monitoring.deprescribing || []).length
          ? `<p><strong>Deprescribing:</strong></p><ul class="answer-list">${monitoring.deprescribing
              .map((d) => `<li>${esc(d)}</li>`)
              .join("")}</ul>`
          : ""}
      </section>`;
  }

  function renderSafety(safety) {
    const watchouts = safety.watchouts || [];
    const lasa = safety.lasa_notes || [];
    if (!safety.blackbox && !watchouts.length && !lasa.length) return "";
    return `
      <section class="safety">
        ${safety.blackbox
          ? `<p><strong>Peringatan kotak hitam (black box):</strong> ${esc(safety.blackbox_excerpt || "")}</p>`
          : ""}
        ${watchouts.length ? `<p><strong>Perlu diperhatikan:</strong></p><ul class="answer-list">${watchouts.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
        ${lasa.length ? `<p class="muted">Risiko salah baca (LASA): ${esc(lasa.join(" "))}</p>` : ""}
        <p class="muted">Flag keselamatan ini alat bantu; keputusan tetap pada penilaian profesi dan sumber resmi terbaru.</p>
      </section>`;
  }

  window.BIOXIP_DRUG = { pageHTML, formHandler, load };
})();
