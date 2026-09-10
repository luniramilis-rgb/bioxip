import { chargedMicroIdr, costMicroIdr } from "./_pricing.js";
import { callDeepseek, providerReady } from "./_provider.js";
import { classifyInput, redFlagNotice } from "./_safety.js";
import { findDrug } from "./_drugs.js";

const MAX_EVIDENCE = 8;

export const SYSTEM_PROMPT = [
  "Anda asisten bukti biomedis bioXip untuk tenaga kesehatan Indonesia.",
  "ATURAN WAJIB:",
  "1. Jawab HANYA berdasarkan KONTEKS yang diberikan.",
  "2. Setiap klaim harus punya sitasi angka [n] yang menunjuk item konteks.",
  "3. Dilarang mengarang angka, dosis, nama obat, atau hasil studi.",
  "4. Bila konteks tidak cukup, set abstain=true dan jelaskan singkat.",
  "5. Bahasa Indonesia, ringkas, tanpa klaim diagnosis pasien atau perintah peresepan.",
  "6. Keluarkan JSON valid dengan skema:",
  '{"answer":string,"claims":[{"text":string,"citations":number[]}],"uncertainty":"tinggi|sedang|rendah","abstain":boolean,"red_flags":string[]}',
].join("\n");

export function buildUserPrompt(question, evidence) {
  const context = evidence
    .map((item) => {
      const bits = [`[${item.n}] (${item.source}) ${item.title}`];
      if (item.journal) bits.push(`Jurnal: ${item.journal}`);
      if (item.year) bits.push(`Tahun: ${item.year}`);
      if (item.snippet) bits.push(`Kutipan: ${item.snippet}`);
      if (item.url) bits.push(`URL: ${item.url}`);
      return bits.join("\n");
    })
    .join("\n\n");
  return `PERTANYAAN:\n${question}\n\nKONTEKS:\n${context || "(tidak ada konteks)"}`;
}

export async function gatherEvidence(origin, question, options = {}) {
  const limit = options.limit || MAX_EVIDENCE;
  const evidence = [];

  try {
    const url = new URL(`${origin}/api/search`);
    url.searchParams.set("q", question);
    url.searchParams.set("per_page", String(limit));
    const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(20000) });
    if (resp.ok) {
      const data = await resp.json();
      for (const row of data.results || []) {
        if (evidence.length >= limit) break;
        evidence.push({
          n: evidence.length + 1,
          id: row.id,
          title: row.title || "(tanpa judul)",
          source: row.source || "unknown",
          journal: row.journal || null,
          year: row.year || null,
          url: row.url || null,
          snippet: normalizeSnippet(row.abstract || row.meta?.briefSummary || ""),
        });
      }
    }
  } catch {
    /* retrieval gagal → konteks kosong, akan abstain */
  }

  const catalogueDrug = findDrug(question);
  if (catalogueDrug) {
    evidence.push({
      n: evidence.length + 1,
      id: `drug|${catalogueDrug.slug}`,
      title: `${catalogueDrug.name} (${catalogueDrug.inn}) — ATC ${catalogueDrug.atc}`,
      source: "fornas",
      journal: catalogueDrug.kelas,
      year: null,
      url: "https://e-fornas.kemkes.go.id/guest/daftar-obat",
      snippet: [catalogueDrug.kelas, catalogueDrug.rute, ...(catalogueDrug.watchouts || [])].join(". "),
    });
  }

  return evidence.slice(0, MAX_EVIDENCE + 1);
}

function normalizeSnippet(value) {
  const text = String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 700 ? text.slice(0, 700) + "…" : text;
}

export function extractiveAnswer(question, evidence) {
  const blocks = [];
  const terms = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 3);

  for (const item of evidence) {
    const sentences = String(item.snippet || "")
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length >= 60);
    const scored = sentences
      .map((sentence) => ({
        sentence,
        score: terms.reduce((sum, token) => (sentence.toLowerCase().includes(token) ? sum + 1 : sum), 0),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);
    const picked = scored[0];
    if (picked) blocks.push({ text: picked.sentence, citations: [item.n] });
    if (blocks.length >= 5) break;
  }

  if (!blocks.length) {
    return {
      answer:
        "Bukti yang ditemukan belum cukup untuk menjawab pertanyaan ini. Coba gunakan istilah yang lebih spesifik (intervensi, populasi, luaran).",
      claims: [],
      uncertainty: "tinggi",
      abstain: true,
      red_flags: [],
    };
  }

  return {
    answer: "Ringkasan diambil langsung dari kalimat sumber (tanpa AI generatif).",
    claims: blocks,
    uncertainty: "sedang",
    abstain: false,
    red_flags: [],
  };
}

export function verifyClaims(claims, evidenceCount) {
  const verified = [];
  for (const claim of claims || []) {
    const citations = (claim.citations || []).filter((n) => Number.isInteger(n) && n >= 1 && n <= evidenceCount);
    verified.push({
      text: String(claim.text || "").trim(),
      citations,
      supported: citations.length > 0,
    });
  }
  const total = verified.length;
  const supported = verified.filter((claim) => claim.supported).length;
  return {
    claims: verified,
    support_rate: total === 0 ? 1 : supported / total,
    unsupported: verified.filter((claim) => !claim.supported).map((claim) => claim.text),
  };
}

export function usageBreakdown(usage = {}) {
  const inputHit = Number(usage.cache_hit_tokens || 0);
  const inputMiss = Number(usage.cache_miss_tokens || (usage.input_tokens || 0) - inputHit || 0);
  const output = Number(usage.output_tokens || 0);
  const cost = costMicroIdr({ inputHitTokens: inputHit, inputMissTokens: inputMiss, outputTokens: output });
  return { input_hit: inputHit, input_miss: inputMiss, output, cost_micro_idr: cost, charged_micro_idr: chargedMicroIdr(cost) };
}

export async function groundAnswer(env, question, options = {}) {
  const safety = classifyInput(question);
  if (safety.blocked) {
    return {
      status: 422,
      body: { error: "unsafe_input", code: safety.code, reason: safety.reason },
    };
  }

  const origin = options.origin;
  const evidence = await gatherEvidence(origin, question, { limit: options.limit || MAX_EVIDENCE });
  const redFlags = safety.red_flags.length ? safety.red_flags : [];
  const base = {
    question,
    evidence,
    safety: { blocked: false, red_flags: redFlags },
    red_flag_notice: redFlags.length ? redFlagNotice() : null,
  };

  if (providerReady(env) && options.useProvider !== false) {
    const result = await callDeepseek(env, {
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(question, evidence),
      maxTokens: options.maxTokens || 1024,
    });
    if (result.ok) {
      const payload = result.parsed || extractiveAnswer(question, evidence);
      const verified = verifyClaims(payload.claims, evidence.length);
      const abstain = Boolean(payload.abstain) || verified.claims.length === 0;
      return {
        status: 200,
        body: {
          ...base,
          mode: "llm",
          model: result.model,
          answer: payload.answer || "",
          claims: verified.claims,
          support_rate: verified.support_rate,
          unsupported: verified.unsupported,
          uncertainty: payload.uncertainty || "sedang",
          abstain,
          red_flags: Array.isArray(payload.red_flags) ? payload.red_flags : redFlags,
          usage: usageBreakdown(result.usage),
        },
      };
    }
  }

  const extractive = extractiveAnswer(question, evidence);
  const verified = verifyClaims(extractive.claims, evidence.length);
  return {
    status: 200,
    body: {
      ...base,
      mode: "extractive",
      model: null,
      answer: extractive.answer,
      claims: verified.claims,
      support_rate: verified.support_rate,
      unsupported: verified.unsupported,
      uncertainty: extractive.uncertainty,
      abstain: Boolean(extractive.abstain),
      red_flags: redFlags,
      usage: null,
    },
  };
}
