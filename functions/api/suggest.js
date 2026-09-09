import { json, select } from "./_db.js";

export async function onRequestGet(context) {
  try {
    const { env } = context;
    const url = new URL(context.request.url);
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    if (!q) return json({ suggestions: [] });

    const terms = await select(env, "term_map", {
      select: "id_term,en_terms,kind",
      id_term: `ilike.${q}*`,
      limit: "6",
    });
    return json({ suggestions: terms });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}
