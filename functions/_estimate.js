import { estimateMicroIdr, microToIdr } from "./_pricing.js";

export function estimateInputTokens(question, evidence) {
  const chars =
    String(question || "").length +
    evidence.reduce(
      (sum, item) => sum + String(item.snippet || "").length + String(item.title || "").length,
      0,
    );
  return Math.max(200, Math.ceil(chars / 4));
}

export function estimatePayload({ question = "", evidenceCount = 8, maxTokens = 1024, safety = 1 }) {
  const approximateEvidenceChars = evidenceCount * 700;
  const inputTokens = Math.max(300, Math.ceil((String(question).length + approximateEvidenceChars) / 4));
  const estimate = estimateMicroIdr({ inputTokens, maxOutputTokens: maxTokens, safety });
  return {
    estimate_idr: microToIdr(estimate),
    estimate_micro_idr: estimate,
    basis: "peak",
    markup: 12,
    safety,
    assumed_input_tokens: inputTokens,
    max_tokens: maxTokens,
  };
}
