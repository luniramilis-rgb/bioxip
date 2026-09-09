import { json, select } from "./_db.js";

export async function onRequestGet(context) {
  try {
    const { env } = context;
    const url = new URL(context.request.url);
    const id = url.pathname.split("/").pop();
    if (!id) return json({ error: "id wajib" }, 400);

    const rows = await select(env, "documents", {
      select: "id,doc_type,title,abstract,authors,journal,issn,year,published_on,doi,url,external_ids,keywords,lang,oa,citation_count,meta,source,is_preferred",
      id: `eq.${id}`,
      limit: "1",
    });
    if (!rows.length) return json({ error: "tidak ditemukan" }, 404);
    return json(rows[0]);
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}
