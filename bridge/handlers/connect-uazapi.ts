// connect-uazapi — liga um número novo da uazapi ao bridge em UMA chamada, e diz quais
// números já estão prontos.
//
// Por que existe: até aqui, conectar um número era um roteiro de cinco passos com três
// deles manuais, e quem esquecia o passo 3 (a linha em `channels`) não recebia erro nenhum
// -- o webhook chegava, não achava canal e descartava a mensagem do cliente em silêncio.
// O número parecia conectado no Chatwoot e não respondia a nenhuma macro, porque o
// funil-control não consegue resolver canal sem essa linha.
//
// Espelha o que /connect-channel já fazia para os canais Meta. Dois modos:
//
//   GET  /connect-uazapi?token=   -> relatório de prontidão de TODAS as instâncias
//   POST /connect-uazapi?token=   -> { instance, name?, account_id? } provisiona uma
//
// O GET não escreve nada: serve pro painel mostrar o que falta antes de alguém perguntar.
import { confereSegredo } from "../shared/segredo-bridge.ts";
import { admin } from "../shared/supabase.ts";
import { env, optionalEnv } from "../shared/env.ts";
import {
  instGet,
  instPost,
  listInstances,
  tokenForInstance,
  uazapiConfigured,
} from "../shared/uazapi.ts";
import {
  createApiInbox,
  type CwAcct,
  envAcct,
  setInboxWebhook,
} from "../shared/chatwoot.ts";
import { acctByKey } from "../shared/accounts.ts";
import { ehNossoWebhook, tokenDoWebhook } from "../shared/webhook-url.ts";

type Json = Record<string, unknown>;
type Db = ReturnType<typeof admin>;

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function baseUrl(): string {
  return env("BRIDGE_PUBLIC_BASE").replace(/\/+$/, "");
}

/** Token que a uazapi e o Chatwoot devem apresentar ao bridge. */
function tokenDeEntrada(): string {
  return optionalEnv("UAZAPI_WEBHOOK_TOKEN") ?? env("CHATWOOT_WEBHOOK_SECRET");
}

function urlWebhookUazapi(): string {
  return `${baseUrl()}/uazapi-webhook?token=${
    encodeURIComponent(tokenDeEntrada())
  }`;
}

function urlWebhookInbox(): string {
  return `${baseUrl()}/chatwoot-webhook?token=${
    encodeURIComponent(env("CHATWOOT_WEBHOOK_SECRET"))
  }`;
}


export type ProntidaoInstancia = {
  instance: string;
  numero: string | null;
  status: string;
  pronto: boolean;
  canal_id: string | null;
  chatwoot_inbox_id: number | null;
  webhook_uazapi: "ok" | "segredo-antigo" | "ausente" | "erro";
  webhook_inbox: "ok" | "segredo-antigo" | "ausente" | "sem-inbox";
  faltando: string[];
};

/** Canal pelo mesmo critério do webhook: external_id primeiro, depois nome. */
async function canalDaInstancia(db: Db, instancia: string): Promise<Json | null> {
  const { data: porExternal } = await db.from("channels").select("*")
    .eq("external_id", instancia).maybeSingle();
  if (porExternal) return porExternal as Json;
  const { data: porNome } = await db.from("channels").select("*")
    .eq("name", instancia).maybeSingle();
  return (porNome as Json) ?? null;
}

async function estadoWebhookUazapi(
  token: string,
): Promise<{ estado: ProntidaoInstancia["webhook_uazapi"]; idsAntigos: string[] }> {
  const r = await instGet("/webhook", token);
  if (!r.ok) return { estado: "erro", idsAntigos: [] };
  const lista = Array.isArray(r.data)
    ? r.data as Json[]
    : ((r.data as Json)?.webhooks as Json[] ?? []);
  const nossos = lista.filter((w) =>
    ehNossoWebhook(w.url, "/uazapi-webhook", baseUrl()) && w.enabled !== false
  );
  if (nossos.length === 0) return { estado: "ausente", idsAntigos: [] };
  const atual = nossos.find((w) => tokenDoWebhook(w.url) === tokenDeEntrada());
  const antigos = nossos
    .filter((w) => tokenDoWebhook(w.url) !== tokenDeEntrada())
    .map((w) => String(w.id ?? ""))
    .filter(Boolean);
  return { estado: atual ? "ok" : "segredo-antigo", idsAntigos: antigos };
}

async function estadoWebhookInbox(
  canal: Json | null,
  acct: CwAcct,
): Promise<ProntidaoInstancia["webhook_inbox"]> {
  const inboxId = canal?.chatwoot_inbox_id as number | undefined;
  if (!inboxId) return "sem-inbox";
  const base = acct.url.replace(/\/+$/, "");
  const res = await fetch(
    `${base}/api/v1/accounts/${acct.accountId}/inboxes/${inboxId}`,
    { headers: { api_access_token: acct.adminToken ?? acct.token } },
  );
  if (!res.ok) return "ausente";
  const inbox = await res.json() as Json;
  const url = inbox.webhook_url ?? (inbox.channel as Json)?.webhook_url;
  if (!ehNossoWebhook(url, "/chatwoot-webhook", baseUrl())) return "ausente";
  return tokenDoWebhook(url) === env("CHATWOOT_WEBHOOK_SECRET")
    ? "ok"
    : "segredo-antigo";
}

/** Relatório de prontidão. Só lê — nenhum efeito colateral. */
export async function relatorioProntidao(
  db: Db,
  acct: CwAcct,
): Promise<ProntidaoInstancia[]> {
  const instancias = await listInstances();
  const saida: ProntidaoInstancia[] = [];
  for (const inst of instancias) {
    const canal = await canalDaInstancia(db, inst.name);
    const hook = await estadoWebhookUazapi(inst.token);
    const inboxHook = await estadoWebhookInbox(canal, acct);
    const faltando: string[] = [];
    if (!canal) faltando.push("linha em channels");
    if (hook.estado !== "ok") faltando.push(`webhook uazapi: ${hook.estado}`);
    if (inboxHook !== "ok") faltando.push(`webhook da inbox: ${inboxHook}`);
    saida.push({
      instance: inst.name,
      numero: inst.number,
      status: inst.status,
      pronto: faltando.length === 0,
      canal_id: (canal?.id as string) ?? null,
      chatwoot_inbox_id: (canal?.chatwoot_inbox_id as number) ?? null,
      webhook_uazapi: hook.estado,
      webhook_inbox: inboxHook,
      faltando,
    });
  }
  return saida;
}

/**
 * Provisiona uma instância: canal + inbox + os dois webhooks.
 *
 * Idempotente de propósito — rodar duas vezes no mesmo número não duplica nada. Quem chama
 * isso costuma estar consertando algo pela metade, não começando do zero.
 */
async function provisionar(
  db: Db,
  instancia: string,
  nome: string,
  acct: CwAcct,
): Promise<Json> {
  const token = await tokenForInstance(instancia);
  if (!token) throw new Error(`instância "${instancia}" não existe na uazapi`);

  const passos: string[] = [];

  // 1) canal
  let canal = await canalDaInstancia(db, instancia);
  if (!canal) {
    const { data, error } = await db.from("channels").insert({
      type: "whatsapp",
      name: nome,
      // external_id = nome da instância: é por ele que o uazapi-webhook resolve o canal.
      external_id: instancia,
      status: "active",
    }).select().single();
    if (error) throw new Error(`channels: ${error.message}`);
    canal = data as Json;
    passos.push("canal criado");
  } else {
    passos.push("canal já existia");
  }

  // 2) inbox no Chatwoot, já nascendo com o webhook apontado pro bridge
  let inboxId = canal.chatwoot_inbox_id as number | undefined;
  if (!inboxId) {
    const inbox = await createApiInbox(nome, urlWebhookInbox(), acct);
    inboxId = inbox.id;
    await db.from("channels").update({
      chatwoot_inbox_id: inbox.id,
      chatwoot_inbox_identifier: inbox.inbox_identifier,
    }).eq("id", canal.id as string);
    passos.push(`inbox ${inbox.id} criada`);
  } else {
    // Inbox existente pode estar apontada pra uazapi (integração nativa) em vez do bridge.
    // Nesse estado o número conversa no Chatwoot e o funil nunca vê a mensagem.
    const r = await setInboxWebhook(
      acct.accountId,
      inboxId,
      urlWebhookInbox(),
      acct,
    );
    passos.push(r.ok ? `inbox ${inboxId} reapontada` : `inbox ${inboxId}: ${r.status}`);
  }

  // 3) webhook da uazapi -> bridge. A API não edita: cria o novo, confirma, remove o velho.
  //    Mandar o objeto aninhado responde 200 e ZERA o registro (ver memória uazapi-webhook-api).
  const antes = await estadoWebhookUazapi(token);
  if (antes.estado !== "ok") {
    const add = await instPost("/webhook", token, {
      action: "add",
      url: urlWebhookUazapi(),
      enabled: true,
      events: ["messages", "messages_update", "connection"],
      excludeMessages: ["wasSentByApi"],
    });
    if (!add.ok) throw new Error(`webhook uazapi: ${add.status}`);
    passos.push("webhook uazapi criado");
    const depois = await estadoWebhookUazapi(token);
    if (depois.estado === "ok") {
      for (const id of antes.idsAntigos) {
        await instPost("/webhook", token, { action: "delete", id });
        passos.push(`webhook antigo ${id} removido`);
      }
    }
  } else {
    passos.push("webhook uazapi já correto");
  }

  return {
    ok: true,
    instance: instancia,
    channel_id: canal.id,
    chatwoot_inbox_id: inboxId,
    passos,
  };
}

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (
    !confereSegredo(
      url.searchParams.get("token"),
      [env("CHATWOOT_WEBHOOK_SECRET")],
      "connect-uazapi",
    )
  ) {
    return json({ error: "unauthorized" }, 401);
  }
  if (!uazapiConfigured()) {
    return json({ error: "uazapi não configurada" }, 503);
  }

  const db = admin();
  try {
    if (req.method === "GET") {
      const acct = envAcct();
      const instancias = await relatorioProntidao(db, acct);
      return json({
        total: instancias.length,
        prontas: instancias.filter((i) => i.pronto).length,
        pendentes: instancias.filter((i) => !i.pronto),
        instancias,
      });
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({})) as Json;
      const instancia = String(body.instance ?? "").trim();
      if (!instancia) return json({ error: "instance é obrigatório" }, 400);
      const nome = String(body.name ?? "").trim() || instancia;
      const contaId = String(body.account_id ?? "").trim();
      const acct = contaId ? await acctByKey(contaId) : envAcct();
      return json(await provisionar(db, instancia, nome, acct), 201);
    }

    return json({ error: "method not allowed" }, 405);
  } catch (e) {
    // String(e) e não e.message: erro-objeto do Supabase vira "[object Object]" e some a causa.
    return json({ error: String(e).slice(0, 300) }, 500);
  }
}
