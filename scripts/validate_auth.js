const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const problems = [];

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

const auth = read("web/js/auth.js");
const config = read("web/js/config.js");
const masuk = read("web/js/masuk.js");
const app = read("web/js/app.js");
const credits = read("web/js/credits.js");
const sw = read("web/sw.js");
const index = read("web/index.html");

// 1. Konfigurasi klien memuat URL + anon key (kunci publik, aman di browser).
for (const marker of ["supabaseUrl", "supabaseAnonKey"]) {
  if (!config.includes(marker)) problems.push(`config.js: tidak ada "${marker}"`);
}
if (!/https:\/\/[a-z0-9]+\.supabase\.co/.test(config)) problems.push("config.js: supabaseUrl tidak valid");
if (/service_role/.test(config) || /SERVICE_ROLE/.test(config)) {
  problems.push("config.js: tidak boleh memuat service role (hanya anon key)");
}

// 2. Modul auth menangani kedua bentuk redirect + refresh + sign out.
for (const marker of [
  "parseAuthParams",
  "sessionFromParams",
  "isExpired",
  "handleRedirect",
  "refreshSession",
  "ensureFresh",
  "getAccessToken",
  "signInWithGoogle",
  "signInWithEmail",
  "verifyOtp",
  "signOut",
]) {
  if (!auth.includes(marker)) problems.push(`auth.js: tidak ada "${marker}"`);
}
for (const param of ["access_token", "refresh_token", "code", "error_description"]) {
  if (!auth.includes(param)) problems.push(`auth.js: harus membaca param "${param}"`);
}
if (!auth.includes("grant_type=refresh_token")) problems.push("auth.js: belum mendukung refresh token");
if (!auth.includes("/auth/v1/verify")) problems.push("auth.js: OTP harus diverifikasi via /auth/v1/verify");
if (!auth.includes("history.replaceState")) problems.push("auth.js: URL bertoken harus dibersihkan");

// 3. Router menyerap redirect auth sebelum routing (perbaikan 'Halaman tidak ditemukan').
if (!app.includes("handleRedirect")) problems.push("app.js: route() harus memanggil handleRedirect (token di hash)");
if (!app.includes('"masuk"')) problems.push("app.js: belum ada rute #/masuk");

// 4. Halaman masuk: Google + email/OTP + catatan data pasien + keluar.
for (const marker of ["auth-google", "auth-email-form", "auth-otp-form", "auth-signout", "data pasien"]) {
  if (!masuk.includes(marker)) problems.push(`masuk.js: tidak ada "${marker}"`);
}

// 5. Token dipakai bersama dengan modul kredit (satu sumber kebenaran).
if (!credits.includes("BIOXIP_AUTH") || !credits.includes("getAccessToken")) {
  problems.push("credits.js: harus memakai token dari auth.js (bukan hanya localStorage)");
}

// 6. Service worker mem-precache semua modul baru.
for (const file of ["/js/config.js", "/js/auth.js", "/js/masuk.js"]) {
  if (!sw.includes(file)) problems.push(`sw.js: belum mem-precache ${file}`);
}

// 7. Index memuat skrip sesuai urutan (config & auth sebelum app).
const order = ["/js/config.js", "/js/auth.js", "/js/masuk.js", "/js/app.js"];
let lastIndex = -1;
for (const script of order) {
  const position = index.indexOf(script);
  if (position === -1) problems.push(`index.html: tidak memuat ${script}`);
  else if (position < lastIndex) problems.push(`index.html: urutan skrip salah (${script} harus setelah sebelumnya)`);
  else lastIndex = position;
}
if (!index.includes('id="auth-link"')) problems.push("index.html: tidak ada tautan masuk (auth-link)");
if (!index.includes("service_role")) {
  const exposesServiceRole = /service_role/i.test(config) || /service_role/i.test(auth);
  if (exposesServiceRole) problems.push("frontend: service role terdeteksi di kode klien");
}

console.log(`Auth: klien ${auth.length} byte · halaman masuk ${masuk.length} byte · config publik OK`);
if (problems.length) {
  console.log("\nMASALAH:");
  for (const problem of problems) console.log(" - " + problem);
  process.exit(1);
}
console.log("VALID: auth klien (hash/code), refresh token, rute masuk, gating UI, precache SW");
