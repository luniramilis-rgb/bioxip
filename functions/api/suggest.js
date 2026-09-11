import { suggest } from "../_dictionary.js";
import { suggestFormularyDrugs, formularyEnabled } from "../_formulary.js";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (formularyEnabled(context.env)) {
    const drugs = await suggestFormularyDrugs(context.env, q, url.origin).catch(() => []);
    if (drugs.length) return json({ suggestions: drugs, source: "db" });
  }
  return json({ suggestions: suggest(q), source: "dictionary" });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
