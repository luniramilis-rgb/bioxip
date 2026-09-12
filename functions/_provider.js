const TIMEOUT_MS = 60000;
// Streaming bisa berlangsung lebih lama daripada panggilan biasa, tetapi harus tetap
// di bawah batas wall-clock platform (Cloudflare ~30 dtk) agar fallback masih bisa jalan.
const STREAM_TIMEOUT_MS = 25000;
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
 * Escape karakter kontrol yang tidak sah di dalam string JSON
 * (model kadang menulis newline/tab mentah di dalam nilai string).
 */
function sanitizeJsonStrings(text) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const char of String(text)) {
    if (inString) {
      if (escaped) {
        out += char;
        escaped = false;
        continue;
      }
      if (char === "\\") {
        out += char;
        escaped = true;
        continue;
      }
      if (char === '"') {
        out += char;
        inString = false;
        continue;
      }
      if (char === "\n") {
        out += "\\n";
        continue;
      }
      if (char === "\r") {
        out += "\\r";
        continue;
      }
      if (char === "\t") {
        out += "\\t";
        continue;
      }
      if (char.charCodeAt(0) < 0x20) {
        out += `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
        continue;
      }
      out += char;
      continue;
    }
    if (char === '"') inString = true;
    out += char;
  }
  return out;
}

/**
 * Ambil JSON dari keluaran LLM yang mungkin dibungkus ```json, diawali teks,
 * terpotong, atau memuat karakter kontrol mentah. Null bila benar-benar gagal.
 */
export function extractJson(content) {
  const text = String(content || "").trim();
  if (!text) return null;

  const tryParse = (candidate) => {
    if (!candidate) return null;
    const variants = [
      candidate,
      sanitizeJsonStrings(candidate),
      sanitizeJsonStrings(candidate).replace(/,\s*([}\]])/g, "$1"),
    ];
    for (const variant of variants) {
      try {
        const value = JSON.parse(variant);
        // Skema bioXip selalu berupa objek; array/angka/string bukan jawaban valid.
        if (value && typeof value === "object" && !Array.isArray(value)) return value;
      } catch {
        /* coba varian berikutnya */
      }
    }
    return null;
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

/**
 * Keputusan mengulang saat streaming tidak menghasilkan JSON valid: ulangi bila
 * provider berhenti tidak wajar (mis. `length`/truncation) dan anggaran masih bisa naik.
 */
export function shouldRetryStream(finishReason, maxTokens, retryMaxTokens = 4096) {
  return finishReason !== "stop" && Number(maxTokens) < Number(retryMaxTokens);
}

/** Baca SSE OpenAI-compatible (DeepSeek) menjadi potongan JSON bertahap. */
export async function* parseOpenAiSse(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line || line.startsWith(":")) continue; // komentar / keep-alive
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        yield JSON.parse(payload);
      } catch {
        /* lewati baris yang tidak valid */
      }
    }
  }
}

/**
 * Panggil provider dengan stream: true. Mengembalikan iterator potongan.
 * Bila permintaan ditolak karena opsi tidak didukung, kembalikan error agar
 * pemanggil dapat menurunkan mode (mis. tanpa json_object) atau fallback.
 */
export async function streamDeepseek(env, { system, user, maxTokens = 1024, temperature = 0.2, jsonMode = true, includeUsage = true }) {
  const config = providerConfig(env);
  if (!config.apiKey) return { ok: false, error: "provider_not_configured" };

  const body = {
    model: config.model,
    temperature,
    max_tokens: maxTokens,
    stream: true,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (jsonMode) body.response_format = { type: "json_object" };
  if (includeUsage) body.stream_options = { include_usage: true };

  const resp = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(STREAM_TIMEOUT_MS),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    return {
      ok: false,
      error: `provider_http_${resp.status}`,
      status: resp.status,
      detail: detail.slice(0, 300),
    };
  }

  return { ok: true, model: config.model, events: parseOpenAiSse(resp.body) };
}
