const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "functions", "_provider.js"), "utf8");

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

function loadProvider(fetchImpl) {
  let source = SRC.replace(/^import\s+.*?;\s*$/gm, "").replace(/export /g, "");
  source += "\nglobalThis.__p = { extractJson, callDeepseek, shouldRetryStream, providerConfig, providerReady };\n";
  const sandbox = {
    console,
    fetch: fetchImpl,
    AbortSignal,
    JSON,
    String,
    Number,
    Boolean,
    Object,
    Array,
    Promise,
    Math,
    setTimeout,
    URL,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "_provider.js" });
  return sandbox.__p;
}

const noFetch = async () => {
  throw new Error("fetch tidak seharusnya dipanggil");
};

// --- extractJson -----------------------------------------------------------
{
  const p = loadProvider(noFetch);
  check("json: objek langsung", p.extractJson('{"answer":"ok"}')?.answer === "ok");
  check("json: dibungkus ```json", p.extractJson('```json\n{"answer":"fence"}\n```')?.answer === "fence");
  check("json: ada teks pembuka", p.extractJson('Berikut jawabannya:\n{"answer":"prefiks"}')?.answer === "prefiks");
  check("json: teks penutup", p.extractJson('{"answer":"sufiks"}\nSemoga membantu')?.answer === "sufiks");
  check("json: bukan objek → null", p.extractJson("[1,2,3]") === null);
  check("json: kosong → null", p.extractJson("") === null);
  check("json: prosa tanpa JSON → null", p.extractJson("Tidak ada JSON di sini") === null);
  check("json: terpotong → null", p.extractJson('{"answer":"terpotong') === null);
}

function completion(content, { finish = "stop", model = "deepseek-flash" } = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      model,
      choices: [{ message: { content }, finish_reason: finish }],
      usage: { prompt_tokens: 1200, completion_tokens: 300, prompt_cache_hit_tokens: 800, prompt_cache_miss_tokens: 400 },
    }),
    text: async () => JSON.stringify({ model }),
  };
}

async function main() {
  // --- percobaan 1 berhasil (mode JSON) -----------------------------------
  {
    let calls = 0;
    const p = loadProvider(async () => {
      calls += 1;
      return completion('{"answer":"A","claims":[{"text":"x","citations":[1]}],"abstain":false}');
    });
    const out = await p.callDeepseek({ DEEPSEEK_API_KEY: "k" }, { system: "s", user: "u", maxTokens: 512 });
    check("provider: sukses percobaan pertama", out.ok && out.parsed?.answer === "A", JSON.stringify(out.parsed));
    check("provider: hanya 1 panggilan", calls === 1, String(calls));
    check("provider: usage diteruskan", out.usage.input_tokens === 1200 && out.usage.cache_hit_tokens === 800, JSON.stringify(out.usage));
  }

  // --- percobaan 1 gagal parse → retry tanpa json mode -------------------
  {
    let calls = 0;
    const p = loadProvider(async (_url, init) => {
      calls += 1;
      const hasJsonMode = String(init.body).includes("response_format");
      return hasJsonMode
        ? completion("Tentu! Berikut jawabannya (bukan JSON).")
        : completion('{"answer":"B","claims":[],"abstain":true}');
    });
    const out = await p.callDeepseek({ DEEPSEEK_API_KEY: "k" }, { system: "s", user: "u", maxTokens: 512 });
    check("provider: retry saat parse gagal", calls === 2, String(calls));
    check("provider: hasil retry dipakai", out.parsed?.answer === "B", JSON.stringify(out.parsed));
    check("provider: mode json dicatat", out.json_mode === false, String(out.json_mode));
  }

  // --- terpotong (finish_reason=length) → retry dengan anggaran token lebih besar
  {
    const budgets = [];
    const p = loadProvider(async (_url, init) => {
      budgets.push(JSON.parse(init.body).max_tokens);
      return completion('{"answer":"terpotong', { finish: "length" });
    });
    const out = await p.callDeepseek({ DEEPSEEK_API_KEY: "k" }, { system: "s", user: "u", maxTokens: 512 });
    check("provider: terpotong → retry token lebih besar", budgets.length > 1, budgets.join("→"));
    check("provider: progres anggaran token", budgets[0] === 512 && budgets.includes(1024), budgets.join("→"));
    check("provider: dibatasi cap 4096", Math.max(...budgets) === 4096, String(Math.max(...budgets)));
    check("provider: ditandai parse_failed", out.ok && out.parsed === null && out.parse_failed === true, JSON.stringify({ pf: out.parse_failed }));
    check("provider: usage tetap tercatat saat parse gagal", out.usage.output_tokens === 300, String(out.usage.output_tokens));
  }

  // --- keputusan retry streaming (anti-fallback ekstraktif) ---------------
  {
    const p = loadProvider(noFetch);
    check("retry: finish_reason=length + anggaran < cap → ulangi", p.shouldRetryStream("length", 2048, 4096) === true);
    check("retry: finish_reason null → ulangi", p.shouldRetryStream(null, 2048, 4096) === true);
    check("retry: finish_reason=stop → jangan ulangi", p.shouldRetryStream("stop", 2048, 4096) === false);
    check("retry: anggaran sudah cap → jangan ulangi", p.shouldRetryStream("length", 4096, 4096) === false);
  }

  // --- HTTP error tidak di-retry ----------------------------------------
  {
    let calls = 0;
    const p = loadProvider(async () => {
      calls += 1;
      return { ok: false, status: 400, text: async () => '{"error":"bad model"}' };
    });
    const out = await p.callDeepseek({ DEEPSEEK_API_KEY: "k" }, { system: "s", user: "u" });
    check("provider: HTTP 400 → dilaporkan", out.ok === false && out.error === "provider_http_400", String(out.error));
    check("provider: HTTP error tidak di-retry", calls === 1, String(calls));
  }

  // --- tanpa key ---------------------------------------------------------
  {
    const p = loadProvider(noFetch);
    const out = await p.callDeepseek({}, { system: "s", user: "u" });
    check("provider: tanpa key → not_configured", out.ok === false && out.error === "provider_not_configured", String(out.error));
    check("provider: default model = deepseek-flash", p.providerConfig({}).model === "deepseek-flash", p.providerConfig({}).model);
  }

  let failed = 0;
  for (const item of results) {
    if (!item.ok) failed++;
    console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? " (" + item.detail + ")" : ""}`);
  }
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error("PROVIDER TEST ERROR:", error.message);
  process.exit(1);
});
