const BASE = process.env.BIOXIP_BASE || "https://bioxip.pages.dev";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
}

async function get(path) {
  const resp = await fetch(`${BASE}${path}`, { headers: { Accept: "application/json" } });
  let body = null;
  try {
    body = await resp.json();
  } catch {
    body = null;
  }
  return { status: resp.status, body };
}

async function main() {
  const search = await get("/api/search?q=dengue&per_page=20");
  check("search: 200", search.status === 200, String(search.status));
  check("search: results array", Array.isArray(search.body?.results), "");
  check("search: total number", typeof search.body?.total === "number", String(search.body?.total));

  const answer = await get("/api/answer?q=metformin%20vs%20insulin%20diabetes");
  const studies = answer.body?.studies || [];
  const blocks = answer.body?.summary?.blocks || [];
  check("answer: 200", answer.status === 200, String(answer.status));
  check("answer: studies >= 5", studies.length >= 5, String(studies.length));
  check("answer: blocks >= 1", blocks.length >= 1, String(blocks.length));
  const refs = new Set(studies.map((s) => s.ref));
  const citesValid = blocks.every((b) => (b.cites || []).length > 0 && b.cites.every((c) => refs.has(c)));
  check("answer: setiap sitasi menunjuk studi yang ada", citesValid, "");

  for (const drug of ["parasetamol", "metformin", "amoksisilin", "oralit"]) {
    const res = await get(`/api/drug?q=${encodeURIComponent(drug)}`);
    const matched = res.body?.matched === true;
    const hasAtc = Boolean(res.body?.drug?.atc);
    const hasFornas = Boolean(res.body?.fornas?.edition);
    const hasSafety = Array.isArray(res.body?.safety?.missing_fields);
    check(`drug ${drug}: matched + ATC + Fornas + safety`, res.status === 200 && matched && hasAtc && hasFornas && hasSafety, res.body?.drug?.atc || "");
  }

  const para = await get("/api/drug?q=parasetamol");
  check(
    "drug parasetamol: label teragregasi tanpa field kosong",
    Array.isArray(para.body?.safety?.missing_fields) && para.body.safety.missing_fields.length === 0,
    `missing=${(para.body?.safety?.missing_fields || []).join("|")}`,
  );

  const rx = await get("/api/drug?q=parasetamol");
  check("drug rxnorm tersedia (info)", Boolean(rx.body?.rxnorm?.rxcui), rx.body?.rxnorm?.rxcui || "tidak tersedia");

  const mono = await get("/api/drug?q=metformin");
  check(
    "drug monitoring kurasi (metformin)",
    Boolean(mono.body?.monitoring?.monitoring?.length) && Boolean(mono.body?.monitoring?.renal),
    "",
  );

  const outside = await get("/api/drug?q=warfarin");
  check(
    "drug di luar katalog: matched via RxNorm atau saran",
    outside.body?.matched === true || Array.isArray(outside.body?.suggestions),
    outside.body?.matched ? String(outside.body?.outside_catalogue) : "suggestions",
  );

  const unknown = await get("/api/drug?q=zzzznotadrug");
  check("drug tidak dikenal: matched=false + saran", unknown.body?.matched === false && Array.isArray(unknown.body?.suggestions), "");

  const inter = await get("/api/interactions?q=metronidazol%20%2B%20warfarin");
  check("interactions: 200", inter.status === 200, String(inter.status));
  check("interactions: drugs resolved 2", (inter.body?.drugs || []).filter((d) => d.rxcui?.rxcui).length >= 2, "");
  check("interactions: pairs array", Array.isArray(inter.body?.pairs), String((inter.body?.pairs || []).length));
  check(
    "interactions: pasangan terkurasi dengan severity valid",
    (inter.body?.pairs || []).every((p) => ["tinggi", "sedang", "rendah"].includes(p.severity)) &&
      (inter.body?.pairs || []).length >= 1,
    (inter.body?.pairs || []).map((p) => p.severity).join("|"),
  );
  check("interactions: mentions array", Array.isArray(inter.body?.mentions), String((inter.body?.mentions || []).length));

  const single = await get("/api/interactions?q=metformin");
  check("interactions: tolak < 2 obat", single.status === 400, String(single.status));

  let failed = 0;
  for (const item of results) {
    if (!item.ok) failed++;
    console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? " (" + item.detail + ")" : ""}`);
  }
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error("VALIDATOR ERROR:", error.message);
  process.exit(1);
});
