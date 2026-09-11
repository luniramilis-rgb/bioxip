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

export async function callDeepseek(env, { system, user, maxTokens = 1024, temperature = 0.2 }) {
  const config = providerConfig(env);
  if (!config.apiKey) return { ok: false, error: "provider_not_configured" };

  const resp = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    return { ok: false, error: `provider_http_${resp.status}`, detail: detail.slice(0, 300) };
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || "";
  const usage = data.usage || {};
  let parsed = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = null;
  }
  return {
    ok: true,
    raw: content,
    parsed,
    model: data.model || config.model,
    usage: {
      input_tokens: Number(usage.prompt_tokens || 0),
      output_tokens: Number(usage.completion_tokens || 0),
      cache_hit_tokens: Number(usage.prompt_cache_hit_tokens || 0),
      cache_miss_tokens: Number(usage.prompt_cache_miss_tokens || 0),
    },
  };
}
