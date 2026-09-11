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
// Kunci cache harus di origin yang sama dengan Worker, bukan host sintetis.
if (!cache.includes("origin")) problems.push("_cache.js: cacheKey harus menerima origin (same-origin untuk Cache API)");
if (/cache\.bioxip\.local/.test(cache)) problems.push("_cache.js: kunci cache tidak boleh memakai host sintetis");
if (!cache.includes("putWarned")) problems.push("_cache.js: kegagalan cache.put harus dicatat (tidak silent)");

// 2. /api/search memakai cache dengan TTL dari env dan bisa dilewati (no_cache).
const search = read("functions/api/search.js");
for (const marker of ["cacheGetJson", "cachePutJson", "cacheKey", "SEARCH_CACHE_NAMESPACE", "no_cache", "searchCacheTtl"]) {
  if (!search.includes(marker)) problems.push(`api/search.js: tidak ada "${marker}"`);
}
// Cursor pagination mengubah isi respons → wajib ada di kunci cache.
for (const cursor of ["epmc_cursor", "ct_token"]) {
  if (!new RegExp(`${cursor}:`).test(search)) {
    problems.push(`api/search.js: kunci cache harus memuat ${cursor} (cursor mengubah hasil)`);
  }
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
// no_cache=1 dan respons non-200 tidak boleh ditandai cacheable (integritas validator).
if (!middleware.includes('url.searchParams.get("no_cache") === "1"')) {
  problems.push("_middleware.js: no_cache=1 harus memaksa no-store");
}
if (!middleware.includes("response.status === 200")) {
  problems.push("_middleware.js: hanya respons 200 yang boleh ditandai cacheable");
}

// 4. Cache jawaban AI di chat: hit tidak boleh memanggil provider.
const chat = read("functions/api/ai/chat.js");
for (const marker of ["ANSWER_CACHE_NAMESPACE", "cacheGetJson", "cachePutJson", 'mode = "cache"', "citationSnapshot", "PROMPT_VERSION"]) {
  if (!chat.includes(marker)) problems.push(`api/ai/chat.js: tidak ada "${marker}"`);
}
if (!chat.includes("mode !== \"cache\" && providerIsReady")) {
  problems.push("api/ai/chat.js: provider harus dilewati saat cache hit");
}
if (!chat.includes("await cachePutJson(cacheId")) {
  problems.push("api/ai/chat.js: jawaban LLM harus disimpan ke cache");
}
// Label provider pada log harus benar untuk mode cache (bukan tercatat sebagai mock).
if (!chat.includes('provider: mode === "mock" ? "mock" : "deepseek"')) {
  problems.push('api/ai/chat.js: provider log harus `mode === "mock" ? "mock" : "deepseek"` (cache = deepseek, bukan mock)');
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

// 6. Cache jawaban L2 (Postgres) sebagai lapisan andal.
const answerCache = read("functions/_answercache.js");
for (const marker of ["answerHash", "answerCacheGet", "answerCachePut", "answer_cache", "fn_answer_cache_hit"]) {
  if (!answerCache.includes(marker)) problems.push(`_answercache.js: tidak ada "${marker}"`);
}
const chatSrc = read("functions/api/ai/chat.js");
if (!chatSrc.includes("answerCacheGet") || !chatSrc.includes("answerCachePut")) {
  problems.push("api/ai/chat.js: harus memakai cache L2 (answerCacheGet/answerCachePut)");
}
if (!chatSrc.includes('cache_layer')) problems.push("api/ai/chat.js: meta harus melaporkan lapisan cache (l1/l2)");
const migration013 = read("supabase/migrations/013_answer_cache.sql");
for (const marker of ["create table if not exists answer_cache", "enable row level security", "fn_answer_cache_hit"]) {
  if (!migration013.includes(marker)) problems.push(`013_answer_cache.sql: tidak ada "${marker}"`);
}
if (!migration013.includes("revoke execute on function fn_answer_cache_hit")) {
  problems.push("013_answer_cache.sql: fn_answer_cache_hit harus dicabut dari anon/authenticated");
}

console.log(
  `Cache: search + answer L1(Cache API) + L2(Postgres) · TTL default ${900}s · throttle NCBI ${noKey}ms (tanpa key) / ${withKey}ms (dengan key)`
);
if (problems.length) {
  console.log("\nMASALAH:");
  for (const problem of problems) console.log(" - " + problem);
  process.exit(1);
}
console.log("VALID: edge cache pencarian + cache jawaban AI + throttle NCBI sesuai batas resmi");
