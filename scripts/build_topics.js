const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const WEB = path.join(ROOT, "web");
const SITE = (process.env.SITE_URL || "https://bioxip.pages.dev").replace(/\/$/, "");
const DATA = path.join(WEB, "data", "topics.json");
const CHECK = process.argv.includes("--check");

const topicsFile = JSON.parse(fs.readFileSync(DATA, "utf8"));
const topics = topicsFile.topics;

const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const STYLE = `
:root{--ink:#1b2733;--muted:#5c6b7a;--line:#e3e8ee;--accent:#0a7a63;--chip:#eef3f6;--bg:#fff}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:17px;line-height:1.65;color:var(--ink);background:var(--bg)}
header{border-bottom:1px solid var(--line);padding:.9rem 1.1rem;display:flex;gap:1rem;align-items:center;justify-content:space-between;position:sticky;top:0;background:var(--bg);z-index:5}
.brand{font-weight:800;font-size:1.2rem;text-decoration:none;color:var(--ink)}
.brand span{color:var(--accent)}
nav a{color:var(--ink);text-decoration:none;margin-left:1rem;font-size:.95rem}
main{max-width:760px;margin:0 auto;padding:1.4rem 1.1rem 3rem}
h1{font-size:1.6rem;line-height:1.25;margin:.2rem 0 .6rem}
h2{font-size:1.15rem;margin:1.8rem 0 .5rem}
.muted{color:var(--muted)}
.chip{display:inline-block;padding:.15rem .6rem;border-radius:999px;background:var(--chip);font-size:.78rem;text-transform:uppercase;letter-spacing:.02em;margin-right:.3rem}
ul{padding-left:1.15rem}
li{margin:.35rem 0}
a.btn{display:inline-block;min-height:46px;line-height:46px;padding:0 1.1rem;border-radius:11px;background:var(--accent);color:#fff;text-decoration:none;font-weight:600}
.card{border:1px solid var(--line);border-radius:13px;padding:1rem 1.1rem;margin:1rem 0}
.grid{display:grid;grid-template-columns:1fr;gap:.7rem}
@media(min-width:700px){.grid{grid-template-columns:1fr 1fr}}
a.topic{display:block;border:1px solid var(--line);border-radius:12px;padding:.85rem 1rem;text-decoration:none;color:var(--ink)}
a.topic small{display:block;color:var(--muted);margin-top:.2rem}
footer{border-top:1px solid var(--line);padding:1.4rem 1.1rem;color:var(--muted);font-size:.9rem;text-align:center}
.copy{display:inline-block;min-height:44px;padding:.5rem 1rem;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink);font-size:.95rem;cursor:pointer}
.toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(8px);background:#10231d;color:#fff;padding:.6rem 1rem;border-radius:10px;opacity:0;pointer-events:none;transition:.2s}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
`;

function head({ title, description, canonical, image, jsonLd }) {
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${esc(canonical)}" />
<link rel="icon" href="/icons/icon-192.png" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="bioXip" />
<meta property="og:locale" content="id_ID" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(canonical)}" />
<meta property="og:image" content="${esc(image)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${esc(image)}" />
<meta name="theme-color" content="#0a7a63" />
<link rel="stylesheet" href="data:text/css;base64,${Buffer.from(STYLE).toString("base64")}" />
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
<header>
  <a class="brand" href="/">bio<span>Xip</span></a>
  <nav>
    <a href="/">Beranda</a>
    <a href="/#/search">Cari</a>
    <a href="/topik/">Topik</a>
  </nav>
</header>`;
}

function foot() {
  return `<footer>
  <p><strong>bioXip</strong> — literatur dunia untuk peneliti &amp; tenaga kesehatan Indonesia.</p>
  <p>Sumber data: Europe PMC, PubMed, ClinicalTrials.gov, PubChem, ChEMBL, Open Targets, Fornas.</p>
  <p class="muted">Halaman ini bersifat informasi &amp; edukasi; bukan nasihat medis dan bukan pengganti pertimbangan klinis.</p>
  <p><button class="copy" data-copy-url>Salin tautan halaman ini</button></p>
</footer>
<div class="toast" id="toast">Tautan disalin</div>
<script>
document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy-url]");
  if (!button) return;
  try {
    await navigator.clipboard.writeText(location.href);
  } catch (error) {
    const area = document.createElement("textarea");
    area.value = location.href;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  const toast = document.getElementById("toast");
  if (toast) {
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1800);
  }
});
</script>
</body>
</html>`;
}

function breadcrumb(items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

function topicPage(topic) {
  const canonical = `${SITE}/topik/${topic.slug}/`;
  const image = `${SITE}/og/topic-${topic.slug}.png`;
  const title = `${topic.label} — bukti, sumber, dan pertanyaan | bioXip`;
  const description = topic.desc;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "MedicalWebPage",
    name: topic.label,
    inLanguage: "id",
    description,
    url: canonical,
    isPartOf: { "@type": "WebSite", name: "bioXip", url: SITE },
    about: { "@type": "MedicalCondition", name: topic.label },
    significantLink: topic.sources.map((source) => source.url),
  };

  const others = topics
    .filter((item) => item.slug !== topic.slug)
    .map(
      (item) =>
        `<a class="topic" href="/topik/${item.slug}/">${esc(item.label)}<small>${esc(item.desc)}</small></a>`
    )
    .join("\n");

  return `${head({ title, description, canonical, image, jsonLd })}
<main>
  <span class="chip">Topik</span>
  <h1>${esc(topic.label)}</h1>
  <p class="muted">${esc(topic.desc)}</p>
  <p>${esc(topic.intro)}</p>

  <div class="card">
    <a class="btn" href="/#/search?q=${encodeURIComponent(topic.query)}">Cari literatur topik ini</a>
    <p class="muted" style="margin:.6rem 0 0">Pencarian gratis. Masuk untuk hasil lengkap &amp; jawaban AI.</p>
  </div>

  <h2>Poin bukti utama</h2>
  <ul>
    ${topic.points.map((point) => `<li>${esc(point)}</li>`).join("\n    ")}
  </ul>

  <h2>Contoh pertanyaan klinis</h2>
  <ul>
    ${topic.questions
      .map(
        (question) =>
          `<li><a href="/#/search?q=${encodeURIComponent(question)}">${esc(question)}</a></li>`
      )
      .join("\n    ")}
  </ul>

  <h2>Sumber resmi</h2>
  <ul>
    ${topic.sources
      .map(
        (source) =>
          `<li><a href="${esc(source.url)}" target="_blank" rel="noopener">${esc(source.name)}</a></li>`
      )
      .join("\n    ")}
  </ul>

  <h2>Topik lain</h2>
  <div class="grid">
${others}
  </div>
</main>
${foot()}`;
}

function hubPage() {
  const canonical = `${SITE}/topik/`;
  const image = `${SITE}/og/bioxip-og.png`;
  const title = "Topik kesehatan berbasis bukti | bioXip";
  const description =
    "Kumpulan topik prioritas kesehatan Indonesia dengan poin bukti utama, contoh pertanyaan klinis, dan tautan sumber resmi.";
  const jsonLd = breadcrumb([
    { name: "bioXip", url: `${SITE}/` },
    { name: "Topik", url: canonical },
  ]);
  const cards = topics
    .map(
      (topic) =>
        `<a class="topic" href="/topik/${topic.slug}/">${esc(topic.label)}<small>${esc(topic.desc)}</small></a>`
    )
    .join("\n");

  return `${head({ title, description, canonical, image, jsonLd })}
<main>
  <h1>Topik kesehatan prioritas Indonesia</h1>
  <p class="muted">Setiap topik memuat poin bukti utama, contoh pertanyaan klinis, dan tautan sumber resmi. Semua pencarian literatur gratis.</p>
  <div class="grid">
${cards}
  </div>
  <div class="card">
    <a class="btn" href="/#/search">Mulai mencari literatur</a>
  </div>
</main>
${foot()}`;
}

function writeOrCheck(file, content) {
  const exists = fs.existsSync(file);
  const current = exists ? fs.readFileSync(file, "utf8") : null;
  if (current === content) return { file, status: "unchanged" };
  if (CHECK) return { file, status: "stale" };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
  return { file, status: exists ? "updated" : "created" };
}

const results = [writeOrCheck(path.join(WEB, "topik", "index.html"), hubPage())];
for (const topic of topics) {
  results.push(writeOrCheck(path.join(WEB, "topik", topic.slug, "index.html"), topicPage(topic)));
}

const stale = results.filter((item) => item.status === "stale");
for (const item of results) {
  console.log(`${item.status.padEnd(9)} ${path.relative(ROOT, item.file)}`);
}
if (CHECK && stale.length) {
  console.error(`\n${stale.length} halaman topik belum diperbarui — jalankan: node scripts/build_topics.js`);
  process.exit(1);
}
console.log(`\nOK: ${results.length} halaman topik (${topics.length} topik + hub)`);
