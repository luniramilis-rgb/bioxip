/* klien kredit & SSE AI — window.BIOXIP_CREDITS */
(() => {
  const TOKEN_KEY = "bioxip-access-token";

  function getToken() {
    const auth = window.BIOXIP_AUTH;
    if (auth?.getAccessToken) {
      const token = auth.getAccessToken();
      if (token) return token;
    }
    try {
      return localStorage.getItem(TOKEN_KEY) || "";
    } catch {
      return "";
    }
  }

  function setToken(value) {
    const auth = window.BIOXIP_AUTH;
    if (auth?.saveSession && value) {
      auth.saveSession({ accessToken: value, refreshToken: null, expiresAt: 0 });
      return;
    }
    try {
      if (value) localStorage.setItem(TOKEN_KEY, value);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* abaikan */
    }
  }

  function authHeaders() {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function getJson(path) {
    const resp = await fetch(path, { headers: { Accept: "application/json", ...authHeaders() } });
    let body = null;
    try {
      body = await resp.json();
    } catch {
      body = null;
    }
    return { status: resp.status, ok: resp.ok, body };
  }

  function formatIdr(value) {
    const number = Number(value || 0);
    return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(number);
  }

  async function me() {
    return getJson("/api/credits/me");
  }

  async function ledger(limit = 20) {
    return getJson(`/api/credits/ledger?limit=${limit}`);
  }

  async function estimate(question, maxTokens = 1024) {
    const params = new URLSearchParams({ max_tokens: String(maxTokens) });
    if (question) params.set("q", question.slice(0, 400));
    return getJson(`/api/ai/estimate?${params.toString()}`);
  }

  let lastRefresh = 0;

  async function refreshBadge(force = false) {
    const badge = document.getElementById("balance-badge");
    if (!badge) return null;
    if (!getToken()) {
      badge.textContent = "Saldo: —";
      badge.dataset.state = "anonymous";
      badge.title = "Masuk untuk melihat saldo";
      return null;
    }
    const now = Date.now();
    if (!force && now - lastRefresh < 10000) return null;
    lastRefresh = now;
    const result = await me();
    if (result.status === 401) {
      badge.textContent = "Saldo: sesi berakhir";
      badge.dataset.state = "expired";
      return null;
    }
    if (!result.ok && result.status !== 200) {
      badge.textContent = "Saldo: —";
      badge.dataset.state = "error";
      return null;
    }
    const balance = result.body?.balance_idr ?? 0;
    badge.textContent = `Saldo: ${formatIdr(balance)}`;
    badge.dataset.state = balance > 0 ? "ready" : "empty";
    badge.title = balance > 0 ? "Saldo tersedia" : "Saldo kosong — AI terkunci";
    return result.body;
  }
  async function streamChat(payload, handlers = {}) {
    const resp = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      let body = null;
      try {
        body = await resp.json();
      } catch {
        body = null;
      }
      handlers.onError?.({ status: resp.status, body });
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";
      for (const block of blocks) {
        const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim();
        const dataLine = block.match(/^data:\s*(.+)$/m)?.[1];
        if (!event || !dataLine) continue;
        let data = null;
        try {
          data = JSON.parse(dataLine);
        } catch {
          data = dataLine;
        }
        if (event === "meta") handlers.onMeta?.(data);
        else if (event === "delta") handlers.onDelta?.(data);
        else if (event === "replace") handlers.onReplace?.(data);
        else if (event === "citation") handlers.onCitation?.(data);
        else if (event === "citation_summary") handlers.onCitations?.(data);
        else if (event === "red_flag") handlers.onRedFlag?.(data);
        else if (event === "done") handlers.onDone?.(data);
        else if (event === "error") handlers.onStreamError?.(data);
      }
    }
    handlers.onEnd?.();
  }

  window.BIOXIP_CREDITS = {
    getToken,
    setToken,
    me,
    ledger,
    estimate,
    refreshBadge,
    streamChat,
    formatIdr,
  };
})();
