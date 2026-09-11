const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const AUTH_SRC = fs.readFileSync(path.join(ROOT, "web", "js", "auth.js"), "utf8");

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

function createAuth({ fetchImpl } = {}) {
  const storage = new Map();
  const listeners = [];
  const sandbox = {
    console,
    URLSearchParams,
    encodeURIComponent,
    JSON,
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Promise,
    Math,
    fetch:
      fetchImpl ||
      (async () => ({ ok: false, status: 500, text: async () => "{}" })),
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    location: { hash: "", search: "", pathname: "/", origin: "https://bioxip.pages.dev", assign() {} },
    history: { replaceState() {} },
    window: null,
  };
  sandbox.window = sandbox;
  sandbox.window.BIOXIP_CONFIG = { supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "anon-key" };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(AUTH_SRC, sandbox, { filename: "auth.js" });
  return { auth: sandbox.BIOXIP_AUTH, storage, sandbox, listeners };
}

(async () => {
// --- parseAuthParams -------------------------------------------------------
{
  const { auth } = createAuth();
  const fromHash = auth.parseAuthParams("#access_token=abc&refresh_token=ref&expires_in=3600", "");
  check("parse: access_token dari hash", fromHash.access_token === "abc", String(fromHash.access_token));
  check("parse: refresh_token dari hash", fromHash.refresh_token === "ref", String(fromHash.refresh_token));
  const fromSearch = auth.parseAuthParams("", "?code=xyz123");
  check("parse: code dari query", fromSearch.code === "xyz123", String(fromSearch.code));
  const err = auth.parseAuthParams("#error=access_denied&error_description=Ditolak+oleh+Google", "");
  check("parse: error & deskripsi", err.error === "access_denied" && err.error_description.includes("Ditolak"), String(err.error));
  const none = auth.parseAuthParams("#/search?q=x", "");
  check("parse: rute biasa tidak terdeteksi auth", !none.access_token && !none.code && !none.error);
}

// --- sessionFromParams & isExpired ----------------------------------------
{
  const { auth } = createAuth();
  const session = auth.sessionFromParams({ access_token: "a", refresh_token: "r", expires_in: 3600 }, 1000);
  check("session: expiresAt dihitung dari expires_in", session.expiresAt === 4600, String(session.expiresAt));
  const explicit = auth.sessionFromParams({ access_token: "a", expires_at: 9999 }, 1000);
  check("session: pakai expires_at bila ada", explicit.expiresAt === 9999, String(explicit.expiresAt));
  check("session: tanpa token → null", auth.sessionFromParams({}, 1000) === null);
  check("expired: mendekati kedaluwarsa dianggap expired", auth.isExpired({ accessToken: "a", expiresAt: 1000 }, 1000) === true);
  check("expired: masih jauh dianggap valid", auth.isExpired({ accessToken: "a", expiresAt: 100000 }, 1000) === false);
  check("expired: tanpa token selalu expired", auth.isExpired(null, 1000) === true);
}

// --- handleRedirect -------------------------------------------------------
{
  const { auth, storage, sandbox } = createAuth();
  sandbox.location.hash = "#access_token=tok123&refresh_token=ref456&expires_in=3600";
  const outcome = auth.handleRedirect();
  check("redirect: ditandai handled", outcome.handled === true && outcome.signedIn === true, JSON.stringify(outcome));
  check("redirect: sesi tersimpan", storage.get("bioxip-access-token") === "tok123", String(storage.get("bioxip-access-token")));
  check("redirect: refresh tersimpan", storage.get("bioxip-refresh-token") === "ref456");

  const errorCase = createAuth();
  errorCase.sandbox.location.hash = "#error=access_denied&error_description=Ditolak";
  const errorOutcome = errorCase.auth.handleRedirect();
  check(
    "redirect: error diteruskan tanpa sesi",
    errorOutcome.handled === true && errorOutcome.error && !errorCase.storage.get("bioxip-access-token"),
    JSON.stringify(errorOutcome),
  );

  const plain = createAuth();
  plain.sandbox.location.hash = "#/search?q=dengue";
  check("redirect: rute biasa tidak dianggap redirect", plain.auth.handleRedirect().handled === false);
}

// --- refreshSession & ensureFresh -----------------------------------------
{
  const okFetch = async () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        access_token: "baru",
        refresh_token: "ref-baru",
        expires_in: 3600,
        user: { id: "u1", email: "a@b.c", user_metadata: { full_name: "A B" }, identities: [{ provider: "google" }] },
      }),
  });
  const { auth, storage, sandbox } = createAuth({ fetchImpl: okFetch });
  sandbox.location.hash = "#access_token=lama&refresh_token=ref-lama&expires_in=1";
  auth.handleRedirect();
  const refreshed = await auth.refreshSession();
  check("refresh: token diperbarui", refreshed && refreshed.accessToken === "baru", JSON.stringify(refreshed));
  check("refresh: sesi tersimpan ulang", storage.get("bioxip-access-token") === "baru");
  check("refresh: profil pengguna tersimpan", String(storage.get("bioxip-user")).includes("a@b.c"));

  const failFetch = async () => ({ ok: false, status: 401, text: async () => "{}" });
  const failing = createAuth({ fetchImpl: failFetch });
  failing.sandbox.location.hash = "#access_token=lama&refresh_token=ref-lama&expires_in=3600";
  failing.auth.handleRedirect();
  const failed = await failing.auth.refreshSession();
  check(
    "refresh: gagal → sesi dibersihkan",
    failed === null && !failing.storage.get("bioxip-access-token"),
    String(failing.storage.get("bioxip-access-token") || "-"),
  );

  const ensure = createAuth({ fetchImpl: okFetch });
  ensure.sandbox.location.hash = "#access_token=lama&refresh_token=ref-lama&expires_in=1";
  ensure.auth.handleRedirect();
  const ensured = await ensure.auth.ensureFresh();
  check("ensureFresh: menyegarkan saat hampir kedaluwarsa", ensured?.accessToken === "baru", JSON.stringify(ensured));
  check("getAccessToken: mengembalikan token segar", ensure.auth.getAccessToken() === "baru");
}

// --- signOut ---------------------------------------------------------------
{
  const { auth, storage, sandbox } = createAuth({ fetchImpl: async () => ({ ok: true, status: 204, text: async () => "" }) });
  sandbox.location.hash = "#access_token=tok&refresh_token=ref&expires_in=3600";
  auth.handleRedirect();
  await auth.signOut();
  check("signOut: sesi dibersihkan", !storage.get("bioxip-access-token") && !storage.get("bioxip-user"));
}

let failed = 0;
for (const item of results) {
  if (!item.ok) failed++;
  console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? " (" + item.detail + ")" : ""}`);
}
console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error("AUTH TEST ERROR:", error.message);
  process.exit(1);
});
