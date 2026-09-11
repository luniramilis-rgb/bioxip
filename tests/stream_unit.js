const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

function loadGrounded() {
  let source = fs.readFileSync(path.join(ROOT, "functions", "_grounded.js"), "utf8");
  source = source.replace(/^import\s+.*?;\s*$/gm, "").replace(/export /g, "");
  source += "\nglobalThis.__g = { extractAnswerText, AnswerExtractor };\n";
  const sandbox = { console, JSON, String, Number, Boolean, Object, Array, Math, RegExp };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "_grounded.js" });
  return sandbox.__g;
}

function loadProvider() {
  let source = fs.readFileSync(path.join(ROOT, "functions", "_provider.js"), "utf8");
  source = source.replace(/^import\s+.*?;\s*$/gm, "").replace(/export /g, "");
  source += "\nglobalThis.__p = { parseOpenAiSse };\n";
  const sandbox = { console, JSON, String, Number, Boolean, Object, Array, Math, TextDecoder, Promise };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "_provider.js" });
  return sandbox.__p;
}

const { extractAnswerText, AnswerExtractor } = loadGrounded();
const { parseOpenAiSse } = loadProvider();

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

// --- extractAnswerText -----------------------------------------------------
check("extract: belum ada kunci → null", extractAnswerText('{"cla') === null);
check(
  "extract: nilai lengkap",
  extractAnswerText('{"answer":"Halo dunia"}')?.value === "Halo dunia",
  JSON.stringify(extractAnswerText('{"answer":"Halo dunia"}')),
);
check("extract: ditandai closed", extractAnswerText('{"answer":"x"}')?.closed === true);
check("extract: belum tertutup", extractAnswerText('{"answer":"belum')?.closed === false);
check("extract: escape kutip", extractAnswerText('{"answer":"a\\"b"}')?.value === 'a"b');
check("extract: escape newline", extractAnswerText('{"answer":"a\\nb"}')?.value === "a\nb");
check("extract: escape unicode", extractAnswerText('{"answer":"\\u00e9"}')?.value === "é");
check("extract: escape belum lengkap ditahan", extractAnswerText('{"answer":"a\\')?.value === "a");
check("extract: kunci muncul setelah field lain", extractAnswerText('{"claims":[],"answer":"kedua"}')?.value === "kedua");

// --- AnswerExtractor: emisi bertahap ---------------------------------------
{
  const extractor = new AnswerExtractor();
  const pieces = [];
  const full = '{"answer":"Efek samping umumnya ringan.","claims":[{"text":"a","citations":[1]}],"abstain":false}';
  // potong per 3 karakter untuk mensimulasikan token streaming
  for (let i = 0; i < full.length; i += 3) pieces.push(extractor.push(full.slice(i, i + 3)));
  const joined = pieces.join("");
  check("extractor: hasil gabungan = teks jawaban", joined === "Efek samping umumnya ringan.", JSON.stringify(joined));
  check("extractor: tanpa pengulangan", pieces.every((p, i) => i === 0 || p.length >= 0) && joined.length === 28, String(joined.length));
  check("extractor: selesai saat string tertutup", extractor.finished === true);
  check("extractor: answer akhir benar", extractor.answer === "Efek samping umumnya ringan.");
}

// --- AnswerExtractor: karakter multibyte & escape --------------------------
{
  const extractor = new AnswerExtractor();
  const full = '{"answer":"Na\\u00efve — 40% menurun","claims":[],"abstain":false}';
  let out = "";
  for (const char of full) out += extractor.push(char);
  check("extractor: unicode & em dash", out === "Naïve — 40% menurun", JSON.stringify(out));
}

// --- AnswerExtractor: JSON tanpa field answer ------------------------------
{
  const extractor = new AnswerExtractor();
  extractor.push('{"claims":[{"text":"x","citations":[1]}]}');
  check("extractor: tanpa field answer → kosong", extractor.answer === "" && extractor.finished === false);
}

// --- parseOpenAiSse --------------------------------------------------------
async function sseTest() {
  const chunks = [
    'data: {"choices":[{"delta":{"content":"Hal"}}]}\n\n',
    ': keep-alive\n\n',
    'data: {"choices":[{"delta":{"content":"o"}}]}\n',
    '\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\n',
    "data: [DONE]\n\n",
  ];
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });

  const events = [];
  for await (const event of parseOpenAiSse(stream)) events.push(event);
  const text = events.map((e) => e.choices?.[0]?.delta?.content || "").join("");
  check("sse: teks digabung dari delta", text === "Halo", JSON.stringify(text));
  check("sse: komentar keep-alive diabaikan", events.length === 3, String(events.length));
  check("sse: finish_reason terbaca", events.some((e) => e.choices?.[0]?.finish_reason === "stop"));
  check("sse: usage terbaca", events.some((e) => e.usage?.prompt_tokens === 10));
  check("sse: [DONE] mengakhiri stream", events.every((e) => e.choices || e.usage));
}

sseTest()
  .then(() => {
    let failed = 0;
    for (const item of results) {
      if (!item.ok) failed++;
      console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? " (" + item.detail + ")" : ""}`);
    }
    console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
    process.exit(failed ? 1 : 0);
  })
  .catch((error) => {
    console.error("STREAM TEST ERROR:", error.message);
    process.exit(1);
  });
