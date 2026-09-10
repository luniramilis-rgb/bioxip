import { expandQuery } from "../_dictionary.js";

const EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
const CT = "https://clinicaltrials.gov/api/v2/studies";
const TIMEOUT_MS = 12000;
const MAX_STUDIES = 20;

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const raw = (url.searchParams.get("q") || "").trim();
    if (!raw) return json({ error: "param q wajib" }, 400);

    const expanded = expandQuery(raw);
    const pico = parsePico(raw);
    const priority = "meta-analysis OR systematic review OR randomized controlled trial";

    const [preferred, general, trials] = await Promise.allSettled([
      fetchEpmc(`(${expanded}) AND (${priority})`, 20),
      fetchEpmc(`(${expanded})`, 20),
      fetchTrials(raw, 10),
    ]);

    let studies = [];
    const notes = [];
    if (preferred.status === "fulfilled") studies.push(...preferred.value);
    else notes.push("europepmc (prioritas) gagal");
    if (studies.length < 5 && general.status === "fulfilled") studies.push(...general.value);
    else if (general.status === "rejected") notes.push("europepmc gagal");
    if (trials.status === "fulfilled") studies.push(...trials.value);
    else notes.push("clinicaltrials gagal");

    studies = dedupe(studies);
    studies.sort(rankStudies);
    studies = studies.slice(0, MAX_STUDIES);

    studies.forEach((study, index) => {
      study.ref = index + 1;
    });

    const summary = buildExtractive(raw, pico, studies);

    return json({
      question: raw,
      pico,
      mode: "extractive",
      disclaimer:
        "Ringkasan bukti otomatis dari literatur publik; bukan nasihat medis dan bukan pengganti pertimbangan klinis.",
      stats: statsOf(studies),
      summary,
      studies,
      notes,
    });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}

function parsePico(raw) {
  const comparison = raw.split(/\s+(?:vs\.?|versus|dibanding(?:kan)?|compared (?:with|to))\s+/i);
  const terms = [];
  const expanded = expandQuery(raw)
    .replace(/[()]/g, " ")
    .split(/\s+OR\s+/i)
    .map((s) => s.replaceAll('"', "").trim())
    .filter((s) => s.length > 2);
  for (const term of expanded.slice(0, 6)) {
    if (!terms.includes(term)) terms.push(term);
  }
  return {
    question: raw,
    intervention: comparison[0]?.trim() || raw,
    comparison: comparison[1]?.trim() || null,
    terms,
  };
}

async function fetchEpmc(query, limit) {
  const params = new URLSearchParams({
    query,
    format: "json",
    resultType: "core",
    pageSize: String(limit),
  });
  const resp = await fetch(`${EPMC}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`europepmc ${resp.status}`);
  const data = await resp.json();
  return (data.resultList?.result || []).map(mapEpmc);
}

async function fetchTrials(query, limit) {
  const params = new URLSearchParams({
    "query.term": query,
    pageSize: String(limit),
  });
  const resp = await fetch(`${CT}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`clinicaltrials ${resp.status}`);
  const data = await resp.json();
  return (data.studies || []).map(mapTrial);
}

function mapEpmc(hit) {
  const types = hit.pubTypeList?.pubType || [];
  const studyType = classify(types, hit.source);
  return {
    id: `epmc|${hit.doi ? `doi:${hit.doi.toLowerCase()}` : hit.pmid ? `pmid:${hit.pmid}` : `epmc:${hit.source}:${hit.id}`}`,
    title: hit.title || "",
    abstract: clean(hit.abstractText || ""),
    authors: (hit.authorList?.author || []).map((a) => String(a.fullName || "").trim()).slice(0, 6),
    journal: hit.journalInfo?.journal?.title || null,
    year: Number(hit.pubYear) || null,
    url: `https://europepmc.org/article/${hit.source}/${hit.id}`,
    source: "europepmc",
    study_type: studyType,
    citation_count: Number(hit.citedByCount) || 0,
    oa: { is_oa: String(hit.isOpenAccess || "") === "Y" },
  };
}

function mapTrial(study) {
  const proto = study.protocolSection || {};
  const ident = proto.identificationModule || {};
  const design = proto.designModule || {};
  const cond = proto.conditionsModule || {};
  const posted = proto.statusModule?.studyFirstPostDateStruct?.date || null;
  return {
    id: `ct|${ident.nctId}`,
    title: ident.briefTitle || "",
    abstract: proto.descriptionModule?.briefSummary || "",
    authors: [],
    journal: null,
    year: posted ? Number(String(posted).slice(0, 4)) : null,
    url: `https://clinicaltrials.gov/study/${ident.nctId}`,
    source: "clinicaltrials",
    study_type: "Uji klinis (registri)",
    citation_count: 0,
    oa: { is_oa: false },
    conditions: cond.conditions || [],
    phase: design.phases || [],
  };
}

function classify(types, source) {
  const list = types.map((t) => String(t).toLowerCase());
  if (list.some((t) => t.includes("meta-analysis"))) return "Meta-analisis";
  if (list.some((t) => t.includes("systematic review"))) return "Systematic review";
  if (list.some((t) => t.includes("randomized"))) return "RCT";
  if (list.some((t) => t.includes("clinical trial") || t.includes("trial"))) return "Uji klinis";
  if (list.some((t) => t.includes("review"))) return "Review";
  if (source === "PPR" || list.some((t) => t.includes("preprint"))) return "Preprint";
  return "Studi";
}

function rankStudies(a, b) {
  const weight = { "Meta-analisis": 0, "Systematic review": 1, RCT: 2, "Uji klinis": 3, Review: 4, Preprint: 5, Studi: 6 };
  const wa = weight[a.study_type] ?? 7;
  const wb = weight[b.study_type] ?? 7;
  if (wa !== wb) return wa - wb;
  if (b.citation_count !== a.citation_count) return b.citation_count - a.citation_count;
  return (b.year || 0) - (a.year || 0);
}

function dedupe(studies) {
  const seen = new Map();
  for (const study of studies) {
    const key = normalizeTitle(study.title);
    if (!key || seen.has(key)) continue;
    seen.set(key, study);
  }
  return [...seen.values()];
}

function normalizeTitle(title) {
  return String(title || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

function buildExtractive(raw, pico, studies) {
  const phrases = pico.terms.map((t) => t.toLowerCase());
  const blocks = [];
  for (const study of studies) {
    const sentences = splitSentences(study.abstract);
    const scored = sentences
      .map((sentence) => ({ sentence, score: scoreSentence(sentence, phrases) }))
      .filter((item) => item.sentence.length >= 60 && item.score >= 3)
      .sort((a, b) => b.score - a.score);
    const isTrial = /uji klinis/i.test(study.study_type);
    const picked = scored.slice(0, isTrial ? 1 : 2);
    for (const item of picked) {
      blocks.push({ text: item.sentence, cites: [study.ref], study_type: study.study_type });
    }
    if (blocks.length >= 8) break;
  }

  if (!blocks.length) {
    for (const study of studies.slice(0, 4)) {
      blocks.push({
        text: `Studi terkait: ${study.title}`,
        cites: [study.ref],
        study_type: study.study_type,
      });
    }
  }

  const counts = statsOf(studies).by_type;
  const intro =
    `Tidak ada AI generatif yang dipakai di sini: ringkasan ini dikutip langsung dari kalimat ` +
    `abstrak ${studies.length} studi teratas (${formatCounts(counts)}). Setiap poin menautkan ke studinya.`;

  return { intro, blocks: blocks.slice(0, 8) };
}

const ADMIN_PATTERNS = [
  "follow-up",
  "will be",
  "end of study",
  "phone call",
  "consent",
  "inclusion criteria",
  "exclusion criteria",
  "eligible",
  "enrolled",
  "randomi[sz]ed to",
  "registered",
  "clinicaltrials.gov",
  "ethics committee",
  "written informed",
  "primary endpoint is",
  "this study aims",
  "we describe",
  "protocol",
];

function splitSentences(text) {
  return clean(text)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((s) => stripSectionLabel(s.trim()))
    .filter(Boolean);
}

function stripSectionLabel(sentence) {
  return sentence.replace(
    /^(introduction|methods?|results?|conclusions?|background|objectives?|discussion|findings|purpose|aims?|design|setting|participants?)\b[:.\-–—]?\s*/i,
    "",
  );
}

function scoreSentence(sentence, phrases) {
  const lower = sentence.toLowerCase();
  let score = 0;
  for (const phrase of phrases) {
    if (phrase && lower.includes(phrase)) score += 2;
  }
  const outcomes = ["effective", "efficacy", "significant", "reduced", "improved", "lower", "higher", "risk", "mortality", "safety", "outcome", "compared", "no difference", "non-inferior", "associated with", "results"];
  for (const word of outcomes) {
    if (lower.includes(word)) score += 1;
  }
  for (const pattern of ADMIN_PATTERNS) {
    if (new RegExp(pattern).test(lower)) score -= 3;
  }
  return score;
}

function statsOf(studies) {
  const by_type = {};
  let earliest = null;
  let latest = null;
  let oa = 0;
  for (const study of studies) {
    by_type[study.study_type] = (by_type[study.study_type] || 0) + 1;
    if (study.year) {
      earliest = earliest === null ? study.year : Math.min(earliest, study.year);
      latest = latest === null ? study.year : Math.max(latest, study.year);
    }
    if (study.oa?.is_oa) oa += 1;
  }
  return { total: studies.length, by_type, earliest, latest, open_access: oa };
}

function formatCounts(byType) {
  return Object.entries(byType)
    .map(([type, count]) => `${count} ${type.toLowerCase()}`)
    .join(", ");
}

function clean(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
