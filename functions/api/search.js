import { expandQuery, expandQueryEnglish } from "../_dictionary.js";
import { searchPubmed } from "../_pubmed.js";
import { detectQuestionType, epmcFilterFor, expansionClause, expansionSearchText, pubmedCategoryFor } from "../_terminology.js";
import { findDrugsInText } from "../_drugs.js";
import { rankResults } from "../_rank.js";
import { cacheGetJson, cacheKey, cachePutJson } from "../_cache.js";

const EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
const CT = "https://clinicaltrials.gov/api/v2/studies";
const TIMEOUT_MS = 10000;
const MAX_WANT = 500;
// Cache pencarian di edge: memotong latensi p95 dan melindungi rate limit sumber.
const SEARCH_CACHE_DEFAULT_TTL = 900;
const SEARCH_CACHE_NAMESPACE = "search:v3";

function searchCacheTtl(env) {
  const ttl = Number(env?.SEARCH_CACHE_TTL_SECONDS);
  return Number.isFinite(ttl) && ttl > 0 ? Math.min(ttl, 86400) : SEARCH_CACHE_DEFAULT_TTL;
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const useCache = url.searchParams.get("no_cache") !== "1";

  const key = cacheKey(SEARCH_CACHE_NAMESPACE, {
    q: url.searchParams.get("q") || "",
    types: url.searchParams.get("types") || "",
    oa: url.searchParams.get("oa") || "",
    indonesia: url.searchParams.get("indonesia") || "",
    page: url.searchParams.get("page") || "",
    per_page: url.searchParams.get("per_page") || "",
    sort: url.searchParams.get("sort") || "",
    abstract: url.searchParams.get("abstract") || "",
    clinical: url.searchParams.get("clinical") || "",
  });

  if (useCache) {
    try {
      const cached = await cacheGetJson(key);
      if (cached) return json({ ...cached, cache: "hit" }, 200);
    } catch {
      /* lanjut tanpa cache */
    }
  }

  const response = await produceSearch(env, request);
  if (response.status !== 200) return response;

  let body = null;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }

  // Jangan cache respons yang cacat/degraded: kegagalan sementara sumber (mis. PubMed
  // ter-throttle) tidak boleh membeku 15 menit bagi semua pengguna.
  const degraded = (body.notes || []).length > 0 || (body.results || []).length < 3;
  if (useCache && !degraded) {
    try {
      await cachePutJson(key, { ...body, cache: "miss" }, searchCacheTtl(env));
    } catch {
      /* penyimpanan cache best-effort */
    }
  }

  return json({ ...body, cache: useCache ? "miss" : "bypass" }, 200);
}

async function produceSearch(env, request) {
  try {
    const url = new URL(request.url);
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
    const withAbstract = url.searchParams.get("abstract") === "1" || url.searchParams.get("abstract") === "true";
    const clinical = url.searchParams.get("clinical") === "1";
    const questionType = detectQuestionType(raw);
    const clinicalFilter = clinical ? epmcFilterFor(questionType) : null;
    const pubmedCategory = clinical ? pubmedCategoryFor(questionType) : null;

    const query = expandQuery(raw);
    const extraClause = expansionClause(raw);
    // Nama obat Indonesia dalam kalimat (mis. "parasetamol dosis ginjal") → INN/nama Inggris.
    const drugs = findDrugsInText(raw, 2);
    const drugTerms = drugs.map((drug) => String(drug.inn).split("/")[0].trim()).filter(Boolean);
    const drugClause = drugTerms.length
      ? `(${drugTerms.map((term) => `("${term}" OR MESH:"${term}")`).join(" OR ")})`
      : "";
    const conceptClause = [extraClause, drugClause].filter(Boolean).join(" AND ");
    // Bila istilah Indonesia dikenali, pakai HANYA ekspansi Inggris+MeSH agar token
    // Indonesia (mis. "diagnosis"/"akurasi") tidak mendominasi hasil.
    const litQuery = conceptClause || query;
    const rankText = [expansionSearchText(raw), ...drugTerms].filter(Boolean).join(" ");
    const needLit = !types || types.some((t) => t === "paper" || t === "preprint");
    const needTrial = !types || types.includes("trial");
    const needPubmed = needLit && (!types || types.includes("paper"));


    const calls = [];
    if (needLit) {
      calls.push(
        fetchEpmc(litQuery, {
          oa,
          indonesia,
          types,
          sort,
          limit: perPage,
          cursor: epmcCursor,
          withAbstract,
          filter: clinicalFilter,
        }),
      );
    }
    if (needTrial) {
      calls.push(fetchTrials(litQuery, { oa, indonesia, types, sort, limit: perPage, token: ctToken, withAbstract }));
    }
    if (needPubmed) {
      const pubmedQuery = conceptClause || expandQueryEnglish(raw);
      calls.push(
        searchPubmed(pubmedQuery, { retmax: perPage, category: pubmedCategory, env }).then((data) => ({
          total: data.total,
          results: data.results,
          pagination: { pubmedHasMore: false },
          countsTowardTotal: false,
        })),
      );
    }

    const settled = await Promise.allSettled(calls.map((p) => withTimeout(p, TIMEOUT_MS)));

    const collected = [];
    let total = 0;
    const notes = [];
    const pagination = {};
    for (const item of settled) {
      if (item.status === "fulfilled") {
        collected.push(...item.value.results);
        if (item.value.countsTowardTotal !== false) total += item.value.total;
        Object.assign(pagination, item.value.pagination);
      } else {
        notes.push(item.reason instanceof Error ? item.reason.message : "sumber tidak merespons");
      }
    }

    let results = dedupeResults(collected);

    // Bila ekspansi AND terlalu sempit, longgarkan bertahap: filter klinis → ekspansi penuh.
    if (results.length < 5 && clinical) {
      const relaxed = await Promise.allSettled([
        fetchEpmc(litQuery, { oa, indonesia, types, sort, limit: perPage, cursor: epmcCursor, withAbstract }),
      ]);
      for (const item of relaxed) {
        if (item.status === "fulfilled") collected.push(...item.value.results);
      }
      results = dedupeResults(collected);
      notes.push("filter klinis dilonggarkan karena hasil sedikit");
    }

    if (results.length < 3 && conceptClause) {
      const fallback = await Promise.allSettled([
        fetchEpmc(query, { oa, indonesia, types, sort, limit: perPage, cursor: epmcCursor, withAbstract }),
      ]);
      for (const item of fallback) {
        if (item.status === "fulfilled") collected.push(...item.value.results);
      }
      results = dedupeResults(collected);
      notes.push("pencarian dilonggarkan (istilah Inggris terlalu spesifik)");
    }

    results = rankResults(results, rankText, sort);

    // Jaga keberagaman sumber: bila PubMed diminta tetapi tergusur dari halaman,
    // sisipkan hasil PubMed terbaik agar pengguna tetap melihat cakupan sumber.
    if (needPubmed && results.length > 3) {
      const page = results.slice(0, perPage);
      if (!page.some((row) => row.source === "pubmed")) {
        const pubmedRow = results.find((row) => row.source === "pubmed");
        if (pubmedRow) {
          const insertAt = Math.max(0, page.length - 2);
          results.splice(results.indexOf(pubmedRow), 1);
          results.splice(insertAt, 0, pubmedRow);
        }
      }
    }

    const paged = results.slice(0, perPage);

    // Sembunyikan abstrak dari respons kecuali diminta eksplisit (abstrak hanya untuk skoring/grounded).
    if (!withAbstract) {
      for (const row of paged) delete row.abstract;
    }

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
  const base = epmcQuery(query, filters);
  const effectiveQuery = filters.filter ? `(${base}) AND ${filters.filter}` : base;
  const params = new URLSearchParams({
    query: effectiveQuery,
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
    results: hits.map((hit) => mapEpmcHit(hit, filters.withAbstract)),
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
    results: studies.map((study) => mapTrial(study, filters.withAbstract)),
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

function cleanText(value, limit = 0) {
  const text = String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!limit || text.length <= limit) return text;
  return text.slice(0, limit).replace(/\s+\S*$/, "") + "…";
}

function mapEpmcHit(hit, withAbstract = false) {
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
  const row = {
    id: `epmc|${identity}`,
    doc_type: isPreprint ? "preprint" : "paper",
    title: cleanText(hit.title),
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
  // Abstrak selalu diambil (dipakai skoring & grounded); dibuang dari respons bila tidak diminta.
  row.abstract = cleanText(hit.abstractText, 900);
  return row;
}

function mapTrial(study, withAbstract = false) {
  const proto = study.protocolSection || {};
  const ident = proto.identificationModule || {};
  const status = proto.statusModule || {};
  const design = proto.designModule || {};
  const cond = proto.conditionsModule || {};
  const posted = status.studyFirstPostDateStruct?.date || null;
  const phase = design.phases || [];
  const row = {
    id: `ct|${ident.nctId}`,
    doc_type: "trial",
    title: cleanText(ident.briefTitle),
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
  // Abstrak selalu diambil untuk skoring; dibuang dari respons bila tidak diminta.
  row.abstract = cleanText(proto.descriptionModule?.briefSummary, 900);
  return row;
}

const SOURCE_PRIORITY = { europepmc: 0, pubmed: 1, clinicaltrials: 2 };

function dedupeResults(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = resultKey(row);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, row);
      continue;
    }
    const current = SOURCE_PRIORITY[existing.source] ?? 9;
    const candidate = SOURCE_PRIORITY[row.source] ?? 9;
    if (candidate < current) map.set(key, row);
  }
  return [...map.values()];
}

function resultKey(row) {
  const doi = row.doi && String(row.doi).toLowerCase();
  if (doi) return `doi:${doi}`;
  const pmid = row.external_ids?.pmid;
  if (pmid) return `pmid:${pmid}`;
  return `id:${row.id}`;
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
