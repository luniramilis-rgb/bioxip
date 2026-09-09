import { expandQuery } from "../_dictionary.js";

const EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
const CT = "https://clinicaltrials.gov/api/v2/studies";
const TIMEOUT_MS = 10000;
const MAX_WANT = 500;

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const raw = (url.searchParams.get("q") || "").trim();
    if (!raw) return json({ error: "param q wajib" }, 400);

    const types = parseTypes(url.searchParams.get("types"));
    const oa = url.searchParams.get("oa") === "true";
    const indonesia = url.searchParams.get("indonesia") === "true";
    const page = clamp(Math.max(1, Number(url.searchParams.get("page")) || 1), 1, 5);
    const perPage = clamp(Number(url.searchParams.get("per_page")) || 20, 1, 100);
    const sort = ["relevance", "date", "citations"].includes(url.searchParams.get("sort"))
      ? url.searchParams.get("sort")
      : "relevance";
    const epmcCursor = url.searchParams.get("epmc_cursor") || "*";
    const ctToken = url.searchParams.get("ct_token") || null;

    const query = expandQuery(raw);
    const needLit = !types || types.some((t) => t === "paper" || t === "preprint");
    const needTrial = !types || types.includes("trial");

    const calls = [];
    if (needLit) {
      calls.push(fetchEpmc(query, { oa, indonesia, types, sort, limit: perPage, cursor: epmcCursor }));
    }
    if (needTrial) {
      calls.push(fetchTrials(query, { oa, indonesia, types, sort, limit: perPage, token: ctToken }));
    }

    const settled = await Promise.allSettled(calls.map((p) => withTimeout(p, TIMEOUT_MS)));

    const results = [];
    let total = 0;
    const notes = [];
    const pagination = {};
    for (const item of settled) {
      if (item.status === "fulfilled") {
        results.push(...item.value.results);
        total += item.value.total;
        Object.assign(pagination, item.value.pagination);
      } else {
        notes.push(item.reason instanceof Error ? item.reason.message : "sumber tidak merespons");
      }
    }

    results.sort(rankBy(sort));
    const paged = results.slice(0, perPage);

    return json({
      query: raw,
      total: Math.max(total, results.length),
      mode: "live",
      page,
      limit: perPage,
      notes,
      pagination,
      facets: facetsOf(paged),
      results: paged,
    });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}

async function fetchEpmc(query, filters) {
  const params = new URLSearchParams({
    query: epmcQuery(query, filters),
    format: "json",
    resultType: "core",
    pageSize: String(filters.limit),
    cursorMark: filters.cursor || "*",
  });
  if (filters.sort === "date") params.set("sort", "P_PDATE_D desc");
  const resp = await fetch(`${EPMC}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`europepmc ${resp.status}`);
  const data = await resp.json();
  const hits = data.resultList?.result || [];
  const nextCursor = data.nextCursorMark;
  const hasMore = hits.length === filters.limit && nextCursor && nextCursor !== filters.cursor;
  return {
    total: Number(data.hitCount || 0),
    results: hits.map(mapEpmcHit),
    pagination: {
      epmcCursor: hasMore ? nextCursor : null,
      epmcHasMore: Boolean(hasMore),
    },
  };
}

async function fetchTrials(query, filters) {
  const params = new URLSearchParams({
    "query.term": query,
    pageSize: String(filters.limit),
    countTotal: "true",
  });
  if (filters.token) params.set("pageToken", filters.token);
  const resp = await fetch(`${CT}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`clinicaltrials ${resp.status}`);
  const data = await resp.json();
  const studies = data.studies || [];
  const nextToken = data.nextPageToken || null;
  const hasMore = Boolean(nextToken);
  return {
    total: Number(data.totalCount || 0),
    results: studies.map(mapTrial),
    pagination: {
      ctToken: hasMore ? nextToken : null,
      ctHasMore: hasMore,
    },
  };
}

function epmcQuery(raw, filters) {
  let q = raw;
  if (filters.oa) q = `${q} AND OPEN_ACCESS:y`;
  if (filters.indonesia) q = `${q} AND AFF:"Indonesia"`;
  if (filters.types && !filters.types.includes("paper") && filters.types.includes("preprint")) {
    q = `${q} AND PUB_TYPE:"preprint"`;
  }
  if (filters.types && filters.types.includes("paper") && !filters.types.includes("preprint")) {
    q = `${q} AND PUB_TYPE:"journal article"`;
  }
  return q;
}

function mapEpmcHit(hit) {
  const isPreprint = hit.source === "PPR" || (hit.pubTypeList?.pubType || []).some((t) =>
    String(t).toLowerCase().includes("preprint"),
  );
  const authors = (hit.authorList?.author || []).map((a) => {
    const parts = String(a.fullName || "").trim().split(/\s+/);
    return { given: parts[0] || "", family: parts.slice(1).join(" ") };
  });
  const pdf = (hit.fullTextUrlList?.urls || []).find(
    (u) => String(u.documentStyle || "").toLowerCase() === "pdf",
  );
  const doi = hit.doi ? `doi:${hit.doi.toLowerCase()}` : null;
  const identity = doi || (hit.pmid ? `pmid:${hit.pmid}` : `epmc:${hit.source}:${hit.id}`);
  return {
    id: `epmc|${identity}`,
    doc_type: isPreprint ? "preprint" : "paper",
    title: hit.title || "",
    authors,
    journal: hit.journalInfo?.journal?.title || null,
    year: Number(hit.pubYear) || null,
    published_on: hit.firstPublicationDate || null,
    doi: hit.doi || null,
    url: `https://europepmc.org/article/${hit.source}/${hit.id}`,
    source: "europepmc",
    oa: { is_oa: String(hit.isOpenAccess || "") === "Y", pdf_url: pdf?.url || null, provider: "europepmc" },
    citation_count: Number(hit.citedByCount) || 0,
    external_ids: { pmid: hit.pmid || null, pmcid: hit.pmcid || null, doi: hit.doi || null },
  };
}

function mapTrial(study) {
  const proto = study.protocolSection || {};
  const ident = proto.identificationModule || {};
  const status = proto.statusModule || {};
  const design = proto.designModule || {};
  const cond = proto.conditionsModule || {};
  const posted = status.studyFirstPostDateStruct?.date || null;
  const phase = design.phases || [];
  return {
    id: `ct|${ident.nctId}`,
    doc_type: "trial",
    title: ident.briefTitle || "",
    authors: [],
    journal: null,
    year: posted ? Number(String(posted).slice(0, 4)) : null,
    published_on: posted,
    doi: null,
    url: `https://clinicaltrials.gov/study/${ident.nctId}`,
    source: "clinicaltrials",
    oa: { is_oa: false, provider: "clinicaltrials" },
    citation_count: 0,
    meta: { phase, status: status.overallStatus, conditions: cond.conditions || [], nct_id: ident.nctId },
    external_ids: { nctid: ident.nctId },
  };
}

function rankBy(sort) {
  if (sort === "date") {
    return (a, b) => String(b.published_on || "").localeCompare(String(a.published_on || ""));
  }
  if (sort === "citations") {
    return (a, b) => (b.citation_count || 0) - (a.citation_count || 0);
  }
  const order = { paper: 0, trial: 1, preprint: 2 };
  return (a, b) => {
    const ta = order[a.doc_type] ?? 3;
    const tb = order[b.doc_type] ?? 3;
    return ta - tb;
  };
}

function facetsOf(rows) {
  const type = {};
  const source = {};
  let oaCount = 0;
  for (const r of rows) {
    type[r.doc_type] = (type[r.doc_type] || 0) + 1;
    source[r.source] = (source[r.source] || 0) + 1;
    if (r.oa?.is_oa) oaCount++;
  }
  return { type, source, oa: oaCount };
}

function parseTypes(value) {
  if (!value) return null;
  const allowed = new Set(["paper", "preprint", "trial"]);
  const types = value.split(",").map((s) => s.trim()).filter((s) => allowed.has(s));
  return types.length ? types : null;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
