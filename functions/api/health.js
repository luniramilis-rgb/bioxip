import { providerConfig, providerReady } from "../_provider.js";
import { xenditConfig } from "../_xendit.js";

export async function onRequestGet(context) {
  const env = context.env || {};
  const provider = providerConfig(env);
  let baseHost = null;
  try {
    baseHost = new URL(provider.baseUrl).host;
  } catch {
    baseHost = null;
  }

  return new Response(
    JSON.stringify({
      ok: true,
      service: "bioxip",
      time: new Date().toISOString(),
      ai: {
        configured: providerReady(env),
        model: provider.model || null,
        base_host: baseHost,
        key_present: Boolean(env.DEEPSEEK_API_KEY),
        key_length: env.DEEPSEEK_API_KEY ? String(env.DEEPSEEK_API_KEY).length : 0,
      },
      payments: {
        mode: xenditConfig(env).mode,
        callback_token_present: Boolean(env.XENDIT_CALLBACK_TOKEN),
      },
      storage: {
        supabase_url_present: Boolean(env.SUPABASE_URL),
        anon_present: Boolean(env.SUPABASE_ANON_KEY),
        service_role_present: Boolean(env.SUPABASE_SERVICE_ROLE),
      },
      dev_endpoint: Boolean(env.DEV_ADMIN_TOKEN),
    }),
    { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
  );
}
