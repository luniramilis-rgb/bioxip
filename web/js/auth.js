(() => {
  const cfg = window.BIOXIP_CONFIG || {};
  const BASE = (cfg.supabaseUrl || "").replace(/\/$/, "");
  const ANON = cfg.supabaseAnonKey || "";

  const K = {
    access: "bioxip-access-token",
    refresh: "bioxip-refresh-token",
    expires: "bioxip-expires-at",
    user: "bioxip-user",
  };

  const SKEW_SECONDS = 120;
  const listeners = [];

  function storage() {
    try {
      return typeof localStorage !== "undefined" ? localStorage : null;
    } catch {
      return null;
    }
  }

  function read(key) {
    const store = storage();
    return store ? store.getItem(key) : null;
  }

  function write(key, value) {
    const store = storage();
    if (!store) return;
    if (value === null || value === undefined) store.removeItem(key);
    else store.setItem(key, String(value));
  }

  function parseAuthParams(hash, search) {
    const cleanHash = String(hash || "").replace(/^#/, "");
    const fromHash = new URLSearchParams(cleanHash);
    const fromSearch = new URLSearchParams(String(search || "").replace(/^\?/, ""));
    const pick = (key) => fromHash.get(key) || fromSearch.get(key) || null;
    return {
      access_token: pick("access_token"),
      refresh_token: pick("refresh_token"),
      expires_in: pick("expires_in"),
      expires_at: pick("expires_at"),
      code: pick("code"),
      error: pick("error"),
      error_description: pick("error_description"),
      provider: pick("provider"),
    };
  }

  function sessionFromParams(params, nowSeconds) {
    if (!params || !params.access_token) return null;
    const expiresAt = Number(params.expires_at) || (Number(params.expires_in) || 3600) + nowSeconds;
    return {
      accessToken: params.access_token,
      refreshToken: params.refresh_token || null,
      expiresAt,
    };
  }

  function saveSession(session) {
    write(K.access, session.accessToken);
    write(K.refresh, session.refreshToken);
    write(K.expires, session.expiresAt);
  }

  function getSession() {
    const accessToken = read(K.access);
    if (!accessToken) return null;
    return {
      accessToken,
      refreshToken: read(K.refresh),
      expiresAt: Number(read(K.expires)) || 0,
    };
  }

  function clearSession() {
    write(K.access, null);
    write(K.refresh, null);
    write(K.expires, null);
    write(K.user, null);
  }

  function isExpired(session, nowSeconds, skew = SKEW_SECONDS) {
    if (!session || !session.accessToken) return true;
    if (!session.expiresAt) return false;
    return session.expiresAt - skew <= nowSeconds;
  }

  function getAccessToken() {
    const session = getSession();
    return session && !isExpired(session, Math.floor(Date.now() / 1000)) ? session.accessToken : null;
  }

  function getUser() {
    const raw = read(K.user);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function saveUser(user) {
    if (!user) {
      write(K.user, null);
      return null;
    }
    const meta = user.user_metadata || {};
    const identities = Array.isArray(user.identities) ? user.identities.map((i) => i.provider) : [];
    const profile = {
      id: user.id,
      email: user.email || meta.email || null,
      name: meta.full_name || meta.name || (user.email || "").split("@")[0] || "Pengguna",
      avatar: meta.avatar_url || meta.picture || null,
      providers: identities.length ? identities : [user.app_metadata?.provider].filter(Boolean),
    };
    write(K.user, JSON.stringify(profile));
    return profile;
  }

  function notify() {
    const user = getUser();
    for (const cb of listeners) {
      try {
        cb(user);
      } catch {
        /* listener gagal tidak boleh menghentikan aplikasi */
      }
    }
  }

  function onAuthChange(callback) {
    listeners.push(callback);
    return () => {
      const index = listeners.indexOf(callback);
      if (index >= 0) listeners.splice(index, 1);
    };
  }

  async function request(path, options = {}) {
    const resp = await fetch(`${BASE}${path}`, {
      method: options.method || "GET",
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${options.token || ANON}`,
        "Content-Type": "application/json",
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await resp.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { message: text };
    }
    return { ok: resp.ok, status: resp.status, body };
  }

  async function fetchUser(token) {
    const result = await request("/auth/v1/user", { token: token || getAccessToken() });
    if (!result.ok) return null;
    return saveUser(result.body);
  }

  async function refreshSession() {
    const session = getSession();
    if (!session?.refreshToken) return null;
    const result = await request("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      body: { refresh_token: session.refreshToken },
    });
    if (!result.ok || !result.body?.access_token) {
      clearSession();
      notify();
      return null;
    }
    const next = {
      accessToken: result.body.access_token,
      refreshToken: result.body.refresh_token || session.refreshToken,
      expiresAt: (Number(result.body.expires_in) || 3600) + Math.floor(Date.now() / 1000),
    };
    saveSession(next);
    if (result.body.user) saveUser(result.body.user);
    notify();
    return next;
  }

  async function ensureFresh() {
    const session = getSession();
    if (!session) return null;
    if (!isExpired(session, Math.floor(Date.now() / 1000))) return session;
    return refreshSession();
  }

  function cleanUrl() {
    if (typeof history === "undefined" || typeof location === "undefined") return;
    const target = `${location.pathname}${location.search && !location.search.includes("code=") ? location.search : ""}`;
    try {
      history.replaceState(null, "", target);
    } catch {
      /* abaikan */
    }
  }

  function handleRedirect() {
    if (typeof location === "undefined") return { handled: false };
    const params = parseAuthParams(location.hash, location.search);
    const hasSession = Boolean(params.access_token);
    const hasError = Boolean(params.error || params.error_description);
    const hasCode = Boolean(params.code);
    if (!hasSession && !hasError && !hasCode) return { handled: false };

    if (hasSession) {
      saveSession(sessionFromParams(params, Math.floor(Date.now() / 1000)));
    } else if (hasError) {
      clearSession();
    }
    cleanUrl();
    notify();
    if (hasSession) void fetchUser();
    return {
      handled: true,
      signedIn: hasSession,
      code: hasCode,
      error: hasError ? params.error_description || params.error || "auth_error" : null,
    };
  }

  function signInWithGoogle(redirectTo) {
    const target =
      redirectTo ||
      (typeof location !== "undefined" ? `${location.origin}${location.pathname}` : "");
    const url = `${BASE}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(target)}`;
    if (typeof location !== "undefined") location.assign(url);
    return url;
  }

  async function signInWithEmail(email) {
    return request("/auth/v1/otp", {
      method: "POST",
      body: { email, create_user: true },
    });
  }

  async function verifyOtp(email, token) {
    const result = await request("/auth/v1/verify", {
      method: "POST",
      body: { type: "email", email, token },
    });
    if (!result.ok || !result.body?.access_token) return result;
    saveSession({
      accessToken: result.body.access_token,
      refreshToken: result.body.refresh_token || null,
      expiresAt: (Number(result.body.expires_in) || 3600) + Math.floor(Date.now() / 1000),
    });
    if (result.body.user) saveUser(result.body.user);
    else await fetchUser(result.body.access_token);
    notify();
    return result;
  }

  async function signOut() {
    const token = getAccessToken();
    if (token) await request("/auth/v1/logout", { method: "POST", token }).catch(() => null);
    clearSession();
    notify();
  }

  const configReady = Boolean(BASE && ANON);

  window.BIOXIP_AUTH = {
    configReady,
    parseAuthParams,
    sessionFromParams,
    isExpired,
    getSession,
    getUser,
    getAccessToken,
    ensureFresh,
    refreshSession,
    handleRedirect,
    signInWithGoogle,
    signInWithEmail,
    verifyOtp,
    signOut,
    fetchUser,
    onAuthChange,
    clearSession,
    saveSession,
    saveUser,
  };
})();
