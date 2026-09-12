/* panel AI pada halaman hasil — window.BIOXIP_AI */
(() => {
  const S = window.BIOXIP_SEARCH;
  const C = window.BIOXIP_CREDITS;

  function esc(value) {
    return S ? S.escape(value) : String(value ?? "");
  }

  // Normalisasi spasi + huruf kecil, sekaligus memetakan tiap karakter hasil
  // normalisasi ke indeks aslinya agar klaim bisa dicari tanpa merusak escaping.
  function indexedNormalize(value) {
    const map = [];
    let out = "";
    let pendingSpace = false;
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      if (/\s/.test(char)) {
        if (out.length) pendingSpace = true;
        continue;
      }
      if (pendingSpace) {
        out += " ";
        map.push(index);
        pendingSpace = false;
      }
      // toLowerCase() bisa menghasilkan >1 unit UTF-16 (mis. "İ" → "i̇").
      // Petakan setiap unit hasil agar `map` selalu sejajar dengan `out`.
      const lowered = char.toLowerCase();
      if (!lowered) continue;
      out += lowered;
      for (let unit = 0; unit < lowered.length; unit += 1) map.push(index);
    }
    return { norm: out, map };
  }

  // Cari rentang klaim di dalam teks (abaikan perbedaan spasi & penanda sitasi).
  function claimRange(text, claim) {
    const clean = String(claim || "")
      .replace(/\[\d+(?:\s*,\s*\d+)*\]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (clean.length < 12) return null;
    const hay = indexedNormalize(text);
    // Sabuk pengaman: bila pemetaan tidak sejajar, jangan menandai (fallback ke daftar).
    if (hay.norm.length !== hay.map.length) return null;
    const needle = indexedNormalize(clean).norm;
    if (!needle) return null;
    const index = hay.norm.indexOf(needle);
    if (index < 0) return null;
    const start = hay.map[index];
    const end = hay.map[index + needle.length - 1] + 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return null;
    return { start, end };
  }

  // Bungkus klaim tanpa sitasi di dalam teks agar pembaca melihat bagian mana
  // yang tidak didukung sumber (bukan hanya persentase di footer).
  function markUnsupported(text, unsupported) {
    const candidates = [];
    for (const claim of unsupported || []) {
      const range = claimRange(text, claim);
      if (range) candidates.push({ range, claim });
    }
    candidates.sort((a, b) => a.range.start - b.range.start);
    let html = "";
    let cursor = 0;
    let marked = 0;
    const matched = [];
    for (const { range, claim } of candidates) {
      if (range.start < cursor) continue;
      html += esc(text.slice(cursor, range.start));
      html += `<mark class="unsupported" title="Klaim tanpa sitasi">${esc(text.slice(range.start, range.end))}</mark>`;
      cursor = range.end;
      marked += 1;
      matched.push(claim);
    }
    html += esc(text.slice(cursor));
    return { html, marked, matched };
  }

  function uncitedList(unsupported) {
    const items = (unsupported || []).map((claim) => `<li>${esc(claim)}</li>`).join("");
    return items ? `<ul class="unsupported-list" aria-label="Klaim tanpa sitasi"><li><strong>Klaim tanpa sitasi:</strong></li>${items}</ul>` : "";
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
          <p class="muted">Pencarian, pedoman lokal, dan kartu obat tetap gratis tanpa akun.</p>
        </div>`;
      return;
    }

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
    if (balance <= 0) {
      status.innerHTML = `<span class="muted">Sisa saldo <strong>${esc(C.formatIdr(balance))}</strong>.</span>`;
      ask.innerHTML = `
        <div class="locked">
          <p><strong>Tanya AI terkunci.</strong> Isi saldo untuk memakai jawaban AI bersitasi.</p>
          <p class="actions">
            <a class="btn small" href="#/saldo">Isi saldo</a>
            <a class="btn small ghost" href="#/saldo">Lihat paket &amp; riwayat</a>
          </p>
          <p class="muted">Pencarian, pedoman lokal, dan kartu obat tetap gratis.</p>
        </div>`;
      return;
    }

    // Info biaya cukup dari sisa saldo (tanpa estimasi di muka).
    status.innerHTML = `<span class="muted">Sisa saldo <strong>${esc(C.formatIdr(balance))}</strong>.</span>`;
    ask.innerHTML = `
      <p class="actions">
        <button class="btn" id="ai-run" type="button">Tanya AI</button>
        <span class="muted">Jawaban bersitasi dari bukti &amp; pedoman lokal.</span>
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
    let unsupported = [];
    let keyClaims = [];
    let markedClaims = new Set();
    const citations = new Map();

    // Render jawaban sebagai paragraf (LLM memakai \n\n) + kursor saat menulis.
    function renderAnswer(host, value, writing) {
      if (!host) return;
      const paragraphs = String(value || "")
        .split(/\n{2,}/)
        .map((part) => part.trim())
        .filter(Boolean);
      const caret = writing ? '<span class="caret" aria-hidden="true"></span>' : "";
      markedClaims = new Set();
      if (!paragraphs.length) {
        host.innerHTML = writing ? `<p>${caret}</p>` : "";
        return;
      }
      host.innerHTML = paragraphs
        .map((part, index) => {
          const { html, matched } = markUnsupported(part, unsupported);
          for (const claim of matched) markedClaims.add(claim);
          return `<p>${html}${index === paragraphs.length - 1 ? caret : ""}</p>`;
        })
        .join("");
    }

    C.streamChat(
      { question, feature: "chat", max_tokens: 1024, grounding: { search: true, drug: true } },
      {
        onMeta(data) {
          if (status) {
            status.innerHTML = `<span class="muted">Estimasi ${esc(C.formatIdr(data.estimate_idr))} · ${data.evidence_count} sumber bukti${
              data.cached ? " · dari cache" : ""
            }</span>`;
          }
        },
        onDelta(data) {
          text += data.text || "";
          renderAnswer(document.getElementById("ai-text"), text, true);
          const stream = document.getElementById("ai-stream");
          if (stream) stream.textContent = "Menulis jawaban…";
        },
        onReplace(data) {
          // Provider gagal memenuhi struktur klaim → teks yang tampil diganti jawaban ekstraktif.
          text = data.text || "";
          renderAnswer(document.getElementById("ai-text"), text, false);
        },
        onCitation(data) {
          citations.set(data.n, data);
        },
        onCitations(data) {
          // Hilangkan klaim duplikat agar hitungan "ditandai" konsisten.
          unsupported = [...new Set(data.unsupported || [])];
          keyClaims = Array.isArray(data.claims) ? data.claims : [];
          // Teks sudah lengkap di titik ini → render ulang agar klaim tanpa sitasi
          // benar-benar ditandai di dalam jawaban, bukan hanya dilaporkan persen.
          renderAnswer(document.getElementById("ai-text"), text, false);
          const host = document.getElementById("ai-cites");
          if (!host) return;
          const list = [...citations.values()]
            .map((item) => {
              const meta = item.guideline
                ? [item.guideline.label || item.guideline.tier, item.guideline.edisi, item.guideline.locator].filter(Boolean).join(" · ")
                : item.source;
              return `<li id="cite-${item.n}" value="${item.n}"><a href="${esc(item.url || "#")}" target="_blank" rel="noopener">${esc(item.title)}</a> <span class="muted">(${esc(meta)})</span></li>`;
            })
            .join("");
          // Klaim yang tidak berhasil dipetakan ke teks (mis. terlalu pendek atau
          // terpotong antar-paragraf) tetap didaftarkan agar tidak ada yang hilang.
          const unmarked = unsupported.filter((claim) => !markedClaims.has(claim));
          const distinctMarked = markedClaims.size;
          let uncited = "";
          if (unsupported.length) {
            uncited =
              distinctMarked > 0
                ? ` · ${distinctMarked} dari ${unsupported.length} klaim tanpa sitasi ditandai`
                : ` · ${unsupported.length} klaim tanpa sitasi`;
          }
          const fallback = unmarked.length ? uncitedList(unmarked) : "";
          const bullets = keyClaims.length
            ? `<h3>Klaim kunci</h3><ul class="answer-list ai-claims">${keyClaims
                .map((claim) => {
                  const cites = (claim.citations || []).map((n) => `<a class="cite-link" href="#cite-${n}">[${n}]</a>`).join(" ");
                  return `<li class="${claim.supported ? "" : "unsupported-item"}">${esc(claim.text)} ${cites}</li>`;
                })
                .join("")}</ul>`
            : "";
          const exportText = [...citations.values()]
            .map((item) => `[${item.n}] ${item.title} (${item.source}) ${item.url || ""}`.trim())
            .join("\n");
          const exportBtn = exportText
            ? `<p class="actions"><button class="btn small ghost" data-copy="${esc(exportText)}">Salin daftar sumber</button></p>`
            : "";
          // Indikator kekuatan bukti (bukan "dukungan sitasi" mentah): jawaban tanpa
          // klaim tidak boleh tampil 100%.
          const sourceCount = citations.size;
          const strength =
            keyClaims.length === 0
              ? "Bukti belum cukup untuk diringkas"
              : `Kekuatan bukti: ${sourceCount} sumber · ${Math.round((data.support_rate || 0) * 100)}% klaim bersitasi`;
          host.innerHTML = `
            ${bullets}
            ${list ? `<h3>Sumber</h3><ol class="answer-list ai-cites">${list}</ol>${exportBtn}` : ""}
            <p class="muted">${esc(strength)}${uncited}</p>
            ${fallback}`;
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
          // Hentikan kursor berkedip: render ulang tanpa caret.
          renderAnswer(document.getElementById("ai-text"), text, false);
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

  window.BIOXIP_AI = { panelHTML, prepare, markUnsupported };
})();
