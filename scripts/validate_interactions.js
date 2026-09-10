const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "functions", "_interactions.json");
const data = JSON.parse(fs.readFileSync(file, "utf8"));

const SEVERITIES = new Set(["tinggi", "sedang", "rendah"]);
const problems = [];
const seen = new Set();

for (const pair of data.pairs || []) {
  const tag = `${pair.a}+${pair.b}`;
  if (!pair.a || !pair.b) problems.push(`${tag}: a/b wajib`);
  if (!SEVERITIES.has(pair.severity)) problems.push(`${tag}: severity tidak valid (${pair.severity})`);
  if (!pair.mechanism) problems.push(`${tag}: mechanism wajib`);
  if (!pair.advice) problems.push(`${tag}: advice wajib`);
  if (!pair.source) problems.push(`${tag}: source wajib`);
  if (typeof pair.reviewed !== "boolean") problems.push(`${tag}: reviewed harus boolean`);
  if (pair.a === pair.b) problems.push(`${tag}: pasangan tidak boleh sama`);
  const key = [pair.a, pair.b].sort().join("|");
  if (seen.has(key)) problems.push(`${tag}: pasangan duplikat`);
  seen.add(key);
}

console.log(`Tabel interaksi: ${data.pairs?.length || 0} pasangan`);
if ((data.pairs?.length || 0) < 10) problems.push("minimal 10 pasangan untuk batch awal");
if (problems.length) {
  console.log("\nMASALAH:");
  for (const p of problems) console.log(" - " + p);
  process.exit(1);
}
console.log("VALID: struktur, severity, mekanisme, anjuran, sumber, status review");
