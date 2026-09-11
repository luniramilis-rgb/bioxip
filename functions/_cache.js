/**
 * Cache edge bioXip (Cloudflare Cache API + fallback in-memory untuk dev/test).
 * Dipakai untuk respons pencarian (JSON) dan jawaban AI (JSON grounded).
 */

const VERSION = "v1";
const MEMORY = new Map();
const MEMORY_MAX = 200;

function hasCacheApi() {
  return typeof caches !== "undefined" && caches && caches.default;
}

export function cacheKey(namespace, params = {}, version = VERSION) {
  const url = new URL(`https://cache.bioxip.local/${namespace}`);
  for (const [key, value] of Object.entries(params).sort(([a], [b]) => a.localeCompare(b))) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  url.searchParams.set("v", version);
  return url.toString();
}

export async function cacheGetJson(key) {
  if (hasCacheApi()) {
    try {
      const hit = await caches.default.match(key);
      if (hit) return hit.json();
    } catch {
      /* jatuh ke memori */
    }
  }
  const entry = MEMORY.get(key);
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    MEMORY.delete(key);
    return null;
  }
  return entry.value;
}

export async function cachePutJson(key, value, ttlSeconds) {
  const ttl = Math.max(1, Math.floor(ttlSeconds));
  if (hasCacheApi()) {
    try {
      const response = new Response(JSON.stringify(value), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${ttl}`,
        },
      });
      await caches.default.put(key, response);
      return;
    } catch {
      /* jatuh ke memori */
    }
  }
  if (MEMORY.size >= MEMORY_MAX) {
    const oldest = MEMORY.keys().next().value;
    MEMORY.delete(oldest);
  }
  MEMORY.set(key, { value, expires: Date.now() + ttl * 1000 });
}

export function resetMemoryCache() {
  MEMORY.clear();
}
