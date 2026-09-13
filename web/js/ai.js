/* panel AI pada halaman hasil — window.BIOXIP_AI */
(() => {
  const S = window.BIOXIP_SEARCH;
  const C = window.BIOXIP_CREDITS;

  function esc(value) {
    return S ? S.escape(value) : String(value ?? "");
  }

  // Sitasi aktif untuk run terakhir; dipakai delegasi tooltip di tingkat dokumen.
  let activeCites = new Map();
  let tipEl = null;
  let tipHideTimer = null;

  function cancelTipHide() {
    if (tipHideTimer) clearTimeout(tipHideTimer);
    tipHideTimer = null;
  }

  function scheduleTipHide() {
    cancelTipHide();
    tipHideTimer = setTimeout(hideTip, 180);
  }

  function citeMeta(item) {
    if (!item) return "";
    return item.guideline
      ? [item.guideline.label || item.guideline.tier, item.guideline.edisi, item.guideline.locator].filter(Boolean).join(" · ")
      : item.source || "";
  }

  function safeHref(url) {
    const raw = String(url || "").trim();
    if (!raw) return "";
    const base = (typeof window !== "undefined" && window.location?.origin) || "https://localhost";
    try {
      const parsed = new URL(raw, base);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? esc(parsed.href) : "";
    } catch {
      return "";
    }
  }

  // Penanda [n] dibuat sebagai tombol (bukan tautan anchor berbasis hash)
  // agar tidak bentrok dengan router yang akan merender "Halaman tidak ditemukan".
  // Atribut di-namespace (data-ai-*) supaya tidak bertabrakan dengan handler
  // data-cite milik answer.js.
  function citeLink(n, cites) {
    const item = cites ? cites.get(n) : null;
    const aria = item ? `[${n}] ${item.title}${citeMeta(item) ? ` — ${citeMeta(item)}` : ""}` : `[${n}]`;
    return `<button type="button" class="cite-link" data-ai-cite="${n}" aria-label="${esc(aria)}">[${n}]</button>`;
  }

  function linkifyCites(html, cites) {
    if (!cites || !cites.size) return html;
    return html.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (whole, group) => {
      const nums = group.split(",").map((part) => Number(part.trim()));
      if (!nums.every((n) => cites.has(n))) return whole;
      return nums.map((n) => citeLink(n, cites)).join(" ");
    });
  }

  function ensureTip() {
    if (tipEl) return tipEl;
    tipEl = document.createElement("div");
    tipEl.className = "cite-tip";
    tipEl.setAttribute("role", "tooltip");
    tipEl.hidden = true;
    tipEl.addEventListener("mouseover", cancelTipHide);
    tipEl.addEventListener("mouseout", scheduleTipHide);
    document.body.appendChild(tipEl);
    return tipEl;
  }

  function showTip(target) {
    const item = activeCites.get(Number(target.dataset.aiCite));
    if (!item) return;
    cancelTipHide();
    const tip = ensureTip();
    const meta = citeMeta(item);
    const href = safeHref(item.url);
    tip.innerHTML = `<strong>[${esc(target.dataset.aiCite)}] ${esc(item.title)}</strong>${
      meta ? `<span>${esc(meta)}</span>` : ""
    }${href ? `<a href="${href}" target="_blank" rel="noopener">Buka sumber</a>` : ""}`;
    tip.hidden = false;
    const rect = target.getBoundingClientRect();
    const top = window.scrollY + rect.top - tip.offsetHeight - 8;
    tip.style.top = `${Math.max(8, top)}px`;
    tip.style.left = `${Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, window.scrollX + rect.left))}px`;
  }

  function hideTip() {
    if (tipEl) tipEl.hidden = true;
  }

  function flashAndScroll(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("cite-flash");
    setTimeout(() => el.classList.remove("cite-flash"), 1200);
  }

  function targetEl(event) {
    const target = event.target;
    return target && typeof target.closest === "function" ? target : null;
  }

  function boldInline(text) {
    return text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  }

  // Markdown terbatas (heading, list, tabel, bold). Teks sudah di-escape lebih dulu,
  // jadi hanya tag yang kita hasilkan sendiri yang muncul.
  function renderMarkdown(value) {
    const lines = esc(value).split(/\n/);
    const out = [];
    let list = null;
    let table = null;
    const flushList = () => {
      if (list) {
        out.push(`<ul class="answer-list">${list.join("")}</ul>`);
        list = null;
      }
    };
    const flushTable = () => {
      if (table) {
        out.push(`<table class="answer-table">${table.join("")}</table>`);
        table = null;
      }
    };
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        flushList();
        flushTable();
        continue;
      }
      const heading = line.match(/^(#{1,3})\s+(.*)$/);
      if (heading) {
        flushList();
        flushTable();
        const level = Math.min(3, heading[1].length) + 1;
        out.push(`<h${level}>${boldInline(heading[2])}</h${level}>`);
        continue;
      }
      if (line.startsWith("|")) {
        const cells = line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
        if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
        flushList();
        table = table || [];
        const tag = table.length === 0 ? "th" : "td";
        table.push(`<tr>${cells.map((cell) => `<${tag}>${boldInline(cell)}</${tag}>`).join("")}</tr>`);
        continue;
      }
      const bullet = line.match(/^[-*]\s+(.*)$/);
      if (bullet) {
        flushTable();
        list = list || [];
        list.push(`<li>${boldInline(bullet[1])}</li>`);
        continue;
      }
      flushList();
      flushTable();
      out.push(`<p>${boldInline(line)}</p>`);
    }
    flushList();
    flushTable();
    return out.join("");
  }

  document.addEventListener("click", (event) => {
    const el = targetEl(event);
    const cite = el?.closest("[data-ai-cite]");
    if (cite) {
      event.preventDefault();
      flashAndScroll(`cite-${cite.dataset.aiCite}`);
      return;
    }
    const claim = el?.closest("[data-ai-claim]");
    if (claim) {
      event.preventDefault();
      flashAndScroll(`claim-${claim.dataset.aiClaim}`);
    }
  });
  document.addEventListener("mouseover", (event) => {
    const cite = targetEl(event)?.closest("[data-ai-cite]");
    if (cite) showTip(cite);
  });
  document.addEventListener("mouseout", (event) => {
    if (targetEl(event)?.closest("[data-ai-cite]")) scheduleTipHide();
  });
  document.addEventListener("focusin", (event) => {
    const cite = targetEl(event)?.closest("[data-ai-cite]");
    if (cite) showTip(cite);
  });
  document.addEventListener("focusout", (event) => {
    if (targetEl(event)?.closest("[data-ai-cite]")) scheduleTipHide();
  });

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
        <div id="ai-status" class="muted">Menyiapkan jawaban…</div>
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
    const isAdmin = Boolean(account.body?.is_admin);
    if (balance <= 0 && !isAdmin) {
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

    // Info biaya cukup dari sisa saldo (tanpa estimasi di muka); admin tanpa biaya.
    status.innerHTML = isAdmin
      ? '<span class="muted">Mode admin · tanpa biaya.</span>'
      : `<span class="muted">Sisa saldo <strong>${esc(C.formatIdr(balance))}</strong>.</span>`;
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
    answerHost.innerHTML = '<p class="muted" id="ai-stream">Menyusun jawaban…</p><div id="ai-overview"></div><div id="ai-text"></div><div id="ai-cites"></div><div id="ai-foot"></div>';

    let text = "";
    let hasOverview = false;
    let overviewConfidence = null;
    let overviewFlagged = false;
    let answerMode = "extractive";
    let unknownCites = 0;
    let unsupported = [];
    let keyClaims = [];
    let markedClaims = new Set();
    const citations = new Map();
    activeCites = citations;

    // Render jawaban: sintesis bersitasi memakai markdown terbatas; lapisan umum
    // (hybrid) tetap menandai klaim tanpa sitasi.
    function renderAnswer(host, value, writing) {
      if (!host) return;
      const caret = writing ? '<span class="caret" aria-hidden="true"></span>' : "";
      markedClaims = new Set();
      const raw = String(value || "");
      if (!raw.trim()) {
        host.innerHTML = writing ? `<p>${caret}</p>` : "";
        return;
      }
      if (!hasOverview) {
        host.innerHTML = `${linkifyCites(renderMarkdown(raw), citations)}${caret}`;
        return;
      }
      const paragraphs = raw
        .split(/\n{2,}/)
        .map((part) => part.trim())
        .filter(Boolean);
      host.innerHTML = paragraphs
        .map((part, index) => {
          const { html, matched } = markUnsupported(part, unsupported);
          for (const claim of matched) markedClaims.add(claim);
          return `<p>${linkifyCites(html, citations)}${index === paragraphs.length - 1 ? caret : ""}</p>`;
        })
        .join("");
    }

    let renderScheduled = false;
    // Koalesensi delta → render sekali per frame (hindari re-parse seluruh jawaban tiap chunk).
    function scheduleAnswerRender() {
      if (typeof requestAnimationFrame !== "function") {
        renderAnswer(document.getElementById("ai-text"), text, true);
        return;
      }
      if (renderScheduled) return;
      renderScheduled = true;
      requestAnimationFrame(() => {
        renderScheduled = false;
        renderAnswer(document.getElementById("ai-text"), text, true);
      });
    }

    C.streamChat(
      { question, feature: "chat", max_tokens: 2048, grounding: { search: true, drug: true } },
      {
        onMeta(data) {
          if (status) {
            status.innerHTML = `<span class="muted">${data.evidence_count} sumber bukti${data.cached ? " · dari cache" : ""}</span>`;
          }
        },
        onDelta(data) {
          text += data.text || "";
          scheduleAnswerRender();
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
          hasOverview = Boolean(data.overview);
          answerMode = data.answer_mode || (hasOverview ? "overview" : "extractive");
          unknownCites = Number(data.unknown_cites || 0);
          overviewConfidence = data.overview_confidence || null;
          overviewFlagged = Boolean(data.overview_flagged);
          const abstainReason = data.abstain_reason || null;
          const overviewHost = document.getElementById("ai-overview");
          if (overviewHost) {
            const confidence = overviewConfidence
              ? ` <span class="overview-badge">${esc(overviewConfidence)}</span>`
              : "";
            if (answerMode === "cited") {
              overviewHost.innerHTML = `<h3 class="overview-label">Sintesis bersitasi <span class="muted">· klaim mengikuti sumber</span>${confidence}</h3>${
                unknownCites > 0
                  ? `<p class="muted">${unknownCites} penanda sitasi tidak dikenali dan dihapus.</p>`
                  : ""
              }`;
            } else if (hasOverview) {
              overviewHost.innerHTML = `<h3 class="overview-label">Penjelasan umum <span class="muted">· tanpa sitasi</span>${confidence}</h3>${
                overviewFlagged
                  ? '<p class="muted">Sebagian kalimat dosis/angka dihapus; untuk dosis rujuk label resmi/Fornas.</p>'
                  : ""
              }`;
            } else {
              overviewHost.innerHTML = "";
            }
          }
          // Teks sudah lengkap di titik ini → render ulang agar klaim tanpa sitasi
          // benar-benar ditandai di dalam jawaban, bukan hanya dilaporkan persen.
          renderAnswer(document.getElementById("ai-text"), text, false);
          const host = document.getElementById("ai-cites");
          if (!host) return;
          // Peta dua arah: sumber → nomor klaim yang merujuknya.
          const claimRefs = new Map();
          keyClaims.forEach((claim, index) => {
            for (const n of claim.citations || []) {
              if (!claimRefs.has(n)) claimRefs.set(n, []);
              claimRefs.get(n).push(index + 1);
            }
          });
          const list = [...citations.values()]
            .map((item) => {
              const meta = citeMeta(item);
              const refs = claimRefs.get(item.n) || [];
              const refHtml = refs.length
                ? ` <span class="cite-refs">· dirujuk klaim ${refs
                    .map((i) => `<button type="button" class="claim-ref" data-ai-claim="${i}" aria-label="Ke klaim ${i}">${i}</button>`)
                    .join(", ")}</span>`
                : "";
              return `<li id="cite-${item.n}" value="${item.n}"><a href="${safeHref(item.url) || "#"}" target="_blank" rel="noopener">${esc(item.title)}</a> <span class="muted">(${esc(meta)})</span>${refHtml}</li>`;
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
            ? `<h3>Didukung sumber</h3><ol class="answer-list ai-claims">${keyClaims
                .map((claim, index) => {
                  const cites = (claim.citations || []).map((n) => citeLink(n, citations)).join(" ");
                  return `<li id="claim-${index + 1}" class="${claim.supported ? "" : "unsupported-item"}">${esc(claim.text)} ${cites}</li>`;
                })
                .join("")}</ol>`
            : "";
          const exportText = [...citations.values()]
            .map((item) => `[${item.n}] ${item.title} (${citeMeta(item) || item.source || ""}) ${item.url || ""}`.trim())
            .join("\n");
          const exportBtn = exportText
            ? `<p class="actions"><button class="btn small ghost" data-copy="${esc(exportText)}">Salin daftar sumber</button></p>`
            : "";
          // Indikator kekuatan bukti (bukan "dukungan sitasi" mentah): jawaban tanpa
          // klaim tidak boleh tampil 100%.
          const sourceCount = citations.size;
          const noEvidence =
            abstainReason === "retrieval_empty"
              ? "Tidak ada bukti lokal yang ditemukan untuk pertanyaan ini."
              : abstainReason === "evidence_unsupported"
                ? "Bukti lokal ditemukan, tetapi tidak ada yang mendukung klaim spesifik ini."
                : "Bukti belum cukup untuk diringkas";
          const strength =
            keyClaims.length === 0
              ? noEvidence
              : `Kekuatan bukti: ${sourceCount} sumber · ${Math.round((data.support_rate || 0) * 100)}% klaim bersitasi`;
          const layerNote = hasOverview
            ? `<p class="muted">${esc(
                (window.BIOXIP && window.BIOXIP.overviewNote) ||
                  "Penjelasan umum tidak bersitasi; klaim spesifik mengikuti sumber terverifikasi di bawah."
              )}${hasOverview && sourceCount === 0 ? " Tidak ada sumber lokal yang dirujuk untuk bagian ini." : ""}</p>`
            : "";
          host.innerHTML = `
            ${layerNote}
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

  window.BIOXIP_AI = { panelHTML, prepare, markUnsupported, renderMarkdown };
})();
