// media-retention — política de retenção de mídia.
//   entrada (in):  expira após 30 dias
//   saída   (out): expira após 365 dias
// Padrão = dry-run (só conta/reporta). ?confirm=1 zera media_url no nosso DB.
// Deleção dos BYTES depende de onde o storage mora: efetiva de verdade após migrar
// os anexos do Chatwoot pro Supabase Storage (bucket chatwoot-media) — aí dá pra
// apagar os objetos do bucket aqui. Auth: JWT do dashboard OU token de cron.
import { admin } from "../shared/supabase.ts";
import { env, optionalEnv } from "../shared/env.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const IN_DAYS = 30;
const OUT_DAYS = 365;

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const cronToken = optionalEnv("SYNC_SECRET") ?? env("CHATWOOT_WEBHOOK_SECRET");
  let authed = timingSafeEqual(token, cronToken);
  if (!authed) {
    const userClient = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false },
    });
    const { data } = await userClient.auth.getUser();
    authed = Boolean(data?.user);
  }
  if (!authed) return json({ error: "unauthorized" }, 401);

  const confirm = url.searchParams.get("confirm") === "1";
  const db = admin();
  const now = Date.now();
  const inCutoff = new Date(now - IN_DAYS * 86_400_000).toISOString();
  const outCutoff = new Date(now - OUT_DAYS * 86_400_000).toISOString();

  async function count(direction: string, cutoff: string) {
    const { count } = await db.from("messages").select("*", { count: "exact", head: true })
      .eq("direction", direction).not("media_url", "is", null).lt("sent_at", cutoff);
    return count ?? 0;
  }

  const expiredIn = await count("in", inCutoff);
  const expiredOut = await count("out", outCutoff);

  let clearedIn = 0, clearedOut = 0;
  if (confirm) {
    const r1 = await db.from("messages").update({ media_url: null })
      .eq("direction", "in").not("media_url", "is", null).lt("sent_at", inCutoff).select("id");
    clearedIn = r1.data?.length ?? 0;
    const r2 = await db.from("messages").update({ media_url: null })
      .eq("direction", "out").not("media_url", "is", null).lt("sent_at", outCutoff).select("id");
    clearedOut = r2.data?.length ?? 0;
  }

  return json({
    policy: { in_days: IN_DAYS, out_days: OUT_DAYS },
    expired: { in: expiredIn, out: expiredOut },
    confirmed: confirm,
    cleared: confirm ? { in: clearedIn, out: clearedOut } : null,
    note: "Limpa a referência (media_url) no DB. Apagar os bytes exige storage no Supabase/S3 (migrar anexos do Chatwoot).",
  });
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
