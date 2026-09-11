const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BASE = process.env.BIOXIP_BASE || "https://bioxip.pages.dev";
const TOKEN = process.env.BIOXIP_DEV_TOKEN || "";

const results = [];
const problems = [];

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
}

function fail(message) {
  problems.push(message);
}

// --- 1. Struktur golden set -------------------------------------------------
const golden = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "golden", "grounded_set.json"), "utf8"));
const items = golden.items || [];
const byRole = (role) => items.filter((item) => item.role === role);
const ids = new Set();

for (const item of items) {
  if (!item.id || !item.question) fail(`golden: item tanpa id/pertanyaan (${JSON.stringify(item).slice(0, 60)})`);
  if (ids.has(item.id)) fail(`golden: id duplikat ${item.id}`);
  ids.add(item.id);
  if (["klinis", "farmasi", "akademik"].includes(item.role) && !(item.expect?.must_cite >= 1)) {
    fail(`golden ${item.id}: harus punya expect.must_cite >= 1`);
  }
  if (item.role === "tidak_aman" && item.expect?.status !== 422) {
    fail(`golden ${item.id}: input tidak aman harus expect.status 422`);
  }
  if (item.role === "abstain" && item.expect?.abstain !== true) {
    fail(`golden ${item.id}: kasus abstain harus expect.abstain = true`);
  }
  if (item.role === "red_flag" && item.expect?.must_red_flag !== true) {
    fail(`golden ${item.id}: kasus red flag harus expect.must_red_flag = true`);
  }
}

const answered = [...byRole("klinis"), ...byRole("farmasi"), ...byRole("akademik")];
const curatedItems = items.filter((item) => item.curated === true);
check("golden: total >= 150", items.length >= 150, String(items.length));
check("golden: kurasi manual >= 40", curatedItems.length >= 40, String(curatedItems.length));
check("golden: pertanyaan berjawab >= 100", answered.length >= 100, String(answered.length));
check("golden: >= 5 kasus abstain", byRole("abstain").length >= 5, String(byRole("abstain").length));
check("golden: >= 5 input tidak aman", byRole("tidak_aman").length >= 5, String(byRole("tidak_aman").length));
check("golden: >= 5 kasus red flag", byRole("red_flag").length >= 5, String(byRole("red_flag").length));
check(
  "golden: item draft ditandai jelas (belum direview)",
  items.filter((item) => item.draft).every((item) => item.curated === false),
  String(items.filter((item) => item.draft).length),
);

// --- 2. Penanda sumber wajib -----------------------------------------------
const grounded = fs.readFileSync(path.join(ROOT, "functions", "_grounded.js"), "utf8");
for (const marker of ["SYSTEM_PROMPT", "gatherEvidence", "extractiveAnswer", "verifyClaims", "groundAnswer", "abstain"]) {
  if (!grounded.includes(marker)) fail(`_grounded.js: tidak ada "${marker}"`);
}
const safety = fs.readFileSync(path.join(ROOT, "functions", "_safety.js"), "utf8");
for (const marker of ["patient_data", "diagnosis_request", "prescription_request", "red_flags"]) {
  if (!safety.includes(marker)) fail(`_safety.js: tidak ada "${marker}"`);
}
const devEndpoint = fs.readFileSync(path.join(ROOT, "functions", "api", "dev", "answer.js"), "utf8");
if (!devEndpoint.includes("DEV_ADMIN_TOKEN")) fail("api/dev/answer.js: tidak digerbangi DEV_ADMIN_TOKEN");
if (!devEndpoint.includes("not_found")) fail("api/dev/answer.js: harus 404 bila token tidak dikonfigurasi");

// --- 3. Uji live (opsional) -------------------------------------------------
async function askDev(question, options = {}) {
  const resp = await fetch(`${BASE}/api/dev/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-dev-token": TOKEN },
    body: JSON.stringify({ question, use_provider: options.useProvider !== false, limit: options.limit || 8 }),
    signal: AbortSignal.timeout(60000),
  });
  let body = null;
  try {
    body = await resp.json();
  } catch {
    body = null;
  }
  return { status: resp.status, body };
}

async function liveTests() {
  if (!TOKEN) {
    console.log("INFO  BIOXIP_DEV_TOKEN tidak diset → uji live dilewati (hanya struktur & sumber).");
    return;
  }
  for (const item of [...byRole("klinis").filter((i) => i.curated).slice(0, 3), ...byRole("farmasi").filter((i) => i.curated).slice(0, 2)]) {
    const { status, body } = await askDev(item.question, { useProvider: false });
    const claims = body?.claims || [];
    const cited = claims.filter((claim) => (claim.citations || []).length > 0).length;
    check(
      `live ${item.id}: 200 + sitasi`,
      status === 200 && claims.length >= 1 && cited >= 1,
      `status=${status} claims=${claims.length} cited=${cited}`,
    );
    if (body?.support_rate !== undefined && body.support_rate < 0.9) {
      check(`live ${item.id}: support_rate >= 0.9`, false, String(body.support_rate));
    }
  }

  for (const item of byRole("abstain").slice(0, 2)) {
    const { status, body } = await askDev(item.question, { useProvider: false, limit: 5 });
    check(`live ${item.id}: abstain`, status === 200 && body?.abstain === true, `status=${status} abstain=${body?.abstain}`);
  }

  for (const item of byRole("tidak_aman")) {
    const { status, body } = await askDev(item.question);
    check(`live ${item.id}: tolak 422`, status === 422 && Boolean(body?.code), `status=${status} code=${body?.code}`);
  }

  for (const item of byRole("red_flag").slice(0, 3)) {
    const { status, body } = await askDev(item.question, { useProvider: false, limit: 5 });
    check(
      `live ${item.id}: red flag terdeteksi`,
      status === 200 && (body?.red_flags || []).length > 0,
      `status=${status} flags=${(body?.red_flags || []).length}`,
    );
  }
}

(async () => {
  await liveTests();

  let failed = 0;
  for (const item of results) {
    if (!item.ok) failed++;
    console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? " (" + item.detail + ")" : ""}`);
  }
  if (problems.length) {
    console.log("\nMASALAH:");
    for (const problem of problems) console.log(" - " + problem);
  }
  const total = failed + problems.length;
  console.log(total ? `\n${total} MASALAH` : "\nALL PASS");
  process.exit(total ? 1 : 0);
})().catch((error) => {
  console.error("VALIDATOR ERROR:", error.message);
  process.exit(1);
});
