import { groundAnswer } from "../../_grounded.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  const token = env.DEV_ADMIN_TOKEN;

  // Gerbang aman: tanpa token terkonfigurasi, endpoint tidak ada (404).
  if (!token) {
    return json({ error: "not_found" }, 404);
  }
  const provided = request.headers.get("x-dev-token") || "";
  if (provided !== token) {
    return json({ error: "unauthorized" }, 401);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const question = String(body.question || body.q || "").trim();
    if (!question) return json({ error: "question_wajib" }, 400);

    const origin = new URL(request.url).origin;
    const result = await groundAnswer(env, question, {
      origin,
      limit: Math.min(Math.max(Number(body.limit) || 8, 3), 12),
      maxTokens: Math.min(Math.max(Number(body.max_tokens) || 1024, 256), 2048),
      useProvider: body.use_provider !== false,
    });

    return json(result.body, result.status);
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}

export async function onRequestGet() {
  return json({ error: "not_found" }, 404);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
