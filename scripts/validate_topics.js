const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const WEB = path.join(ROOT, "web");
const dataFile = path.join(WEB, "data", "topics.json");
const problems = [];

const { topics } = JSON.parse(fs.readFileSync(dataFile, "utf8"));

if (!Array.isArray(topics) || topics.length < 10) problems.push("minimal 10 topik");
const slugs = new Set();

for (const topic of topics) {
  const tag = topic.slug || "(tanpa slug)";
  if (!topic.slug || !topic.label || !topic.query || !topic.desc) problems.push(`${tag}: slug/label/query/desc wajib`);
  if (!topic.intro || topic.intro.length < 60) problems.push(`${tag}: intro terlalu pendek`);
  if (!Array.isArray(topic.points) || topic.points.length < 3) problems.push(`${tag}: minimal 3 poin bukti`);
  if (!Array.isArray(topic.questions) || topic.questions.length < 3) problems.push(`${tag}: minimal 3 contoh pertanyaan`);
  if (!Array.isArray(topic.sources) || topic.sources.length < 2) problems.push(`${tag}: minimal 2 sumber resmi`);
  for (const source of topic.sources || []) {
    if (!/^https:\/\//.test(source.url || "")) problems.push(`${tag}: sumber harus https (${source.url})`);
  }
  if (slugs.has(topic.slug)) problems.push(`${tag}: slug duplikat`);
  slugs.add(topic.slug);
}

const requiredFiles = [
  path.join(WEB, "topik", "index.html"),
  ...topics.map((topic) => path.join(WEB, "topik", topic.slug, "index.html")),
];

const cssFile = path.join(WEB, "css", "topik.css");
if (!fs.existsSync(cssFile)) problems.push("file hilang: web/css/topik.css");
const topicsJs = path.join(WEB, "js", "topics.js");
if (!fs.existsSync(topicsJs)) {
  problems.push("file hilang: web/js/topics.js");
} else {
  const js = fs.readFileSync(topicsJs, "utf8");
  for (const topic of topics) {
    if (!js.includes(`"${topic.slug}"`)) problems.push(`web/js/topics.js: slug ${topic.slug} tidak ada (jalankan build)`);
  }
}

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) {
    problems.push(`file hilang: ${path.relative(ROOT, file)}`);
    continue;
  }
  const html = fs.readFileSync(file, "utf8");
  const relative = path.relative(ROOT, file);
  for (const needle of ['<link rel="canonical"', 'property="og:title"', 'property="og:image"', "application/ld+json", 'name="description"']) {
    if (!html.includes(needle)) problems.push(`${relative}: tidak ada ${needle}`);
  }
  if (!html.includes("bukan nasihat medis")) problems.push(`${relative}: disclaimer hilang`);
  if (!html.includes("data-copy-url")) problems.push(`${relative}: tombol salin tautan hilang`);
  if (!/<h1[^>]*>[^<]+<\/h1>/.test(html)) problems.push(`${relative}: h1 hilang`);
}

const ogFiles = [
  path.join(WEB, "og", "bioxip-og.png"),
  ...topics.map((topic) => path.join(WEB, "og", `topic-${topic.slug}.png`)),
];
for (const file of ogFiles) {
  if (!fs.existsSync(file)) problems.push(`gambar OG hilang: ${path.relative(ROOT, file)}`);
}

console.log(`Topik: ${topics.length} · halaman: ${requiredFiles.length} · gambar OG: ${ogFiles.length}`);
if (problems.length) {
  console.log("\nMASALAH:");
  for (const problem of problems) console.log(" - " + problem);
  process.exit(1);
}
console.log("VALID: data topik, halaman statis (meta/JSON-LD/disclaimer/salin tautan), gambar OG");
