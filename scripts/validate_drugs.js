const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "functions", "_drugs.json");
const data = JSON.parse(fs.readFileSync(file, "utf8"));

const ATC_RE = /^[A-Z][0-9]{2}[A-Z]{2}([0-9]{2})?$/;
const problems = [];
const slugs = new Set();
const atcs = new Set();

if (!data.source_url || !data.edition) problems.push("metadata fornas (edition/source_url) wajib");
if (!Array.isArray(data.drugs) || data.drugs.length < 30) {
  problems.push(`jumlah obat minimal 30 (sekarang ${data.drugs?.length || 0})`);
}

for (const drug of data.drugs || []) {
  const tag = drug.slug || drug.name || "(tanpa nama)";
  if (!drug.slug || !drug.name || !drug.inn) problems.push(`${tag}: slug/name/inn wajib`);
  if (!drug.kelas || !drug.rute) problems.push(`${tag}: kelas/rute wajib`);
  if (!ATC_RE.test(drug.atc || "")) problems.push(`${tag}: ATC tidak valid (${drug.atc})`);
  if (!Array.isArray(drug.aliases) || drug.aliases.length === 0) problems.push(`${tag}: aliases wajib`);
  if (slugs.has(drug.slug)) problems.push(`${tag}: slug duplikat`);
  if (atcs.has(drug.atc)) problems.push(`${tag}: ATC duplikat (${drug.atc})`);
  slugs.add(drug.slug);
  atcs.add(drug.atc);
}

console.log(`Katalog: ${data.drugs?.length || 0} obat, edisi ${data.edition}`);
if (problems.length) {
  console.log("\nMASALAH:");
  for (const p of problems) console.log(" - " + p);
  process.exit(1);
}
console.log("VALID: struktur, ATC unik & format benar, alias lengkap");
