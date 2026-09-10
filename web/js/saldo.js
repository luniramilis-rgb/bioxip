/* halaman saldo & riwayat — window.BIOXIP_SALDO */
(() => {
  const S = window.BIOXIP_SEARCH;
  const C = window.BIOXIP_CREDITS;

  function esc(value) {
    return S ? S.escape(value) : String(value ?? "");
  }

  function pageHTML() {
    return `
      <section class="answer-head">
        <h1>Saldo & riwayat</h1>
        <p class="muted">Saldo dalam Rupiah, tanpa kedaluwarsa. Pencarian & data gratis; AI memakai saldo.</p>
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
          <p class="muted">Masuk dengan Google atau tautan email untuk melihat saldo & riwayat pemakaian AI.</p>
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
        <p class="actions">
          <a class="btn small" href="#/harga">Lihat paket</a>
          <a class="btn small ghost" href="#/">Mulai mencari</a>
        </p>
      </section>
      <section class="answer-studies">
        <h3>Riwayat (25 terakhir)</h3>
        ${
          rows
            ? `<table class="ledger"><thead><tr><th>Waktu</th><th>Jenis</th><th>Jumlah</th></tr></thead><tbody>${rows}</tbody></table>`
            : '<p class="muted">Belum ada transaksi.</p>'
        }
      </section>`;
  }

  window.BIOXIP_SALDO = { pageHTML, load };
})();
