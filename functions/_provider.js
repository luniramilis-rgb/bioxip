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

  // Percobaan 1: mode JSON (paling patuh skema). Percobaan 2: tanpa mode JSON
  // bila model tidak mendukungnya atau keluaran tidak dapat diparsing.
  const attempts = [true, false];
  let last = null;
  for (const jsonMode of attempts) {
    const result = await requestCompletion(config, { system, user, maxTokens, temperature, jsonMode });
    if (!result.ok) return result;

    const parsed = extractJson(result.content);
    last = { ...result, parsed, json_mode: jsonMode };

    if (parsed) {
      return {
        ok: true,
        raw: result.content,
        parsed,
        model: result.model,
        finish_reason: result.finish_reason,
        json_mode: jsonMode,
        usage: result.usage,
      };
    }
    // Terpotong (finish_reason=length) tidak akan membaik dengan mengubah mode JSON.
    if (result.finish_reason === "length") break;
  }

  return {
    ok: true,
    raw: last?.content || "",
    parsed: null,
    model: last?.model || config.model,
    finish_reason: last?.finish_reason || null,
    json_mode: last?.json_mode ?? null,
    parse_failed: true,
    usage: last?.usage || { input_tokens: 0, output_tokens: 0, cache_hit_tokens: 0, cache_miss_tokens: 0 },
  };
}
