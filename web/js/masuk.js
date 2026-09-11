(() => {
  const S = window.BIOXIP_SEARCH;
  const A = window.BIOXIP_AUTH;

  function esc(value) {
    return S ? S.escape(value) : String(value ?? "");
  }

  function pageHTML(message) {
    const user = A.getUser();
    if (user) return accountHTML(user, message);
    return signInHTML(message);
  }

  function signInHTML(message) {
    return `
      <section class="answer-head">
        <h1>Masuk ke bioXip</h1>
        <p class="muted">Pencarian gratis untuk semua pengguna terdaftar. Saldo hanya dipakai untuk Tanya AI.</p>
      </section>
      <section class="answer-card">
        <p class="actions">
          <button class="btn" id="auth-google" type="button">Lanjutkan dengan Google</button>
        </p>
        <p class="muted" id="auth-note">
          ${A.configReady ? "Atau masuk dengan kode email di bawah." : "Konfigurasi auth belum tersedia."}
        </p>
        <hr class="rule" />
        <form id="auth-email-form" class="searchbox compact">
          <input id="auth-email" type="email" autocomplete="email" placeholder="nama@email.com" aria-label="Email" />
          <button type="submit">Kirim kode</button>
        </form>
        <form id="auth-otp-form" class="searchbox compact" hidden>
          <input id="auth-otp" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6"
                 placeholder="6 digit kode" aria-label="Kode OTP" />
          <button type="submit">Verifikasi</button>
        </form>
        <p id="auth-status" class="muted" role="status" aria-live="polite">${esc(message || "")}</p>
        <p class="muted" style="font-size:.85rem">
          Kami mengirim kode 6 digit ke email Anda. Tautan magic link juga tersedia di email yang sama.
          Jangan masukkan data pasien ke dalam aplikasi ini.
        </p>
      </section>`;
  }

  function accountHTML(user, message) {
    return `
      <section class="answer-head">
        <h1>Akun</h1>
        <p class="muted">Anda masuk sebagai pengguna bioXip.</p>
      </section>
      <section class="answer-card">
        <p class="actions">
          ${
            user.avatar
              ? `<img class="avatar" src="${esc(user.avatar)}" alt="" width="48" height="48" referrerpolicy="no-referrer" />`
              : ""
          }
          <span><strong>${esc(user.name)}</strong><br /><span class="muted">${esc(user.email || "-")}</span></span>
        </p>
        <p class="meta">Metode masuk: ${esc((user.providers || []).join(", ") || "-")}</p>
        <p class="actions">
          <a class="btn small" href="#/saldo">Saldo &amp; riwayat</a>
          <a class="btn small ghost" href="#/">Mulai mencari</a>
          <button class="btn small ghost" id="auth-signout" type="button">Keluar</button>
        </p>
        <p id="auth-status" class="muted" role="status" aria-live="polite">${esc(message || "")}</p>
      </section>`;
  }

  function setStatus(text, kind) {
    const host = document.getElementById("auth-status");
    if (!host) return;
    host.textContent = text;
    host.dataset.kind = kind || "";
    host.className = kind === "error" ? "auth-error" : "muted";
  }

  function bind() {
    document.getElementById("auth-google")?.addEventListener("click", () => {
      setStatus("Mengalihkan ke Google…");
      A.signInWithGoogle();
    });

    document.getElementById("auth-signout")?.addEventListener("click", async () => {
      setStatus("Keluar…");
      await A.signOut();
      location.hash = "#/masuk";
      window.BIOXIP_CREDITS?.refreshBadge?.(true);
    });

    const emailForm = document.getElementById("auth-email-form");
    emailForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = document.getElementById("auth-email").value.trim();
      if (!email) return;
      setStatus("Mengirim kode…");
      const result = await A.signInWithEmail(email);
      if (!result.ok) {
        setStatus(`Gagal mengirim kode (${result.status}). Periksa email lalu coba lagi.`, "error");
        return;
      }
      const otpForm = document.getElementById("auth-otp-form");
      if (otpForm) otpForm.hidden = false;
      document.getElementById("auth-otp")?.focus();
      setStatus(`Kode dikirim ke ${email}. Cek kotak masuk atau spam.`);
    });

    const otpForm = document.getElementById("auth-otp-form");
    otpForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = document.getElementById("auth-email").value.trim();
      const token = document.getElementById("auth-otp").value.replace(/\D/g, "").slice(0, 6);
      if (!email || token.length < 6) {
        setStatus("Masukkan 6 digit kode dari email.", "error");
        return;
      }
      setStatus("Memverifikasi…");
      const result = await A.verifyOtp(email, token);
      if (!result.ok) {
        setStatus("Kode salah atau kedaluwarsa. Minta kode baru lalu coba lagi.", "error");
        return;
      }
      window.BIOXIP_CREDITS?.refreshBadge?.(true);
      location.hash = "#/";
    });
  }

  window.BIOXIP_MASUK = { pageHTML, bind };
})();
