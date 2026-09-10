import { estimatePayload } from "./chat.js";
import { bearerToken, json } from "../../_credits.js";

export async function onRequestGet(context) {
  const token = bearerToken(context.request);
  if (!token) return json({ error: "unauthorized" }, 401);

  const url = new URL(context.request.url);
  const maxTokens = Math.min(Math.max(Number(url.searchParams.get("max_tokens")) || 1024, 128), 2048);
  const evidenceCount = Math.min(Math.max(Number(url.searchParams.get("evidence")) || 8, 1), 12);
  const question = url.searchParams.get("q") || "";

  return json(
    estimatePayload({
      question,
      evidenceCount,
      maxTokens,
    }),
  );
}
