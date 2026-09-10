const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FUNCTIONS = path.join(ROOT, "functions");
const IMPORT_RE = /from\s+["']([^"']+)["']/g;
const problems = [];
let checked = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) inspect(full);
  }
}

function inspect(file) {
  const source = fs.readFileSync(file, "utf8");
  const relative = path.relative(ROOT, file);
  let match;
  while ((match = IMPORT_RE.exec(source))) {
    const spec = match[1];
    if (!spec.startsWith(".")) continue; // paket eksternal / bawaan
    checked++;
    const target = path.resolve(path.dirname(file), spec);
    if (!fs.existsSync(target)) {
      problems.push(`${relative}: impor tidak ditemukan → ${spec}`);
    }
  }
}

walk(FUNCTIONS);

const requiredExports = [
  ["functions/api/credits/me.js", "onRequestGet"],
  ["functions/api/credits/ledger.js", "onRequestGet"],
  ["functions/api/search.js", "onRequestGet"],
  ["functions/api/drug.js", "onRequestGet"],
  ["functions/api/interactions.js", "onRequestGet"],
];
for (const [file, name] of requiredExports) {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  if (!source.includes(`export async function ${name}`)) {
    problems.push(`${file}: tidak mengekspor ${name}`);
  }
}

console.log(`Fungsi: ${checked} impor relatif diperiksa`);
if (problems.length) {
  console.log("\nMASALAH:");
  for (const problem of problems) console.log(" - " + problem);
  process.exit(1);
}
console.log("VALID: semua impor relatif di functions/ dapat diselesaikan (mencegah gagal bundel)");
