import { studyTypeWeight } from "./_terminology.js";

const SECTION_HINTS = [
  /(results?|findings?|hasil)/i,
  /(conclusions?|kesimpulan)/i,
  /(outcomes?|luaran)/i,
];

const NOISE = [
  /^(background|introduction|latar belakang|pendahuluan)\b/i,
  /^(methods?|metode|materials? and methods?)\b/i,
  /^(objective|aim|tujuan|purpose)\b/i,
];

export function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 3)
    .slice(0, 24);
}

export function relevanceScore(row, tokens) {
  if (!tokens.length) return 0;
  const title = String(row.title || "").toLowerCase();
  const abstract = String(row.abstract || "").toLowerCase();
  let titleHits = 0;
  let abstractHits = 0;
  for (const token of tokens) {
    if (title.includes(token)) titleHits += 1;
    else if (abstract.includes(token)) abstractHits += 1;
  }
  const coverage = (titleHits * 1.5 + abstractHits) / tokens.length;
  return Math.min(1, coverage);
}

export function rankScore(row, tokens, now = Date.now()) {
  const relevance = relevanceScore(row, tokens);
  const published = row.published_on ? Date.parse(row.published_on) : null;
  const ageYears = published ? (now - published) / (365.25 * 24 * 3600 * 1000) : 5;
  const recency = Math.max(0, 1 - ageYears / 10);
  const quality = studyTypeWeight(row.doc_type);
  const authority = Math.min(1, Math.log10((Number(row.citation_count) || 0) + 1) / 3);
  const oa = row.oa?.is_oa ? 1 : 0;
  return 0.42 * relevance + 0.2 * recency + 0.18 * quality + 0.14 * authority + 0.06 * oa;
}

export function rankResults(rows, query, sort = "relevance") {
  const tokens = tokenize(query);
  const scored = rows.map((row) => ({ row, score: rankScore(row, tokens) }));
  if (sort === "date") {
    scored.sort((a, b) => String(b.row.published_on || "").localeCompare(String(a.row.published_on || "")));
  } else if (sort === "citations") {
    scored.sort((a, b) => (b.row.citation_count || 0) - (a.row.citation_count || 0));
  } else {
    scored.sort((a, b) => b.score - a.score);
  }
  return scored.map((entry) => entry.row);
}

export function splitSentences(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 50);
}

/**
 * Pilih potongan abstrak yang paling informatif:
 * utamakan kalimat pada bagian Results/Conclusion dan yang memuat istilah pertanyaan.
 */
export function sectionSnippet(abstract, query, limit = 2) {
  const sentences = splitSentences(abstract);
  if (!sentences.length) return "";
  const tokens = tokenize(query);
  const scored = sentences.map((sentence, index) => {
    const lower = sentence.toLowerCase();
    let score = 0;
    for (const token of tokens) if (lower.includes(token)) score += 1;
    if (SECTION_HINTS.some((pattern) => pattern.test(sentence))) score += 2;
    if (NOISE.some((pattern) => pattern.test(sentence))) score -= 2;
    // Kalimat belakangan pada abstrak umumnya berisi hasil/kesimpulan.
    score += (index / Math.max(1, sentences.length - 1)) * 1.5;
    if (/\b(significan|reduc|improv|increas|associat|effective|efficacy|no difference|non-inferior)\w*/i.test(sentence)) {
      score += 1;
    }
    return { sentence, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored
    .slice(0, limit)
    .map((entry) => entry.sentence)
    .join(" ")
    .slice(0, 700);
}
