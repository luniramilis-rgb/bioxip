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
        <p class="muted">Pisahkan obat dengan tanda <strong>+</strong> (2–5 obat). Nama dinormalisasi via RxNorm (NLM), interaksi dari RxNav, mekanisme dari ChEMBL.</p>
        <form id="inter-form" class="searchbox">
          <input id="inter-q" type="search" value="${esc(q)}" placeholder="mis. metformin + warfarin" />
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
      body.innerHTML = '<p class="muted">Tulis minimal dua obat, mis. <em>metformin + warfarin</em>.</p>';
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
              return `<li><strong>${esc(item.input)}</strong>${
                rx ? ` → ${esc(rx.name)} (RxCUI <a href="${esc(rx.source)}" target="_blank" rel="noopener">${esc(rx.rxcui)}</a>)` : " <span class='muted'>tidak terpetakan</span>"
              }${mech ? `<br/><span class="muted">ChEMBL: ${esc(mech)}</span>` : ""}</li>`;
            })
            .join("")}
        </ul>
      </section>

      <section class="answer-studies">
        <h3>Interaksi ditemukan: ${pairs.length}</h3>
        ${pairs.length
          ? pairs.map(pairCard).join("")
          : '<p class="muted">Tidak ada interaksi yang dilaporkan RxNav untuk kombinasi ini. Tetap verifikasi pada sumber/label resmi.</p>'}
      </section>

      ${(data.notes || []).length ? `<p class="muted">${esc(data.notes.join("; "))}</p>` : ""}
      <section class="tldr"><p class="muted">${esc(data.disclaimer || "")}</p></section>`;
  }

  function pairCard(pair) {
    const severity = String(pair.severity || "unknown").toLowerCase();
    const cls = severity.includes("high") ? "sev-high" : severity.includes("moderate") ? "sev-moderate" : "sev-low";
    return `
      <article class="study">
        <h3>${esc(pair.a)} + ${esc(pair.b)} <span class="chip ${cls}">${esc(pair.severity)}</span></h3>
        <p>${esc(pair.description)}</p>
        <p class="muted">Sumber: ${esc(pair.source)}</p>
      </article>`;
  }

  window.BIOXIP_INTERACTIONS = { pageHTML, formHandler, load };
})();
