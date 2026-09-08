// media-retention — limpa o bucket de mídia do Chatwoot (Supabase Storage) por idade.
// Apaga objetos mais velhos que MEDIA_RETENTION_DAYS (default 365).
// Seguro por padrão: só apaga de verdade com ?confirm=1 OU MEDIA_RETENTION_ENABLED=true.
// Lista/apaga via service role (Storage REST) — não precisa das chaves S3 aqui.
// Auth: token de cron (?token=) OU JWT do dashboard.
import { confereSegredo } from "../shared/segredo-bridge.ts";
import { admin } from "../shared/supabase.ts";
import { env, optionalEnv } from "../shared/env.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Dois buckets crescem: `chatwoot-media` (o que recebemos) e `soberano-out` (o que geramos
// pra enviar -- PTT em ogg). O segundo ficou de fora até 08/09 e sozinho passava de 5 GB.
const BUCKETS = (optionalEnv("MEDIA_RETENTION_BUCKETS") ??
  optionalEnv("MEDIA_BUCKET") ?? "chatwoot-media,soberano-out")
  .split(",").map((b) => b.trim()).filter(Boolean);
const DAYS = Number(optionalEnv("MEDIA_RETENTION_DAYS") ?? "365");

type Alvo = { scanned: number; paths: string[] };

/**
 * Junta os expirados de um prefixo, descendo nas pastas.
 *
 * O `list("")` do Supabase NÃO é recursivo: devolve a pasta como uma entrada sem `id` e sem
 * `created_at`, e o conteúdo dela fica invisível. Era o suficiente pra `soberano-out` passar
 * ileso por qualquer limpeza — 91% dele vive sob `ptt/`.
 */
async function coletarExpirados(
  // deno-lint-ignore no-explicit-any
  storage: any,
  prefixo: string,
  cutoff: number,
  alvo: Alvo,
  profundidade = 0,
): Promise<void> {
  let offset = 0;
  for (let page = 0; page < 200; page++) {
    const { data, error } = await storage.list(prefixo, {
      limit: 1000,
      offset,
      sortBy: { column: "created_at", order: "asc" },
    });
    if (error) throw new Error(error.message);
    const items = (data ?? []) as {
      id?: string | null;
      name: string;
      created_at?: string;
    }[];
    if (items.length === 0) break;
    for (const it of items) {
      const caminho = prefixo ? `${prefixo}/${it.name}` : it.name;
      // pasta: sem id. Desce até 2 níveis -- o suficiente pra ptt/ sem varrer o mundo.
      if (!it.id) {
        if (profundidade < 2) {
          await coletarExpirados(storage, caminho, cutoff, alvo, profundidade + 1);
        }
        continue;
      }
      alvo.scanned++;
      const criado = it.created_at ? Date.parse(it.created_at) : NaN;
      if (Number.isFinite(criado) && criado < cutoff) alvo.paths.push(caminho);
    }
    offset += items.length;
    if (items.length < 1000) break;
  }
}

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const cronToken = optionalEnv("SYNC_SECRET") ?? env("CHATWOOT_WEBHOOK_SECRET");
  let authed = confereSegredo(token, [cronToken], "media-retention");
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

  const porBucket: Record<string, unknown>[] = [];
  let scanned = 0, expired = 0, removed = 0;
  for (const bucket of BUCKETS) {
    // deno-lint-ignore no-explicit-any
    const storage = (admin() as any).storage.from(bucket);
    const alvo: Alvo = { scanned: 0, paths: [] };
    try {
      await coletarExpirados(storage, "", cutoff, alvo);
    } catch (e) {
      // Um bucket que falha não pode impedir a limpeza dos outros: o disco enche igual.
      porBucket.push({ bucket, erro: String(e).slice(0, 140) });
      continue;
    }
    let apagados = 0;
    if (confirm && alvo.paths.length) {
      for (let i = 0; i < alvo.paths.length; i += 100) {
        const { data } = await storage.remove(alvo.paths.slice(i, i + 100));
        apagados += (data?.length ?? 0);
      }
    }
    scanned += alvo.scanned;
    expired += alvo.paths.length;
    removed += apagados;
    porBucket.push({ bucket, scanned: alvo.scanned, expired: alvo.paths.length, removed: apagados });
  }

  return json({ buckets: porBucket, retention_days: DAYS, scanned, expired, confirmed: confirm, removed });
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
