const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const problems = [];

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

// 1. Modul cache harus ada dan memakai Cache API + fallback memori.
const cache = read("functions/_cache.js");
for (const marker of ["caches.default", "cacheGetJson", "cachePutJson", "cacheKey", "MEMORY_MAX"]) {
  if (!cache.includes(marker)) problems.push(`_cache.js: tidak ada "${marker}"`);
}
if (!cache.includes("typeof caches")) problems.push("_cache.js: harus menjaga ketersediaan Cache API (typeof caches)");
if (!cache.includes("expires")) problems.push("_cache.js: fallback memori harus punya masa kedaluwarsa");

// 2. /api/search memakai cache dengan TTL dari env dan bisa dilewati (no_cache).
const search = read("functions/api/search.js");
for (const marker of ["cacheGetJson", "cachePutJson", "cacheKey", "SEARCH_CACHE_NAMESPACE", "no_cache", "searchCacheTtl"]) {
  if (!search.includes(marker)) problems.push(`api/search.js: tidak ada "${marker}"`);
}
if (!search.includes('cache: "hit"') || !search.includes('cache: "miss"')) {
  problems.push("api/search.js: respons harus menandai cache hit/miss");
}
if (!search.includes("cachePutJson(key, { ...body, cache: \"miss\" }, searchCacheTtl(env))")) {
  problems.push("api/search.js: penyimpanan cache harus memakai TTL dari env");
}
if (/SEARCH_CACHE_TTL_SECONDS/.test(search) && !search.includes("env?.SEARCH_CACHE_TTL_SECONDS")) {
  problems.push("api/search.js: TTL cache harus dibaca dari env, bukan globalThis");
}

// 3. Middleware: /api/search boleh di-cache, endpoint lain no-store.
const middleware = read("functions/_middleware.js");
if (!middleware.includes('url.pathname === "/api/search"')) {
  problems.push("_middleware.js: /api/search harus dikecualikan dari no-store");
}
if (!middleware.includes('headers.set("Cache-Control", "no-store")')) {
  problems.push("_middleware.js: endpoint non-search harus tetap no-store");
}

// 4. Cache jawaban AI di chat: hit tidak boleh memanggil provider.
const chat = read("functions/api/ai/chat.js");
for (const marker of ["ANSWER_CACHE_NAMESPACE", "cacheGetJson", "cachePutJson", 'mode = "cache"', "hashKey"]) {
  if (!chat.includes(marker)) problems.push(`api/ai/chat.js: tidak ada "${marker}"`);
}
if (!chat.includes("mode !== \"cache\" && providerIsReady")) {
  problems.push("api/ai/chat.js: provider harus dilewati saat cache hit");
}
if (!chat.includes("await cachePutJson(cacheId")) {
  problems.push("api/ai/chat.js: jawaban LLM harus disimpan ke cache");
}

// 5. Throttle NCBI mengikuti batas resmi (3 rps tanpa key, 10 rps dengan key).
const pubmed = read("functions/_pubmed.js");
if (!pubmed.includes("MIN_INTERVAL_NO_KEY_MS")) problems.push("_pubmed.js: tidak ada batas interval tanpa key");
if (!pubmed.includes("MIN_INTERVAL_WITH_KEY_MS")) problems.push("_pubmed.js: tidak ada batas interval dengan key");
const noKey = Number(pubmed.match(/MIN_INTERVAL_NO_KEY_MS\s*=\s*(\d+)/)?.[1] || 0);
const withKey = Number(pubmed.match(/MIN_INTERVAL_WITH_KEY_MS\s*=\s*(\d+)/)?.[1] || 0);
if (!(noKey >= 334)) problems.push(`_pubmed.js: interval tanpa key ${noKey}ms terlalu cepat (butuh >= 334ms untuk 3 rps)`);
if (!(withKey >= 100)) problems.push(`_pubmed.js: interval dengan key ${withKey}ms terlalu cepat (butuh >= 100ms untuk 10 rps)`);
if (!pubmed.includes("throttle(env)")) problems.push("_pubmed.js: throttle harus menerima env untuk memilih interval");

console.log(
  `Cache: namespace search + answer · TTL default ${900}s · thruttle NCBI ${noKey}ms (tanpa key) / ${withKey}ms (dengan key)`
);
if (problems.length) {
  console.log("\nMASALAH:");
  for (const problem of problems) console.log(" - " + problem);
  process.exit(1);
}
console.log("VALID: edge cache pencarian + cache jawaban AI + throttle NCBI sesuai batas resmi");
