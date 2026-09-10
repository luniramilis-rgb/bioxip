import pricing from "./_pricing.json";

export const PRICING = pricing;

const perThousand = (usdPerMillion) =>
  Math.round(((usdPerMillion * pricing.usd_idr) / 1000) * pricing.micro_per_idr);

export const PRICE_IN_HIT_MICRO_PER_1K = perThousand(pricing.price_in_hit_usd_per_million);
export const PRICE_IN_MISS_MICRO_PER_1K = perThousand(pricing.price_in_miss_usd_per_million);
export const PRICE_OUT_MICRO_PER_1K = perThousand(pricing.price_out_usd_per_million);

const ceilDiv = (value, divisor) => Math.ceil(value / divisor);

export function costMicroIdr({ inputHitTokens = 0, inputMissTokens = 0, outputTokens = 0 }) {
  return (
    ceilDiv(inputHitTokens * PRICE_IN_HIT_MICRO_PER_1K, 1000) +
    ceilDiv(inputMissTokens * PRICE_IN_MISS_MICRO_PER_1K, 1000) +
    ceilDiv(outputTokens * PRICE_OUT_MICRO_PER_1K, 1000)
  );
}

export function chargedMicroIdr(costMicro, markup = pricing.markup) {
  const withMarkup = costMicro * markup;
  const minimum = pricing.min_charge_idr * pricing.micro_per_idr;
  const raw = Math.max(withMarkup, minimum);
  const rupiah = Math.ceil(raw / pricing.micro_per_idr);
  return rupiah * pricing.micro_per_idr;
}

export function estimateMicroIdr({ inputTokens = 0, maxOutputTokens = 1024, cacheHitRatio = 0.7, safety = 1 }) {
  const hit = Math.round(inputTokens * cacheHitRatio);
  const miss = Math.max(0, inputTokens - hit);
  const cost = costMicroIdr({
    inputHitTokens: hit,
    inputMissTokens: miss,
    outputTokens: maxOutputTokens,
  });
  const charged = chargedMicroIdr(cost);
  const withSafety = safety > 1
    ? Math.ceil((charged * safety) / pricing.micro_per_idr) * pricing.micro_per_idr
    : charged;
  const minimum = pricing.min_charge_idr * pricing.micro_per_idr;
  return Math.max(withSafety, minimum);
}

export function microToIdr(micro) {
  return Math.ceil(micro / pricing.micro_per_idr);
}

export function idrToMicro(idr) {
  return idr * pricing.micro_per_idr;
}
