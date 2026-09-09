import { json, rpc } from "./_db.js";

const TYPES = new Set(["paper", "preprint", "trial", "local"]);
const SORTS = new Set(["relevance", "date", "citations"]);

export async function onRequestGet(context) {
  try {
    const { env } = context;
    const url = new URL(context.request.url);
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) {
      return json({ error: "param q wajib" }, 400);
    }

    const rawTypes = (url.searchParams.get("types") || "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => TYPES.has(s));

    const args = {
      p_query: q.slice(0, 300),
      p_types: rawTypes.length ? rawTypes : null,
      p_year_min: intOrNull(url.searchParams.get("year_min")),
      p_year_max: intOrNull(url.searchParams.get("year_max")),
      p_oa: url.searchParams.get("oa") === "true",
      p_indonesia: url.searchParams.get("indonesia") === "true",
      p_sort: SORTS.has(url.searchParams.get("sort")) ? url.searchParams.get("sort") : "relevance",
      p_limit: clamp(intOrNull(url.searchParams.get("per_page")) ?? 20, 1, 50),
      p_offset: clamp(intOrNull(url.searchParams.get("page")) ?? 1, 1, 100000) - 1,
    };

    const data = await rpc(env, "fn_bioxip_search", args);
    return json(data);
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}

function intOrNull(value) {
  if (value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}
