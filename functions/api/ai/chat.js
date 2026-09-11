import { bearerToken, fetchAccount, holdCredits, refundCredits, settleCredits, json } from "../../_credits.js";
import { chargedMicroIdr, costMicroIdr, estimateMicroIdr, microToIdr } from "../../_pricing.js";
import { estimateInputTokens } from "../../_estimate.js";
import { callDeepseek, providerReady } from "../../_provider.js";
import { buildUserPrompt, gatherEvidence, extractiveAnswer, verifyClaims, SYSTEM_PROMPT } from "../../_grounded.js";
import { classifyInput, redFlagNotice } from "../../_safety.js";
import { cacheGetJson, cacheKey, cachePutJson } from "../../_cache.js";

const MAX_TOKENS_LIMIT = 2048;
// Cache jawaban AI: memotong biaya token berulang (pertanyaan populer) secara signifikan.
const ANSWER_CACHE_TTL = 7 * 24 * 3600;
const ANSWER_CACHE_NAMESPACE = "answer:v1";

function sse(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Hash FNV-1a sederhana (sinkron) untuk fingerprint konteks bukti. */
function hashKey(text) {
  let hash = 0x811c9dc5;
  const value = String(text || "");
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
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

  const rpm = await effectiveRpm(env, token);
  const recent = await recentRequestCount(env, token);
  if (recent >= rpm) {
    return json({ error: "rate_limited", rpm, retry_after: 60 }, 429);
  }

  const origin = new URL(request.url).origin;
  const evidence = await gatherEvidence(origin, question, { limit: 8 });
  const providerOk = useProvider && providerReady(env);
  const estimate = estimateMicroIdr({
    inputTokens: estimateInputTokens(question, evidence),
    maxOutputTokens: maxTokens,
    safety: providerOk ? 1.3 : 1,
  });

  const balanceMicro = Number(account.balance_micro_idr || 0);
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

  const requestId = crypto.randomUUID();
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

  const redFlags = safety.red_flags || [];
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

        const providerIsReady = useProvider && providerReady(env);

        // Cache jawaban: pertanyaan + konteks bukti sama → tidak perlu memanggil LLM lagi.
        const cacheId = cacheKey(ANSWER_CACHE_NAMESPACE, {
          q: question.toLowerCase().replace(/\s+/g, " ").trim(),
          max: maxTokens,
          model: providerIsReady ? env.DEEPSEEK_MODEL || "deepseek-v4.1-flash" : "mock",
          ev: hashKey(evidence.map((item) => item.id || item.title).join("|")),
        });
        if (providerIsReady) {
          const cachedAnswer = await cacheGetJson(cacheId);
          if (cachedAnswer) {
            answer = String(cachedAnswer.answer || "");
            claims = cachedAnswer.claims || [];
            abstain = Boolean(cachedAnswer.abstain);
            model = cachedAnswer.model || model;
            mode = "cache";
            usage = { input_tokens: 0, output_tokens: 0, cache_hit_tokens: 0, cache_miss_tokens: 0 };
            send("meta", { request_id: requestId, cached: true });
          }
        }

        if (mode !== "cache" && providerIsReady) {
          const result = await callDeepseek(env, {
            system: SYSTEM_PROMPT,
            user: buildUserPrompt(question, evidence),
            maxTokens,
          });
          if (result.ok) {
            const payload = result.parsed || extractiveAnswer(question, evidence);
            answer = String(payload.answer || "");
            claims = payload.claims || [];
            abstain = Boolean(payload.abstain);
            mode = "llm";
            model = result.model;
            usage = {
              input_tokens: result.usage.input_tokens,
              output_tokens: result.usage.output_tokens,
              cache_hit_tokens: result.usage.cache_hit_tokens,
              cache_miss_tokens: result.usage.cache_miss_tokens,
            };
            await cachePutJson(cacheId, { answer, claims, abstain, model }, ANSWER_CACHE_TTL);
          }
        }

        if (mode === "mock") {
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

        for (const piece of chunkText(answer)) {
          send("delta", { text: piece });
        }

        const verified = verifyClaims(claims, evidence.length);
        supportRate = verified.support_rate;
        if (verified.claims.length === 0) abstain = true;

        for (const item of evidence) {
          send("citation", { n: item.n, title: item.title, source: item.source, url: item.url });
        }

        const cost = costMicroIdr({
          inputHitTokens: usage.cache_hit_tokens,
          inputMissTokens: usage.cache_miss_tokens,
          outputTokens: usage.output_tokens,
        });
        chargedMicro = chargedMicroIdr(cost);
        if (chargedMicro > estimate) chargedMicro = estimate;

        const settled = await settleCredits(env, token, requestId, chargedMicro);
        if (!settled.ok) throw new Error("settle_failed");

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
        });
        if (redFlags.length) send("red_flag", { notice: redFlagNotice(), flags: redFlags });

        const after = await fetchAccount(env, token);
        send("done", {
          charged_idr: microToIdr(chargedMicro),
          balance_idr: microToIdr(Number(after?.balance_micro_idr || 0)),
          tokens: { in: usage.input_tokens, out: usage.output_tokens },
          abstain,
          mode,
          support_rate: supportRate,
        });
      } catch (error) {
        try {
          await refundCredits(env, token, requestId);
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
