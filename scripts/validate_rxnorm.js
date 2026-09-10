const fs = require("fs");
const path = require("path");

const RXNAV = "https://rxnav.nlm.nih.gov/REST";
const file = path.join(__dirname, "..", "functions", "_drugs.json");
const { drugs } = JSON.parse(fs.readFileSync(file, "utf8"));

const TERMS = [
  ["INN", (d) => d.inn],
  ["Nama ID", (d) => d.name],
];

async function resolve(term) {
  const resp = await fetch(
    `${RXNAV}/approximateTerm.json?term=${encodeURIComponent(term)}&maxEntries=3`,
  );
  if (!resp.ok) return null;
  const data = await resp.json();
  const best = (data.approximateGroup?.candidate || [])
    .filter((c) => c.rxcui && Number(c.rank || 99) <= 1)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
  return best ? { rxcui: best.rxcui, name: best.name, score: Number(best.score || 0) } : null;
}

(async () => {
  const summary = {};
  for (const [label, pick] of TERMS) {
    let mapped = 0;
    const failures = [];
    for (const drug of drugs) {
      const term = pick(drug);
      try {
        const hit = await resolve(term);
        if (hit) mapped++;
        else failures.push(`${drug.slug} (${term})`);
      } catch (error) {
        failures.push(`${drug.slug} (${term}) ERROR ${error.message}`);
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    summary[label] = { mapped, total: drugs.length, failures };
  }

  for (const [label, result] of Object.entries(summary)) {
    const pct = Math.round((result.mapped / result.total) * 100);
    console.log(`\n${label}: ${result.mapped}/${result.total} terpetakan (${pct}%)`);
    if (result.failures.length) {
      console.log("  Gagal:");
      for (const f of result.failures) console.log("   - " + f);
    }
  }

  const innPct = summary.INN.mapped / summary.INN.total;
  const idPct = summary["Nama ID"].mapped / summary["Nama ID"].total;
  const ok = innPct >= 0.8 && idPct >= 0.5;
  console.log(
    `\n${ok ? "LULUS" : "PERLU PERBAIKAN"}: INN ${Math.round(innPct * 100)}% (min 80%), Nama ID ${Math.round(idPct * 100)}% (min 50%)`,
  );
  process.exit(ok ? 0 : 1);
})();
