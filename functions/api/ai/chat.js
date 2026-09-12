import { bearerToken, fetchAccount, fetchUserEmail, holdCredits, isAdminEmail, refundCredits, settleCredits, json } from "../../_credits.js";

import { chargedMicroIdr, costMicroIdr, estimateMicroIdr, microToIdr } from "../../_pricing.js";
import { estimateInputTokens } from "../../_estimate.js";
import { callDeepseek, extractJson, providerReady, streamDeepseek } from "../../_provider.js";
import {
  AnswerExtractor,
  buildUserPrompt,
  extractiveAnswer,
  gatherEvidence,
  resolveAbstain,
  verifyClaims,
  SYSTEM_PROMPT,
} from "../../_grounded.js";
import { classifyInput, mergeRedFlags, redFlagNotice } from "../../_safety.js";
import { cacheGetJson, cacheKey, cachePutJson } from "../../_cache.js";
import { answerCacheGet, answerCachePut, answerHash } from "../../_answercache.js";
import { detectGuidelineTopic, guidelineEnabled, searchGuidelines, toEvidence } from "../../_guideline.js";

const MAX_TOKENS_LIMIT = 2048;
// Cache jawaban AI: memotong biaya token berulang (pertanyaan populer) secara signifikan.
const ANSWER_CACHE_TTL = 7 * 24 * 3600;
const ANSWER_CACHE_NAMESPACE = "answer:v2";
// Naikkan bila prompt/skema/evidence berubah, agar jawaban lama tidak tersaji.
const PROMPT_VERSION = "2026-09-12a";

function citationSnapshot(evidence) {
  return evidence.map((item) => ({
    n: item.n,
    id: item.id,
    title: item.title,
    source: item.source,
    url: item.url,
    journal: item.journal,
    year: item.year,
    guideline: item.guideline || null,
  }));
}

function sse(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Streaming provider dengan penurunan mode bertahap:
 *  1) json_object + include_usage
 *  2) tanpa json_object (bila provider menolak opsi 1 dengan HTTP 400)
 * Potongan teks jawaban dikirim ke klien lewat onDelta selama proses berlangsung.
 */
async function runProviderStream(env, { system, user, maxTokens, onDelta }) {
  const attempts = [
    { jsonMode: true, includeUsage: true },
    { jsonMode: false, includeUsage: true },
  ];
  let lastError = null;

  for (const attempt of attempts) {
    let session;
    try {
      session = await streamDeepseek(env, { system, user, maxTokens, ...attempt });
    } catch (error) {
      lastError = { error: "provider_exception", detail: String(error?.message || error) };
      continue;
    }

    if (!session.ok) {
      lastError = { error: session.error, detail: session.detail || null, status: session.status };
      // Hanya turunkan mode bila provider menolak opsi (400); 401/429/5xx tidak diulang.
      if (session.status === 400) continue;
      return { ok: false, ...lastError };
    }

    const extractor = new AnswerExtractor();
    let usage = null;
    let finishReason = null;
    let chunks = 0;

    for await (const event of session.events) {
      chunks += 1;
      const choice = event.choices?.[0];
      const piece = choice?.delta?.content;
      if (piece) {
        const text = extractor.push(piece);
        if (text) onDelta(text);
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (event.usage) usage = event.usage;
    }

    if (chunks === 0) {
      lastError = { error: "provider_empty_stream" };
      continue;
    }

    return {
      ok: true,
      raw: extractor.raw,
      extracted: extractor.answer,
      parsed: extractJson(extractor.raw),
      finish_reason: finishReason,
      usage: usage
        ? {
            input_tokens: Number(usage.prompt_tokens || 0),
            output_tokens: Number(usage.completion_tokens || 0),
            cache_hit_tokens: Number(usage.prompt_cache_hit_tokens || 0),
            cache_miss_tokens: Number(usage.prompt_cache_miss_tokens || 0),
          }
        : null,
      model: session.model,
      json_mode: attempt.jsonMode,
      usage_estimated: !usage,
    };
  }

  return { ok: false, ...(lastError || { error: "provider_failed" }) };
}

function chunkText(text, size = 90) {
  const chunks = [];
  for (let index = 0; index < text.length; index += size) chunks.push(text.slice(index, index + size));
  return chunks.length ? chunks : [""];
}

async function recentRequestCount(env, token) {
  const since = new Date(Date.now() - 60_000).toISOString();
  const resp = await fetch(
    `${env.SUPABASE_URL}/rest/v1/credit_operations?select=request_id&created_at=gte.${encodeURIComponent(since)}&limit=100`,
    {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    },
  );
  if (!resp.ok) return 0;
  const rows = await resp.json();
  return Array.isArray(rows) ? rows.length : 0;
}

async function userRateLimit(env, token) {
  const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/usage_limits?select=rpm&limit=1`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!resp.ok) return null;
  const rows = await resp.json();
  const rpm = Number(rows?.[0]?.rpm);
  return Number.isFinite(rpm) && rpm > 0 ? rpm : null;
}

export async function effectiveRpm(env, token) {
  const fromEnv = Number(env.RATE_LIMIT_RPM);
  const rpm = fromEnv > 0 ? fromEnv : (await userRateLimit(env, token)) || 6;
  return Math.min(Math.max(rpm, 1), 60);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const token = bearerToken(request);
  if (!token) return json({ error: "unauthorized" }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const question = String(
    body.question || [...messages].reverse().find((m) => m?.role === "user")?.content || "",
  ).trim();
  if (!question) return json({ error: "question_wajib" }, 400);

  const feature = String(body.feature || "chat");
  const maxTokens = Math.min(Math.max(Number(body.max_tokens) || 1024, 128), MAX_TOKENS_LIMIT);
  const useProvider = body.use_provider !== false;

  const safety = classifyInput(question);
  if (safety.blocked) {
    return json({ error: "unsafe_input", code: safety.code, reason: safety.reason }, 422);
  }

  const account = await fetchAccount(env, token);
  if (!account) return json({ error: "unauthorized" }, 401);

  // Akses admin (unlimited, tanpa saldo) — hanya bila allowlist env `ADMIN_EMAILS` cocok.
  const adminAllowlist = String(env.ADMIN_EMAILS || "").trim();
  const isAdmin = adminAllowlist ? isAdminEmail(await fetchUserEmail(env, token), adminAllowlist) : false;

  const rpm = await effectiveRpm(env, token);
  const recent = await recentRequestCount(env, token);
  if (recent >= rpm) {
    return json({ error: "rate_limited", rpm, retry_after: 60 }, 429);
  }

  const origin = new URL(request.url).origin;
  let evidence = await gatherEvidence(origin, question, { limit: 8 });
  // Local-first: pedoman lokal dimasukkan sebagai evidence terdepan agar ikut disitasi AI.
  if (guidelineEnabled(env)) {
    const guidelineRows = await searchGuidelines(env, question, origin, {
      topik: detectGuidelineTopic(question),
      limit: 3,
    }).catch(() => []);
    if (guidelineRows.length) {
      const gEvidence = toEvidence(guidelineRows);
      const seen = new Set();
      const merged = [];
      for (const item of [...gEvidence, ...evidence]) {
        const key = item.id || `${item.source}|${item.title}`;
        if (seen.has(key)) continue; // /api/search sudah menyertakan pedoman → hindari duplikat
        seen.add(key);
        merged.push(item);
      }
      evidence = merged.slice(0, 12).map((item, index) => ({ ...item, n: index + 1 }));
    }
  }
  const providerOk = useProvider && providerReady(env);
  const estimate = estimateMicroIdr({
    inputTokens: estimateInputTokens(question, evidence),
    maxOutputTokens: maxTokens,
    safety: providerOk ? 1.3 : 1,
  });

  const balanceMicro = Number(account.balance_micro_idr || 0);
  const requestId = crypto.randomUUID();
  if (!isAdmin) {
    if (balanceMicro < estimate) {
      return json(
        {
          error: "insufficient_balance",
          balance_idr: microToIdr(balanceMicro),
          estimate_idr: microToIdr(estimate),
        },
        402,
      );
    }

    const hold = await holdCredits(env, token, requestId, estimate);
    if (!hold.ok) {
      const insufficient = String(hold.body?.message || hold.body || "").includes("insufficient_balance");
      return json(
        {
          error: insufficient ? "insufficient_balance" : "hold_failed",
          balance_idr: microToIdr(balanceMicro),
          estimate_idr: microToIdr(estimate),
        },
        insufficient ? 402 : 502,
      );
    }
  }

  const safetyRedFlags = safety.red_flags || [];
  let redFlags = safetyRedFlags;
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event, data) => controller.enqueue(encoder.encode(sse(event, data)));

      let chargedMicro = 0;
      let usage = { input_tokens: 0, output_tokens: 0, cache_hit_tokens: 0, cache_miss_tokens: 0 };
      let answer = "";
      let claims = [];
      let supportRate = 1;
      let abstain = false;
      let mode = "mock";
      let model = "mock";

      try {
        send("meta", {
          request_id: requestId,
          estimate_idr: microToIdr(estimate),
          balance_idr: microToIdr(balanceMicro),
          evidence_count: evidence.length,
        });

        const providerIsReady = providerOk;
        let providerError = null;
        let cacheSaved = null;
        let providerAnswered = false;
        // Bila provider sudah mengalirkan potongan jawaban, jangan kirim ulang di bawah.
        let deltasSent = false;
        let providerDebug = null;

        // Cache jawaban: pertanyaan + model + versi prompt. Snapshot sitasi ikut disimpan
        // agar nomor sitasi pada jawaban yang di-cache tetap konsisten walau hasil
        // pencarian live berubah (penyebab cache selalu miss sebelumnya).
        const cacheId = cacheKey(ANSWER_CACHE_NAMESPACE, {
          q: question.toLowerCase().replace(/\s+/g, " ").trim(),
          max: maxTokens,
          model: providerIsReady ? env.DEEPSEEK_MODEL || "deepseek-flash" : "mock",
          v: PROMPT_VERSION,
        }, origin);
        if (providerIsReady) {
          let cachedAnswer = await cacheGetJson(cacheId).catch(() => null);
          let cacheLayer = cachedAnswer ? "l1" : null;
          if (!cachedAnswer) {
            // L1 (Cache API) meleset / per-colo → coba L2 (Postgres) yang andal.
            cachedAnswer = await answerCacheGet(env, answerHash(cacheId));
            cacheLayer = cachedAnswer ? "l2" : null;
          }
          if (cachedAnswer?.answer) {
            answer = String(cachedAnswer.answer);
            claims = cachedAnswer.claims || [];
            abstain = Boolean(cachedAnswer.abstain);
            model = cachedAnswer.model || model;
            mode = "cache";
            cacheSaved = cacheLayer;
            usage = { input_tokens: 0, output_tokens: 0, cache_hit_tokens: 0, cache_miss_tokens: 0 };
            if (Array.isArray(cachedAnswer.evidence) && cachedAnswer.evidence.length) {
              evidence = cachedAnswer.evidence;
            }
            send("meta", { request_id: requestId, cached: true, cache_layer: cacheLayer, evidence_count: evidence.length });
          }
        }

        if (mode !== "cache" && providerIsReady) {
          const streamed = await runProviderStream(env, {
            system: SYSTEM_PROMPT,
            user: buildUserPrompt(question, evidence),
            maxTokens,
            onDelta: (text) => {
              deltasSent = true;
              send("delta", { text });
            },
          });

          if (streamed.ok) {
            providerAnswered = true;
            model = streamed.model || model;
            providerDebug = {
              raw_len: streamed.raw?.length ?? 0,
              extracted_len: streamed.extracted?.length ?? 0,
              json_mode: streamed.json_mode,
              usage_estimated: Boolean(streamed.usage_estimated),
            };
            if (streamed.usage) {
              usage = streamed.usage;
            } else {
              // Provider tidak mengirim usage (mis. di tengah stream) → estimasi terkendali.
              const inputTokens = estimateInputTokens(question, evidence);
              const hit = Math.round(inputTokens * 0.7);
              usage = {
                input_tokens: inputTokens,
                output_tokens: Math.max(1, Math.ceil((streamed.extracted || "").length / 4)),
                cache_hit_tokens: hit,
                cache_miss_tokens: Math.max(0, inputTokens - hit),
              };
            }

            if (streamed.parsed) {
              const payload = streamed.parsed;
              answer = String(payload.answer || streamed.extracted || "");
              claims = payload.claims || [];
              abstain = Boolean(payload.abstain);
              redFlags = mergeRedFlags(safetyRedFlags, payload.red_flags);
              mode = "llm";
              const cachePayload = { answer, claims, abstain, model, evidence: citationSnapshot(evidence), question };
              cacheSaved = await cachePutJson(cacheId, cachePayload, ANSWER_CACHE_TTL);
              await answerCachePut(env, answerHash(cacheId), cachePayload, ANSWER_CACHE_TTL);
            } else {
              // Teks sudah tampil sebagian, tetapi struktur klaim tidak dapat diparsing:
              // ganti dengan jawaban ekstraktif agar pengguna tidak melihat teks setengah jadi.
              const extractive = extractiveAnswer(question, evidence);
              answer = extractive.answer;
              claims = extractive.claims;
              abstain = Boolean(extractive.abstain);
              mode = "extractive";
              send("replace", { text: answer });
              providerError = {
                error: "provider_parse_failed",
                finish_reason: streamed.finish_reason || null,
                output_tokens: usage.output_tokens,
                streamed: true,
              };
              console.warn("bioxip: keluaran stream tidak dapat diparsing", JSON.stringify(providerError));
              send("provider_parse_error", providerError);
            }
          } else {
            // Streaming gagal total → fallback ke panggilan non-streaming yang sudah terbukti.
            console.warn("bioxip: streaming gagal, fallback non-stream", JSON.stringify(streamed));
            const result = await callDeepseek(env, {
              system: SYSTEM_PROMPT,
              user: buildUserPrompt(question, evidence),
              maxTokens,
            });
            if (result.ok) {
              providerAnswered = true;
              model = result.model || model;
              usage = {
                input_tokens: result.usage.input_tokens,
                output_tokens: result.usage.output_tokens,
                cache_hit_tokens: result.usage.cache_hit_tokens,
                cache_miss_tokens: result.usage.cache_miss_tokens,
              };
              if (result.parsed) {
                const payload = result.parsed;
                answer = String(payload.answer || "");
                claims = payload.claims || [];
                abstain = Boolean(payload.abstain);
                redFlags = mergeRedFlags(safetyRedFlags, payload.red_flags);
                mode = "llm";
                const cachePayload = { answer, claims, abstain, model, evidence: citationSnapshot(evidence), question };
              cacheSaved = await cachePutJson(cacheId, cachePayload, ANSWER_CACHE_TTL);
              await answerCachePut(env, answerHash(cacheId), cachePayload, ANSWER_CACHE_TTL);
              } else {
                const extractive = extractiveAnswer(question, evidence);
                answer = extractive.answer;
                claims = extractive.claims;
                abstain = Boolean(extractive.abstain);
                mode = "extractive";
                providerError = {
                  error: "provider_parse_failed",
                  finish_reason: result.finish_reason || null,
                  output_tokens: result.usage.output_tokens,
                  requested_max_tokens: result.requested_max_tokens || maxTokens,
                };
                console.warn("bioxip: keluaran provider tidak dapat diparsing", JSON.stringify(providerError));
                send("provider_parse_error", providerError);
              }
            } else {
              providerError = { error: result.error, detail: result.detail || null };
              console.warn("bioxip: provider gagal", JSON.stringify(providerError));
              send("provider_error", providerError);
            }
          }
        }

        if (!providerAnswered && mode === "mock") {
          const extractive = extractiveAnswer(question, evidence);
          answer = extractive.answer;
          claims = extractive.claims;
          abstain = Boolean(extractive.abstain);
          const hit = Math.round(estimateInputTokens(question, evidence) * 0.7);
          usage = {
            input_tokens: estimateInputTokens(question, evidence),
            output_tokens: Math.max(40, Math.ceil(answer.length / 4)),
            cache_hit_tokens: hit,
            cache_miss_tokens: Math.max(0, estimateInputTokens(question, evidence) - hit),
          };
        }

        // Kirim teks lengkap HANYA bila belum dialirkan oleh provider/event replace
        // (mencegah jawaban terkirim dua kali).
        if (!deltasSent) {
          for (const piece of chunkText(answer)) {
            send("delta", { text: piece });
          }
        }

        const verified = verifyClaims(claims, evidence.length);
        supportRate = verified.support_rate;
        // Abstain hanya bila tak ada klaim bersitasi — permintaan abstain LLM tidak
        // boleh menyembunyikan jawaban yang sudah didukung bukti.
        abstain = resolveAbstain(abstain, verified);

        for (const item of evidence) {
          send("citation", { n: item.n, title: item.title, source: item.source, url: item.url, guideline: item.guideline || null });
        }

        const cost = costMicroIdr({
          inputHitTokens: usage.cache_hit_tokens,
          inputMissTokens: usage.cache_miss_tokens,
          outputTokens: usage.output_tokens,
        });
        chargedMicro = chargedMicroIdr(cost);
        if (chargedMicro > estimate) chargedMicro = estimate;
        if (isAdmin) chargedMicro = 0; // akses admin: tanpa biaya

        if (!isAdmin) {
          const settled = await settleCredits(env, token, requestId, chargedMicro);
          if (!settled.ok) throw new Error("settle_failed");
        }

        await logUsage(env, token, {
          requestId,
          feature,
          provider: mode === "mock" ? "mock" : "deepseek",
          model,
          usage,
          costMicro: cost,
          chargedMicro,
          status: "ok",
        });
        await logChat(env, token, {
          requestId,
          feature,
          messages,
          answer,
          citations: evidence.map((item) => ({ n: item.n, title: item.title, url: item.url })),
        });

        send("citation_summary", {
          support_rate: supportRate,
          unsupported: verified.unsupported,
          // Klaim kunci (untuk bullet di UI); payload kecil & sudah tersedia di server.
          claims: verified.claims.map((claim) => ({
            text: claim.text,
            citations: claim.citations,
            supported: claim.supported,
          })),
        });
        if (redFlags.length) send("red_flag", { notice: redFlagNotice(), flags: redFlags });

        const after = await fetchAccount(env, token);
        send("done", {
          charged_idr: microToIdr(chargedMicro),
          balance_idr: microToIdr(Number(after?.balance_micro_idr || 0)),
          tokens: { in: usage.input_tokens, out: usage.output_tokens },
          abstain,
          mode,
          model,
          support_rate: supportRate,
          claims: claims.length,
          cache_saved: cacheSaved,
          debug: providerDebug,
        });
      } catch (error) {
        try {
          if (!isAdmin) await refundCredits(env, token, requestId); // admin: tidak ada hold untuk dikembalikan
          await logUsage(env, token, {
            requestId,
            feature,
          provider: mode === "mock" ? "mock" : "deepseek",
            model,
            usage,
            costMicro: 0,
            chargedMicro: 0,
            status: "refunded",
          });
        } catch {
          /* refund terbaik-upaya */
        }
        send("error", { message: String(error.message || error) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}

async function logUsage(env, token, payload) {
  const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/fn_ai_log_usage`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_request_id: payload.requestId,
      p_feature: payload.feature,
      p_provider: payload.provider,
      p_model: payload.model,
      p_input_tokens: payload.usage.input_tokens,
      p_output_tokens: payload.usage.output_tokens,
      p_cost_micro_idr: payload.costMicro,
      p_charged_micro_idr: payload.chargedMicro,
      p_status: payload.status,
    }),
  }).catch(() => null);
  if (!resp || !resp.ok) {
    console.warn("bioxip: gagal menulis ai_usage_log", resp ? resp.status : "network");
  }
}

async function logChat(env, token, payload) {
  const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/fn_ai_log_chat`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_request_id: payload.requestId,
      p_feature: payload.feature,
      p_messages: payload.messages,
      p_answer: payload.answer,
      p_citations: payload.citations,
    }),
  }).catch(() => null);
  if (!resp || !resp.ok) {
    console.warn("bioxip: gagal menulis ai_chat_log", resp ? resp.status : "network");
  }
}
