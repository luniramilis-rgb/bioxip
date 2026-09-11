import { chargedMicroIdr, costMicroIdr } from "./_pricing.js";
import { callDeepseek, providerReady } from "./_provider.js";
import { classifyInput, mergeRedFlags, redFlagNotice } from "./_safety.js";
import { findDrug } from "./_drugs.js";
import { sectionSnippet } from "./_rank.js";

const MAX_EVIDENCE = 8;

export const SYSTEM_PROMPT = [
  "Anda asisten bukti biomedis bioXip untuk tenaga kesehatan Indonesia.",
  "ATURAN WAJIB:",
  "1. Jawab HANYA berdasarkan KONTEKS yang diberikan.",
  "2. Setiap klaim harus punya sitasi angka [n] yang menunjuk item konteks.",
  "3. Dilarang mengarang angka, dosis, nama obat, atau hasil studi.",
  "4. Set abstain=true HANYA bila tidak ada satu pun klaim yang bisa didukung konteks. Bila ada klaim bersitasi, set abstain=false dan tulis keterbatasan pada field uncertainty.",
  "5. Bahasa Indonesia, ringkas, tanpa klaim diagnosis pasien atau perintah peresepan.",
  "6. red_flags hanya berisi frasa gejala singkat (mis. 'nyeri dada'), bukan kalimat penjelasan.",
  "7. Keluarkan JSON valid dengan skema:",
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
    url.searchParams.set("abstract", "1");
    url.searchParams.set("clinical", "1");
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
          snippet: sectionSnippet(row.abstract || row.meta?.briefSummary || "", question, 2),
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

const ESCAPES = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

/**
 * Ambil nilai field "answer" dari JSON yang mungkin BELUM lengkap.
 * Mengembalikan null bila kunci belum muncul.
 */
export function extractAnswerText(raw) {
  const text = String(raw || "");
  const match = text.match(/"answer"\s*:\s*"/);
  if (!match) return null;

  let index = match.index + match[0].length;
  let value = "";
  let closed = false;

  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      const next = text[index + 1];
      if (next === undefined) break; // escape belum lengkap → tunggu potongan berikutnya
      if (next === "u") {
        const hex = text.slice(index + 2, index + 6);
        if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) break;
        value += String.fromCharCode(parseInt(hex, 16));
        index += 6;
        continue;
      }
      value += ESCAPES[next] ?? next;
      index += 2;
      continue;
    }
    if (char === '"') {
      closed = true;
      break;
    }
    value += char;
    index += 1;
  }

  return { value, closed };
}

/**
 * Menerima potongan JSON dari provider dan mengeluarkan bagian teks jawaban
 * yang baru tersedia, sehingga pengguna melihat tulisan bertahap (bukan JSON mentah).
 */
export class AnswerExtractor {
  constructor() {
    this.raw = "";
    this.emitted = 0;
    this.finished = false;
  }

  push(chunk) {
    this.raw += String(chunk || "");
    const partial = extractAnswerText(this.raw);
    if (!partial) return "";
    if (partial.closed) this.finished = true;
    if (partial.value.length <= this.emitted) return "";
    const piece = partial.value.slice(this.emitted);
    this.emitted = partial.value.length;
    return piece;
  }

  get answer() {
    const partial = extractAnswerText(this.raw);
    return partial ? partial.value : "";
  }
}

export function verifyClaims(claims, evidenceCount) {  const verified = [];
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

/**
 * Abstain HANYA bila tidak ada klaim yang bersitasi. Permintaan abstain dari LLM
 * diabaikan bila ada ≥1 klaim bersitasi, agar jawaban berbukti tidak disembunyikan.
 */
export function resolveAbstain(requestedAbstain, verified) {
  const supported = (verified?.claims || []).filter((claim) => claim.supported).length;
  return supported > 0 ? false : true;
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
  const safetyFlags = safety.red_flags || [];

  const base = (redFlags) => ({
    question,
    evidence,
    safety: { blocked: false, red_flags: redFlags },
    red_flag_notice: redFlags.length ? redFlagNotice() : null,
  });

  if (providerReady(env) && options.useProvider !== false) {
    const result = await callDeepseek(env, {
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(question, evidence),
      maxTokens: options.maxTokens || 1024,
    });
    if (result.ok) {
      const payload = result.parsed || extractiveAnswer(question, evidence);
      const verified = verifyClaims(payload.claims, evidence.length);
      // Flag keselamatan deterministik tidak boleh hilang; flag LLM hanya menambah.
      const redFlags = mergeRedFlags(safetyFlags, payload.red_flags);
      const abstain = resolveAbstain(payload.abstain, verified);
      return {
        status: 200,
        body: {
          ...base(redFlags),
          mode: "llm",
          model: result.model,
          answer: payload.answer || "",
          claims: verified.claims,
          support_rate: verified.support_rate,
          unsupported: verified.unsupported,
          uncertainty: payload.uncertainty || "sedang",
          abstain,
          red_flags: redFlags,
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
      ...base(safetyFlags),
      mode: "extractive",
      model: null,
      answer: extractive.answer,
      claims: verified.claims,
      support_rate: verified.support_rate,
      unsupported: verified.unsupported,
      uncertainty: extractive.uncertainty,
      abstain: resolveAbstain(extractive.abstain, verified),
      red_flags: safetyFlags,
      usage: null,
    },
  };
}
