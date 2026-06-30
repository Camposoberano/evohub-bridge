// ryzeapi — proxy autenticado pro dashboard operar instâncias RyzeAPI (provedor
// alternativo de WhatsApp não-oficial, igual ao uazapi). Browser manda { action, instance,
// ...params }; o bridge resolve o token da instância e chama a RyzeAPI. Tokens nunca vão
// pro browser. Espelha handlers/uazapi.ts.
//
// Saída (atendente -> cliente): ponte nativa RyzeAPI->Chatwoot (chatwoot_set) -- funciona
// bem pra isso (achado testando).
// Entrada (cliente -> atendente): NÃO pela ponte nativa (não cria conversa de forma
// confiável -- bug achado testando). Webhook desta instância aponta pro nosso
// /ryzeapi-webhook (ingestInbound), que precisa de uma linha em `channels` com
// external_id=<nome da instância> + chatwoot_inbox_identifier da MESMA inbox que a ponte
// nativa usa (senão a entrada cria uma 2ª conversa em vez de continuar a do atendente).
import { env, optionalEnv } from "../shared/env.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { acctPost, instDelete, instGet, instPost, listInstances, ryzeapiConfigured, tokenForInstance } from "../shared/ryzeapi.ts";
import { findInboxByName, type CwAcct } from "../shared/chatwoot.ts";
import { acctByKey } from "../shared/accounts.ts";
import { admin } from "../shared/supabase.ts";

type Json = Record<string, unknown>;

// Liga a saída ryzeapi->Chatwoot (ponte nativa deles) + acha a inbox criada por ela pra
// gravar o inbox_identifier no nosso `channels` (entrada usa essa mesma inbox via webhook próprio).
async function applyChatwootConfig(instance: string, token: string, acct: CwAcct, inboxName: string, extra: Json = {}): Promise<Json> {
  const merged = {
    chatwootBaseUrl: acct.url,
    chatwootAccountId: Number(acct.accountId),
    chatwootApiToken: acct.adminToken ?? acct.token,
    inboxName,
    signMessages: extra.signMessages ?? false,
    ignoreGroups: extra.ignoreGroups ?? true,
    startAsPending: extra.startAsPending ?? false,
    reopenResolved: extra.reopenResolved ?? false,
  };
  const set = await instPost(`/chatwoot/set/${encodeURIComponent(instance)}`, token, merged);
  if (!set.ok) return { ok: false, status: set.status, reason: set.data };

  // a ponte nativa cria a inbox no Chatwoot por baixo (pode levar um instante) -- busca por nome.
  let inbox = await findInboxByName(inboxName, acct).catch(() => null);
  if (!inbox) { await sleep(2000); inbox = await findInboxByName(inboxName, acct).catch(() => null); }

  const db = admin();
  await db.from("channels").upsert({
    type: "whatsapp",
    name: inboxName,
    external_id: instance,
    status: "active",
    chatwoot_inbox_id: inbox?.id ?? null,
    chatwoot_inbox_identifier: inbox?.inbox_identifier ?? null,
  }, { onConflict: "external_id" });

  return { ok: true, config: set.data, inbox };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!ryzeapiConfigured()) return json({ error: "ryzeapi não configurado (RYZEAPI_ACCOUNT_TOKEN)" }, 503);

  const userClient = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({})) as Json;
  const action = body.action as string;
  const instance = body.instance as string | undefined;

  try {
    if (action === "instances") {
      const list = await listInstances();
      return json({ instances: list.map(({ token: _t, ...rest }) => rest) });
    }
    if (action === "create") {
      return passthru(await acctPost("/instance/new", { name: body.name }));
    }

    if (!instance) return json({ error: "instance obrigatório" }, 400);
    const token = await tokenForInstance(instance);
    if (!token) return json({ error: "instância não encontrada" }, 404);

    switch (action) {
      case "status":
        return passthru(await instGet(`/instance/list?instanceName=${encodeURIComponent(instance)}`, token));
      case "connect": {
        const q = body.number ? `?number=${encodeURIComponent(body.number as string)}` : "";
        return passthru(await instGet(`/instance/connect/${encodeURIComponent(instance)}${q}`, token));
      }
      case "disconnect":
        return passthru(await instDelete(`/instance/logout/${encodeURIComponent(instance)}`, token));
      case "delete":
        return passthru(await instDelete(`/instance/${encodeURIComponent(instance)}`, token));
      case "send_text":
        return passthru(await instPost(`/message/text/${encodeURIComponent(instance)}`, token, { number: body.number, message: body.message }));

      // ── entrada: liga esta instância no nosso /ryzeapi-webhook (ingestInbound) ──────
      case "set_webhook": {
        const base = env("BRIDGE_PUBLIC_BASE").replace(/\/+$/, "");
        const wtoken = optionalEnv("RYZEAPI_WEBHOOK_TOKEN") ?? env("CHATWOOT_WEBHOOK_SECRET");
        const hookUrl = `${base}/ryzeapi-webhook?token=${encodeURIComponent(wtoken)}`;
        return passthru(await instPost(`/events/webhook/${encodeURIComponent(instance)}`, token, {
          enabled: true,
          url: hookUrl,
          events: ["message.exchange"],
          mediaBase64: true,
        }));
      }
      case "webhook_get":
        return passthru(await instGet(`/events/webhook/${encodeURIComponent(instance)}`, token));

      // ── saída: ponte nativa ryzeapi->Chatwoot (igual uazapi) ────────────────────────
      case "chatwoot_set": {
        const contaKey = body.conta as string | undefined;
        const acct = contaKey ? await acctByKey(contaKey) : undefined;
        if (!acct) return json({ error: "conta obrigatória" }, 400);
        const inboxName = (body.inboxName as string) || instance;
        const r = await applyChatwootConfig(instance, token, acct, inboxName, (body.config ?? {}) as Json);
        return json(r, r.ok ? 200 : (r.status as number ?? 502));
      }
      case "chatwoot_get":
        return passthru(await instGet(`/instance/list?instanceName=${encodeURIComponent(instance)}`, token));

      default:
        return json({ error: "ação desconhecida: " + action }, 400);
    }
  } catch (e) {
    return json({ error: String(e) }, 502);
  }
}

function passthru(r: { ok: boolean; status: number; data: unknown }): Response {
  return json(r.data as Json, r.ok ? 200 : r.status);
}
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
