const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, CF-Access-Jwt-Assertion",
};

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const response = await next();
  const headers = new Headers(response.headers);

  if (url.pathname.startsWith("/api/")) {
    for (const [key, value] of Object.entries(CORS)) {
      headers.set(key, value);
    }
    // /api/search boleh di-cache di edge (TTL ditentukan fungsi); endpoint lain (termasuk SSE AI) tidak.
    // `no_cache=1` dan respons non-200 TIDAK boleh ditandai cacheable agar validator selalu segar.
    const bypass = url.searchParams.get("no_cache") === "1";
    if (url.pathname === "/api/search" && !bypass && response.status === 200) {
      headers.set("Cache-Control", `public, max-age=${env.SEARCH_CACHE_TTL_SECONDS || 900}`);
      headers.set("Vary", "Accept-Encoding");
    } else {
      headers.set("Cache-Control", "no-store");
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
