const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const source = fs
  .readFileSync(path.join(ROOT, "functions", "_credits.js"), "utf8")
  .replace(/^import\s+.*?;\s*$/gm, "")
  .replace(/export /g, "");
const sandbox = { console, JSON, String, Number, Boolean, Object, Array, Response, fetch: async () => ({ ok: false }) };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(`${source}\nglobalThis.__c = { isAdminEmail };`, sandbox, { filename: "_credits.js" });
const { isAdminEmail } = sandbox.__c;

const results = [];
const check = (name, ok) => results.push({ name, ok });

check("admin: email cocok (case-insensitive)", isAdminEmail("Lunira.Milis@Gmail.com", "lunira.milis@gmail.com") === true);
check("admin: allowlist multi + spasi", isAdminEmail("b@x.com", " a@x.com , b@x.com ") === true);
check("admin: non-admin ditolak", isAdminEmail("orang@lain.com", "lunira.milis@gmail.com") === false);
check("admin: allowlist kosong → tidak ada admin", isAdminEmail("lunira.milis@gmail.com", "") === false);
check("admin: email kosong ditolak", isAdminEmail("", "lunira.milis@gmail.com") === false);
check("admin: substring tidak cocok", isAdminEmail("xlunira.milis@gmail.com", "lunira.milis@gmail.com") === false);

let failed = 0;
for (const item of results) {
  if (!item.ok) failed++;
  console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}`);
}
console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
