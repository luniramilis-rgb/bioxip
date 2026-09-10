const fs = require("fs");
const path = require("path");

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "functions", "_monitoring.json"), "utf8"));
const catalogue = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "functions", "_drugs.json"), "utf8"));

const problems = [];
const entries = data.drugs || {};
const slugs = catalogue.drugs.map((d) => d.slug);

for (const slug of slugs) {
  const entry = entries[slug];
  if (!entry) {
    problems.push(`${slug}: belum ada entri monitoring`);
    continue;
  }
  if (!Array.isArray(entry.monitoring) || entry.monitoring.length === 0) {
    problems.push(`${slug}: monitoring wajib berisi minimal 1 item`);
  }
  for (const field of ["renal", "hepatic", "geriatric"]) {
    if (!entry[field]) problems.push(`${slug}: ${field} wajib`);
  }
  if (entry.deprescribing && !Array.isArray(entry.deprescribing)) {
    problems.push(`${slug}: deprescribing harus array`);
  }
}

for (const slug of Object.keys(entries)) {
  if (!slugs.includes(slug)) problems.push(`${slug}: tidak ada di katalog obat`);
}

console.log(`Monitoring: ${Object.keys(entries).length} entri, katalog ${slugs.length} obat, reviewed=${data.reviewed}`);
if (problems.length) {
  console.log("\nMASALAH:");
  for (const p of problems) console.log(" - " + p);
  process.exit(1);
}
console.log("VALID: semua obat katalog punya monitoring + penyesuaian ginjal/hati/lansia");
