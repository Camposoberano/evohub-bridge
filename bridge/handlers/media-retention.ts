// media-retention — limpa o bucket de mídia do Chatwoot (Supabase Storage) por idade.
// Apaga objetos mais velhos que MEDIA_RETENTION_DAYS (default 365).
// Seguro por padrão: só apaga de verdade com ?confirm=1 OU MEDIA_RETENTION_ENABLED=true.
// Lista/apaga via service role (Storage REST) — não precisa das chaves S3 aqui.
// Auth: token de cron (?token=) OU JWT do dashboard.
import { admin } from "../shared/supabase.ts";
import { env, optionalEnv } from "../shared/env.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUCKET = optionalEnv("MEDIA_BUCKET") ?? "chatwoot-media";
const DAYS = Number(optionalEnv("MEDIA_RETENTION_DAYS") ?? "365");

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const cronToken = optionalEnv("SYNC_SECRET") ?? env("CHATWOOT_WEBHOOK_SECRET");
  let authed = timingSafeEqual(token, cronToken);
  if (!authed) {
    const uc = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false },
    });
    authed = Boolean((await uc.auth.getUser()).data?.user);
  }
  if (!authed) return json({ error: "unauthorized" }, 401);

  const confirm = url.searchParams.get("confirm") === "1" || optionalEnv("MEDIA_RETENTION_ENABLED") === "true";
  const cutoff = Date.now() - DAYS * 86_400_000;
  // deno-lint-ignore no-explicit-any
  const storage = (admin() as any).storage.from(BUCKET);

  let offset = 0, scanned = 0, expired = 0, removed = 0;
  const toDelete: string[] = [];
  for (let page = 0; page < 200; page++) {
    const { data, error } = await storage.list("", { limit: 1000, offset, sortBy: { column: "created_at", order: "asc" } });
    if (error) return json({ error: error.message }, 500);
    const items = (data ?? []) as { name: string; created_at?: string }[];
    if (items.length === 0) break;
    for (const it of items) {
      scanned++;
      const created = it.created_at ? Date.parse(it.created_at) : NaN;
      if (Number.isFinite(created) && created < cutoff) { expired++; toDelete.push(it.name); }
    }
    offset += items.length;
    if (items.length < 1000) break;
  }

  if (confirm && toDelete.length) {
    for (let i = 0; i < toDelete.length; i += 100) {
      const { data } = await storage.remove(toDelete.slice(i, i + 100));
      removed += (data?.length ?? 0);
    }
  }

  return json({ bucket: BUCKET, retention_days: DAYS, scanned, expired, confirmed: confirm, removed });
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
