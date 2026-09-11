const TIMEOUT_MS = 60000;
// Model yang didukung Provider API DeepSeek (lihat pesan error provider):
// deepseek-flash (murah/cepat) dan deepseek-v4-pro (lebih kuat).
const DEFAULT_MODEL = "deepseek-flash";

export function providerConfig(env) {
  return {
    apiKey: env.DEEPSEEK_API_KEY || "",
    baseUrl: (env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, ""),
    model: env.DEEPSEEK_MODEL || DEFAULT_MODEL,
  };
}

export function providerReady(env) {
  return Boolean(providerConfig(env).apiKey);
}

/**
 * Ambil JSON dari keluaran LLM yang mungkin dibungkus ```json, diawali teks,
 * atau terpotong. Mengembalikan null bila benar-benar tidak ada JSON valid.
 */
export function extractJson(content) {
  const text = String(content || "").trim();
  if (!text) return null;

  const tryParse = (candidate) => {
    try {
      const value = JSON.parse(candidate);
      // Skema bioXip selalu berupa objek; array/angka/string bukan jawaban valid.
      return value && typeof value === "object" && !Array.isArray(value) ? value : null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(text);
  if (direct) return direct;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsed = tryParse(fenced[1].trim());
    if (parsed) return parsed;
  }

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const parsed = tryParse(text.slice(first, last + 1));
    if (parsed) return parsed;
  }
  return null;
}

async function requestCompletion(config, { system, user, maxTokens, temperature, jsonMode }) {
  const body = {
    model: config.model,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (jsonMode) body.response_format = { type: "json_object" };

  const resp = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    return { ok: false, error: `provider_http_${resp.status}`, detail: detail.slice(0, 300) };
  }

  const data = await resp.json();
  const choice = data.choices?.[0] || {};
  const content = choice.message?.content || "";
  const usage = data.usage || {};
  return {
    ok: true,
    content,
    finish_reason: choice.finish_reason || null,
    model: data.model || config.model,
    usage: {
      input_tokens: Number(usage.prompt_tokens || 0),
      output_tokens: Number(usage.completion_tokens || 0),
      cache_hit_tokens: Number(usage.prompt_cache_hit_tokens || 0),
      cache_miss_tokens: Number(usage.prompt_cache_miss_tokens || 0),
    },
  };
}

export async function callDeepseek(env, { system, user, maxTokens = 1024, temperature = 0.2 }) {
  const config = providerConfig(env);
  if (!config.apiKey) return { ok: false, error: "provider_not_configured" };

  const MAX_TOKENS_CAP = 4096;
  // Rencana percobaan:
  //  1) mode JSON (paling patuh skema)
  //  2) tanpa mode JSON (model mungkin tidak mendukung)
  //  3) token diperbesar bila keluaran sebelumnya terpotong (finish_reason=length)
  const plan = [
    { jsonMode: true, maxTokens },
    { jsonMode: false, maxTokens },
  ];
  let index = 0;
  let last = null;

  while (index < plan.length) {
    const attempt = plan[index];
    index += 1;

    const result = await requestCompletion(config, {
      system,
      user,
      maxTokens: attempt.maxTokens,
      temperature,
      jsonMode: attempt.jsonMode,
    });
    if (!result.ok) return result;

    const parsed = extractJson(result.content);
    last = { ...result, parsed, json_mode: attempt.jsonMode, requested_max_tokens: attempt.maxTokens };
    if (parsed) {
      return {
        ok: true,
        raw: result.content,
        parsed,
        model: result.model,
        finish_reason: result.finish_reason,
        json_mode: attempt.jsonMode,
        requested_max_tokens: attempt.maxTokens,
        usage: result.usage,
      };
    }

    // Keluaran terpotong: coba lagi dengan anggaran token lebih besar.
    if (result.finish_reason === "length" && attempt.maxTokens < MAX_TOKENS_CAP) {
      const bigger = Math.min(attempt.maxTokens * 2, MAX_TOKENS_CAP);
      if (!plan.some((item) => item.maxTokens === bigger && item.jsonMode)) {
        plan.push({ jsonMode: true, maxTokens: bigger });
      }
    }
  }

  return {
    ok: true,
    raw: last?.content || "",
    parsed: null,
    model: last?.model || config.model,
    finish_reason: last?.finish_reason || null,
    json_mode: last?.json_mode ?? null,
    requested_max_tokens: last?.requested_max_tokens ?? maxTokens,
    parse_failed: true,
    usage: last?.usage || { input_tokens: 0, output_tokens: 0, cache_hit_tokens: 0, cache_miss_tokens: 0 },
  };
}
