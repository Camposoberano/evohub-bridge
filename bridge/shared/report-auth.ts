// report-auth — auth compartilhada pros endpoints de relatório/rollup que hoje são públicos
// (defeito 9 da auditoria de mensagens 08/2026: /relatorio e /metrics-rollup sem nenhuma
// checagem, servindo transcrição de conversa e nome de cliente pra qualquer requisição).
//
// Mesmo padrão já usado em media-retention.ts: aceita token de cron (?token=, o mesmo
// CHATWOOT_WEBHOOK_SECRET/SYNC_SECRET usado pelos loops internos) OU um JWT de usuário
// autenticado do Supabase (dashboard). Extraído aqui pra não duplicar em cada handler.
import { env, optionalEnv } from "./env.ts";
import { timingSafeEqual } from "./hmac.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function cronToken(): string {
  return optionalEnv("SYNC_SECRET") ?? env("CHATWOOT_WEBHOOK_SECRET");
}

export async function isAuthedCronOrUser(req: Request, url: URL): Promise<boolean> {
  const token = url.searchParams.get("token") ?? "";
  if (timingSafeEqual(token, cronToken())) return true;

  const uc = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  return Boolean((await uc.auth.getUser()).data?.user);
}
