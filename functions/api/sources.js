import { json, select } from "./_db.js";

export async function onRequestGet(context) {
  try {
    const { env } = context;
    const stats = await select(env, "source_stats", {
      select: "source,doc_type,total,active,last_updated",
      limit: "100",
    });
    const runs = await select(env, "latest_harvest_runs", {
      select: "provider,kind,status,started_at,finished_at,fetched,inserted,updated",
      limit: "20",
    });
    return json({ sources: stats, harvest: runs });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}
