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
    headers.set("Cache-Control", "no-store");
  }

  if (env.TURNSTILE_SECRET_KEY && !response.headers.has("CF-Turnstile-Status")) {
    headers.set("X-Turnstile-Required", "true");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
