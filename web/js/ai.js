/* panel AI pada halaman hasil — window.BIOXIP_AI */
(() => {
  const S = window.BIOXIP_SEARCH;
  const C = window.BIOXIP_CREDITS;

  function esc(value) {
    return S ? S.escape(value) : String(value ?? "");
  }

  function panelHTML() {
    return `
      <section id="ai-panel" class="ai-panel">
        <div id="ai-status" class="muted">Menyiapkan estimasi…</div>
        <div id="ai-ask"></div>
        <div id="ai-answer" hidden></div>
      </section>`;
  }

  async function prepare(question, container) {
    const status = document.getElementById("ai-status");
    const ask = document.getElementById("ai-ask");
    if (!status || !ask) return;

    if (!C.getToken()) {
      status.innerHTML = "";
      ask.innerHTML = `
        <div class="locked">
          <p><strong>Tanya AI memerlukan akun.</strong> Masuk dulu untuk memakai jawaban AI bersitasi.</p>
          <p class="actions">
            <a class="btn small" href="#/masuk">Masuk</a>
            <a class="btn small ghost" href="#/saldo">Lihat paket saldo</a>
          </p>
          <p class="muted">Pencarian, jawaban PICO, dan kartu obat tetap gratis tanpa akun.</p>
        </div>`;
      return;
    }

    const result = await C.estimate(question, 1024);
    if (result.status === 401) {
      status.innerHTML = "";
      ask.innerHTML = `<div class="locked"><p>Sesi berakhir. Silakan masuk kembali untuk memakai Tanya AI.</p></div>`;
      return;
    }
    if (!result.ok) {
      status.textContent = "Estimasi tidak tersedia saat ini.";
      return;
    }

    const estimateIdr = result.body?.estimate_idr || 0;
    const account = await C.me();
    if (account.status === 401) {
      status.innerHTML = "";
      ask.innerHTML = `<div class="locked"><p>Sesi berakhir. Silakan masuk kembali untuk memakai Tanya AI.</p></div>`;
      return;
    }
    if (!account.ok) {
      status.innerHTML = "";
      ask.innerHTML = `<div class="locked"><p>Tidak dapat memuat saldo saat ini. Coba lagi sebentar.</p></div>`;
      return;
    }
    const balance = account.body?.balance_idr ?? 0;

    if (balance < estimateIdr) {
      status.innerHTML = `<span class="muted">Saldo Anda <strong>${esc(C.formatIdr(balance))}</strong> — kurang dari estimasi.</span>`;
      ask.innerHTML = `
        <div class="locked">
          <p><strong>Tanya AI terkunci.</strong> Butuh sekitar ${esc(C.formatIdr(estimateIdr))} untuk pertanyaan ini,
             sedangkan saldo Anda ${esc(C.formatIdr(balance))}.</p>
          <p class="actions">
            <a class="btn small" href="#/saldo">Isi saldo</a>
            <a class="btn small ghost" href="#/saldo">Lihat paket &amp; riwayat</a>
          </p>
          <p class="muted">Pencarian gratis tetap tersedia — cukup ganti ke mode "Cari bukti".</p>
        </div>`;
      return;
    }

    status.innerHTML = `<span class="muted">Perkiraan biaya: <strong>${esc(C.formatIdr(estimateIdr))}</strong> · saldo ${esc(C.formatIdr(balance))}</span>`;
    ask.innerHTML = `
      <p class="actions">
        <button class="btn" id="ai-run" type="button">Tanya AI ≈ ${esc(C.formatIdr(estimateIdr))}</button>
        <span class="muted">Jawaban bersitasi dari bukti yang ditemukan.</span>
      </p>`;
    document.getElementById("ai-run")?.addEventListener("click", () => run(question));
  }

  function run(question) {
    const answerHost = document.getElementById("ai-answer");
    const ask = document.getElementById("ai-ask");
    const status = document.getElementById("ai-status");
    if (!answerHost) return;
    if (ask) ask.innerHTML = "";
    answerHost.hidden = false;
    answerHost.innerHTML = '<p class="muted" id="ai-stream">Menyusun jawaban…</p><div id="ai-text"></div><div id="ai-cites"></div><div id="ai-foot"></div>';

    let text = "";
    const citations = new Map();

    C.streamChat(
      { question, feature: "chat", max_tokens: 1024, grounding: { search: true, drug: true } },
      {
        onMeta(data) {
          if (status) {
            status.innerHTML = `<span class="muted">Estimasi ${esc(C.formatIdr(data.estimate_idr))} · ${data.evidence_count} sumber bukti</span>`;
          }
        },
        onDelta(data) {
          text += data.text || "";
          const host = document.getElementById("ai-text");
          if (host) host.innerHTML = `<p>${esc(text)}</p>`;
        },
        onCitation(data) {
          citations.set(data.n, data);
        },
        onCitations(data) {
          const host = document.getElementById("ai-cites");
          if (!host) return;
          const list = [...citations.values()]
            .map(
              (item) =>
                `<li value="${item.n}"><a href="${esc(item.url || "#")}" target="_blank" rel="noopener">${esc(item.title)}</a> <span class="muted">(${esc(item.source)})</span></li>`
            )
            .join("");
          host.innerHTML = `
            ${list ? `<h3>Sumber</h3><ol class="answer-list ai-cites">${list}</ol>` : ""}
            <p class="muted">Dukungan sitasi: ${Math.round((data.support_rate || 0) * 100)}%${
              (data.unsupported || []).length ? " · ada klaim tanpa sumber yang ditandai" : ""
            }</p>`;
        },
        onRedFlag(data) {
          const host = document.getElementById("ai-foot");
          if (host) {
            host.insertAdjacentHTML(
              "beforeend",
              `<div class="safety"><p><strong>Perhatian:</strong> ${esc(data.notice)}</p></div>`
            );
          }
        },
        onDone(data) {
          const stream = document.getElementById("ai-stream");
          if (stream) stream.remove();
          const host = document.getElementById("ai-foot");
          if (host) {
            host.insertAdjacentHTML(
              "afterbegin",
              `<p class="muted">Terpakai <strong>${esc(C.formatIdr(data.charged_idr))}</strong> · sisa ${esc(
                C.formatIdr(data.balance_idr)
              )}${data.mode === "mock" ? " · mode demo (tanpa LLM)" : ""}${
                data.abstain ? " · jawaban menyatakan bukti belum cukup" : ""
              }</p>`
            );
          }
          C.refreshBadge();
        },
        onStreamError(data) {
          const host = document.getElementById("ai-foot");
          if (host) host.innerHTML = `<div class="safety"><p>${esc(data.message || "Terjadi kesalahan.")}</p></div>`;
          C.refreshBadge();
        },
        onError(error) {
          const host = document.getElementById("ai-answer");
          const messages = {
            401: "Sesi berakhir — silakan masuk kembali.",
            402: "Saldo tidak cukup untuk pertanyaan ini.",
            422: "Pertanyaan ini tidak dapat diproses (memuat data pasien/diagnosis/peresepan).",
            429: "Terlalu banyak permintaan. Coba lagi sebentar.",
          };
          if (host) {
            host.innerHTML = `<div class="locked"><p>${
              messages[error.status] || "Gagal memproses permintaan AI."
            }</p>${error.body?.reason ? `<p class="muted">${esc(error.body.reason)}</p>` : ""}</div>`;
          }
        },
      }
    );
  }

  window.BIOXIP_AI = { panelHTML, prepare };
})();
