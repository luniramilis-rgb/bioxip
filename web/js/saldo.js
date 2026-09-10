/* halaman saldo & riwayat + top-up — window.BIOXIP_SALDO */
(() => {
  const S = window.BIOXIP_SEARCH;
  const C = window.BIOXIP_CREDITS;

  let pollTimer = null;

  function esc(value) {
    return S ? S.escape(value) : String(value ?? "");
  }

  function pageHTML() {
    return `
      <section class="answer-head">
        <h1>Saldo &amp; top-up</h1>
        <p class="muted">Saldo dalam Rupiah, tanpa kedaluwarsa. Pencarian &amp; data gratis; AI memakai saldo.</p>
      </section>
      <div id="saldo-body" role="status" aria-live="polite"><p class="muted">Memuat…</p></div>`;
  }

  async function load() {
    const host = document.getElementById("saldo-body");
    if (!host) return;

    if (!C.getToken()) {
      host.innerHTML = `
        <section class="answer-card">
          <h3>Belum masuk</h3>
          <p class="muted">Masuk dengan Google atau tautan email untuk melihat saldo, top-up, dan riwayat pemakaian AI.</p>
          <p class="locked muted">Fitur masuk sedang disiapkan. Sementara itu, pencarian, jawaban PICO, dan kartu obat tetap dapat dipakai gratis.</p>
        </section>`;
      return;
    }

    const [account, history] = await Promise.all([C.me(), C.ledger(25)]);
    if (account.status === 401) {
      host.innerHTML = '<div class="locked"><p>Sesi berakhir. Silakan masuk kembali.</p></div>';
      return;
    }

    const balance = account.body?.balance_idr ?? 0;
    const items = history.body?.items || [];
    const rows = items
      .map((item) => {
        const sign = item.delta_micro_idr > 0 ? "+" : "−";
        const amount = C.formatIdr(Math.abs(item.delta_micro_idr) / 1_000_000);
        const reason = { topup: "Isi saldo", usage: "Pemakaian AI", refund: "Pengembalian", bonus: "Bonus", adjustment: "Penyesuaian" }[item.reason] || item.reason;
        return `<tr><td>${esc(new Date(item.created_at).toLocaleString("id-ID"))}</td><td>${esc(reason)}</td><td class="${item.delta_micro_idr > 0 ? "pos" : "neg"}">${sign}${esc(amount)}</td></tr>`;
      })
      .join("");

    host.innerHTML = `
      <section class="answer-card">
        <h3>Saldo tersedia</h3>
        <p style="font-size:1.6rem;margin:.2rem 0"><strong>${esc(C.formatIdr(balance))}</strong></p>
        <p class="muted">${balance > 0 ? "AI aktif." : "AI terkunci sampai saldo diisi."} ${
          account.body?.plan ? `Paket: ${esc(account.body.plan)}.` : ""
        }</p>
      </section>

      <section class="answer-card">
        <h3>Isi saldo</h3>
        <p class="muted">Pilih paket (saldo masuk 1:1, tanpa kedaluwarsa):</p>
        <p class="actions">
          ${[50_000, 100_000, 150_000, 500_000]
            .map((amount) => `<button class="btn small" data-topup="${amount}">${esc(C.formatIdr(amount))}</button>`)
            .join(" ")}
        </p>
        <p class="actions">
          <label>Kanal
            <select id="topup-channel">
              <option value="QRIS">QRIS</option>
              <option value="VA">Virtual Account</option>
              <option value="EWALLET">E-wallet</option>
            </select>
          </label>
        </p>
        <div id="topup-status"></div>
      </section>

      <section class="answer-studies">
        <h3>Riwayat (25 terakhir)</h3>
        ${
          rows
            ? `<table class="ledger"><thead><tr><th>Waktu</th><th>Jenis</th><th>Jumlah</th></tr></thead><tbody>${rows}</tbody></table>`
            : '<p class="muted">Belum ada transaksi.</p>'
        }
      </section>`;

    bindTopup();
  }

  function bindTopup() {
    document.querySelectorAll("[data-topup]").forEach((button) => {
      button.addEventListener("click", () => createTopup(Number(button.dataset.topup)));
    });
  }

  async function createTopup(amountIdr) {
    const status = document.getElementById("topup-status");
    if (!status) return;
    const channel = document.getElementById("topup-channel")?.value || "QRIS";
    status.innerHTML = '<p class="muted">Membuat tagihan…</p>';

    const resp = await fetch("/api/credits/topup", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${C.getToken()}` },
      body: JSON.stringify({ amount_idr: amountIdr, channel }),
    });
    const body = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      status.innerHTML = `<div class="locked"><p>Gagal membuat tagihan${
        body.error ? ` (${esc(body.error)})` : ""
      }.</p></div>`;
      return;
    }

    status.innerHTML = `
      <div class="topup-box">
        <p><strong>${esc(C.formatIdr(body.amount_idr))}</strong> · ${esc(body.channel)} · status: <strong>${esc(
          body.status
        )}</strong></p>
        ${
          body.payment_url
            ? `<p class="actions"><a class="btn small" target="_blank" rel="noopener" href="${esc(body.payment_url)}">Buka halaman pembayaran</a>
               <button class="btn small ghost" data-copy-link="${esc(body.payment_url)}">Salin tautan</button></p>`
            : '<p class="muted">Instruksi pembayaran belum tersedia — coba buat ulang.</p>'
        }
        <p class="muted">Mode: ${esc(body.mode || "-")}${
          body.mode === "mock" ? " (sandbox — tidak ada uang nyata)" : ""
        } · kedaluwarsa ${body.expires_at ? esc(new Date(body.expires_at).toLocaleString("id-ID")) : "-"}</p>
        <p class="muted" id="topup-wait">${
          body.mode === "mock"
            ? "Mode sandbox: pembayaran tidak diproses otomatis. Saldo bertambah setelah webhook masuk."
            : "Menunggu pembayaran… saldo otomatis bertambah setelah pembayaran berhasil."
        }</p>
      </div>`;

    startPolling(body.topup_id);
  }

  function startPolling(topupId) {
    stopPolling();
    let tries = 0;
    pollTimer = setInterval(async () => {
      tries += 1;
      if (tries > 40) {
        stopPolling();
        return;
      }
      const resp = await fetch(`/api/credits/topup?id=${topupId}`, {
        headers: { Authorization: `Bearer ${C.getToken()}` },
      });
      if (!resp.ok) return;
      const body = await resp.json();
      if (body.status === "paid") {
        stopPolling();
        const wait = document.getElementById("topup-wait");
        if (wait) wait.innerHTML = "<strong>Pembayaran diterima — saldo bertambah.</strong>";
        C.refreshBadge(true);
        setTimeout(load, 600);
      } else if (["expired", "failed"].includes(body.status)) {
        stopPolling();
        const wait = document.getElementById("topup-wait");
        if (wait) wait.textContent = body.status === "expired" ? "Tagihan kedaluwarsa. Silakan buat ulang." : "Pembayaran gagal.";
      }
    }, 3000);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  window.BIOXIP_SALDO = { pageHTML, load };
})();
