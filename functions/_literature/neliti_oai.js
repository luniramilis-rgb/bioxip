/**
 * Neliti OAI-PMH — HARVEST metadata (bukan pencarian per-query).
 * OAI tidak mendukung kata kunci; karena itu adapter ini dipakai untuk batch
 * harvest ke indeks lokal, bukan di fan-out pencarian live.
 */
export const OAI_BASE = "https://www.neliti.com/oai";

export function buildOaiUrl({ base = OAI_BASE, set, from, until, resumptionToken, metadataPrefix = "oai_dc" } = {}) {
  const params = new URLSearchParams();
  if (resumptionToken) {
    params.set("verb", "ListRecords");
    params.set("resumptionToken", resumptionToken);
    return `${base}?${params}`;
  }
  params.set("verb", "ListRecords");
  params.set("metadataPrefix", metadataPrefix);
  if (set) params.set("set", set);
  if (from) params.set("from", from);
  if (until) params.set("until", until);
  return `${base}?${params}`;
}

function decode(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block, name) {
  const match = block.match(new RegExp(`<dc:${name}[^>]*>([\\s\\S]*?)</dc:${name}>`, "i"));
  return match ? decode(match[1]) : null;
}

function tagAll(block, name) {
  const out = [];
  const re = new RegExp(`<dc:${name}[^>]*>([\\s\\S]*?)</dc:${name}>`, "gi");
  let match;
  while ((match = re.exec(block))) out.push(decode(match[1]));
  return out;
}

/** Parse respons ListRecords (oai_dc) → record ternormalisasi + resumptionToken. */
export function parseOaiDc(xml) {
  const records = [];
  const blocks = String(xml || "").match(/<record>[\s\S]*?<\/record>/gi) || [];
  for (const block of blocks) {
    const identifier = tag(block, "identifier");
    const title = tag(block, "title");
    if (!title || !identifier) continue;
    const date = tag(block, "date");
    const rights = tag(block, "rights");
    records.push({
      id: `neliti|${identifier}`,
      doc_type: "paper",
      title,
      authors: tagAll(block, "creator").map((name) => ({ given: name, family: "" })),
      journal: tag(block, "source"),
      year: date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null,
      published_on: date || null,
      doi: /^10\./.test(identifier) ? identifier : null,
      url: /^https?:\/\//.test(identifier) ? identifier : null,
      source: "neliti",
      oa: { is_oa: true, license: rights || null, provider: "neliti" },
      citation_count: 0,
      external_ids: {},
      abstract: tag(block, "description"),
    });
  }
  const token = String(xml || "").match(/<resumptionToken[^>]*>([\s\S]*?)<\/resumptionToken>/i);
  return { records, resumptionToken: token ? decode(token[1]) || null : null };
}

export async function harvestNeliti(options = {}) {
  const resp = await fetch(buildOaiUrl(options), {
    signal: AbortSignal.timeout(15000),
    headers: { accept: "application/xml", "user-agent": "bioXip/0.1" },
  });
  if (!resp.ok) throw new Error(`neliti-oai ${resp.status}`);
  return parseOaiDc(await resp.text());
}
