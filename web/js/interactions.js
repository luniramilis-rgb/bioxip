/* interaction checker — window.BIOXIP_INTERACTIONS */
(() => {
  const S = window.BIOXIP_SEARCH;

  function esc(value) {
    return S ? S.escape(value) : String(value ?? "");
  }

  function pageHTML(q) {
    return `
      <section class="answer-head">
        <h1>Pemeriksa interaksi obat</h1>
        <p class="muted">Pisahkan obat dengan tanda <strong>+</strong> (2–5 obat). Nama dinormalisasi via RxNorm (NLM); interaksi dari tabel terkurasi bioXip dan kutipan label openFDA/DailyMed.</p>
        <form id="inter-form" class="searchbox">
          <input id="inter-q" type="search" value="${esc(q)}" placeholder="mis. metronidazol + warfarin" />
          <button type="submit">Periksa</button>
        </form>
      </section>
      <div id="inter-body" role="status" aria-live="polite"><p class="muted">Menyiapkan…</p></div>`;
  }

  function formHandler() {
    const form = document.getElementById("inter-form");
    if (!form) return;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const q = document.getElementById("inter-q").value.trim();
      if (!q) return;
      location.hash = `#/interactions?q=${encodeURIComponent(q)}`;
    });
  }

  async function load(q) {
    const body = document.getElementById("inter-body");
    if (!body) return;
    if (!q) {
      body.innerHTML = '<p class="muted">Tulis minimal dua obat, mis. <em>metronidazol + warfarin</em>.</p>';
      return;
    }
    body.innerHTML = '<p class="muted">Memeriksa interaksi…</p>';
    try {
      const resp = await fetch(`/api/interactions?q=${encodeURIComponent(q)}`);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `gagal: ${resp.status}`);
      body.innerHTML = render(data);
    } catch (error) {
      body.innerHTML = `<p class="muted">${esc(error.message)}</p>`;
    }
  }

  function render(data) {
    const drugs = data.drugs || [];
    const pairs = data.pairs || [];
    const mentions = data.mentions || [];
    return `
      <section class="answer-card">
        <h3>Obat diperiksa</h3>
        <ul class="answer-list">
          ${drugs
            .map((item) => {
              const rx = item.rxcui;
              const mech = (item.chembl?.actions || [])
                .map((a) => [a.action, a.mechanism].filter(Boolean).join(": "))
                .join("; ");
              return `<li><strong>${esc(item.display)}</strong>${
                rx ? ` → ${esc(rx.name)} (RxCUI <a href="${esc(rx.source)}" target="_blank" rel="noopener">${esc(rx.rxcui)}</a>)` : ' <span class="muted">tidak terpetakan</span>'
              }${item.catalogue ? ` <span class="chip">Fornas: ${esc(item.catalogue)}</span>` : ""}${mech ? `<br/><span class="muted">ChEMBL: ${esc(mech)}</span>` : ""}</li>`;
            })
            .join("")}
        </ul>
      </section>

      <section class="answer-studies">
        <h3>Interaksi terkurasi: ${pairs.length}</h3>
        ${pairs.length
          ? pairs.map(pairCard).join("")
          : '<p class="muted">Tidak ada pasangan pada tabel terkurasi bioXip untuk kombinasi ini.</p>'}
      </section>

      <section class="answer-studies">
        <h3>Disebutkan di label: ${mentions.length}</h3>
        ${mentions.length
          ? mentions
              .map(
                (m) => `
            <article class="study">
              <p class="meta">Label <strong>${esc(m.label_of)}</strong> menyebut <strong>${esc(m.about)}</strong></p>
              <p>${esc(m.quote)}</p>
              <p class="muted"><a href="${esc(m.source)}" target="_blank" rel="noopener">Sumber label</a>${m.label_term ? ` · nama di label: ${esc(m.label_term)}` : ""}</p>
            </article>`
              )
              .join("")
          : '<p class="muted">Tidak ada kutipan bagian interaksi label yang menyebut obat lain pada kombinasi ini.</p>'}
      </section>

      <section class="tldr">
        <p class="muted">${esc(data.rxnav_note || "")}</p>
        <p class="muted">${esc(data.disclaimer || "")}</p>
        ${(data.notes || []).map((n) => `<p class="muted">${esc(n)}</p>`).join("")}
      </section>`;
  }

  function pairCard(pair) {
    const severity = String(pair.severity || "unknown").toLowerCase();
    const cls = severity.includes("tinggi")
      ? "sev-high"
      : severity.includes("sedang")
        ? "sev-moderate"
        : "sev-low";
    return `
      <article class="study">
        <h3>${esc(pair.a)} + ${esc(pair.b)}
          <span class="chip ${cls}">${esc(pair.severity)}</span>
          <span class="chip ${pair.reviewed ? "reviewed" : "review-pending"}">${pair.reviewed ? "terverifikasi" : "menunggu verifikasi"}</span>
        </h3>
        <p>${esc(pair.mechanism)}</p>
        <p><strong>Anjuran:</strong> ${esc(pair.advice)}</p>
        <p class="muted">Sumber: ${esc(pair.source)}</p>
      </article>`;
  }

  window.BIOXIP_INTERACTIONS = { pageHTML, formHandler, load };
})();
