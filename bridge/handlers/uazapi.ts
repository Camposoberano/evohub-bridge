// uazapi — proxy autenticado pro dashboard operar o WhatsApp não-oficial.
// O browser manda { action, instance, ...params }; o bridge resolve o token da
// instância e chama a uazapi. Tokens nunca vão pro browser.
// Auth: JWT do usuário do dashboard.
import { env, optionalEnv } from "../shared/env.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { adminPost, instDelete, instGet, instPost, instPut, listInstances, tokenForInstance, uazapiConfigured } from "../shared/uazapi.ts";
import { addInboxMembers, createApiInbox, type CwAcct, envAcct, profileId, setInboxWebhook } from "../shared/chatwoot.ts";
import { acctByKey } from "../shared/accounts.ts";
import { admin } from "../shared/supabase.ts";

const ASSIGN_BUCKET = "soberano-config";
const ASSIGN_FILE = "instance-telas.json";
// deno-lint-ignore no-explicit-any
async function readAssign(): Promise<Record<string, string>> {
  const { data } = await (admin() as any).storage.from(ASSIGN_BUCKET).download(ASSIGN_FILE);
  if (!data) return {};
  try { return JSON.parse(await data.text()); } catch { return {}; }
}
async function writeAssign(obj: Record<string, string>) {
  const blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
  // deno-lint-ignore no-explicit-any
  await (admin() as any).storage.from(ASSIGN_BUCKET).upload(ASSIGN_FILE, blob, { upsert: true, contentType: "application/json" });
}

// Liga a saída Chatwoot→uazapi: configura o webhook esperado na inbox do Chatwoot.
async function syncChatwootWebhook(token: string, acct: CwAcct = envAcct()): Promise<Json> {
  const cfg = await instGet("/chatwoot/config", token);
  const d = (cfg.data ?? {}) as Json;
  const url = (d.expected_webhook_url ?? (d.integration_status as Json)?.expected_webhook_url) as string | undefined;
  const account = d.chatwoot_account_id as number | undefined;
  const inbox = d.chatwoot_inbox_id as number | undefined;
  if (!url || !account || !inbox) return { ok: false, reason: "config Chatwoot incompleta no uazapi" };
  const r = await setInboxWebhook(account, inbox, url, acct);
  return { ok: r.ok, status: r.status, webhook: url };
}

// Liga a instância uazapi à CONTA Chatwoot (multi-cliente): garante uma inbox API na conta,
// torna o agente membro (visibilidade), seta a config no uazapi e o webhook de saída.
// Schema uazapi descoberto: account_id é NÚMERO, inbox_id NÚMERO; criar inbox exige admin.
async function applyChatwootConfig(token: string, acct: CwAcct, extra: Json = {}, inboxName = "WhatsApp"): Promise<Json> {
  // 1) inbox: usa a já configurada se existir/válida; senão cria + adiciona o agente.
  const cur = (await instGet("/chatwoot/config", token)).data as Json;
  let inboxId = Number(extra.inbox_id ?? cur.chatwoot_inbox_id ?? 0);
  const exists = (cur.integration_status as Json)?.inbox_exists === true;
  if (!inboxId || !exists) {
    const inbox = await createApiInbox(inboxName, "", acct); // webhook setado depois (uazapi)
    inboxId = inbox.id;
    const uid = await profileId(acct);
    if (uid) await addInboxMembers(acct.accountId, inboxId, [uid], acct);
  }
  // 2) config no uazapi
  const merged = {
    enabled: extra.enabled ?? true,
    url: acct.url,
    access_token: acct.token,
    account_id: Number(acct.accountId),
    inbox_id: inboxId,
    sign_messages: extra.sign_messages ?? false,
    create_new_conversation: extra.create_new_conversation ?? true,
    ignore_groups: extra.ignore_groups ?? true,
  };
  const put = await instPut("/chatwoot/config", token, merged);
  // 3) webhook de saída (Chatwoot inbox → uazapi)
  const hook = await syncChatwootWebhook(token, acct).catch((e) => ({ ok: false, reason: String(e) }));
  return { config: put.data, ok: put.ok, status: put.status, inbox_id: inboxId, webhook_sync: hook };
}

async function disableChatwootConfig(token: string): Promise<Json> {
  const cur = (await instGet("/chatwoot/config", token)).data as Json;
  if (!cur || typeof cur !== "object" || Object.keys(cur).length === 0) {
    return { ok: false, reason: "config Chatwoot não encontrada" };
  }
  const put = await instPut("/chatwoot/config", token, { ...cur, enabled: false });
  return { ok: put.ok, status: put.status, config: put.data };
}

type Json = Record<string, unknown>;

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!uazapiConfigured()) return json({ error: "uazapi não configurado (UAZAPI_URL/UAZAPI_ADMIN_TOKEN)" }, 503);

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
    // Ações que não precisam de instância (admin)
    if (action === "instances") {
      const list = await listInstances();
      // não devolve token pro browser
      return json({ instances: list.map(({ token: _t, ...rest }) => rest) });
    }
    if (action === "create") {
      return passthru(await adminPost("/instance/create", { name: body.name }));
    }
    if (action === "restart_api") {
      return passthru(await adminPost("/admin/restart", {}));
    }
    if (action === "assign_get") {
      return json({ assign: await readAssign() });
    }
    if (action === "assign_set") {
      const cur = await readAssign();
      const inst = body.instance as string | undefined;
      let cwResult: Json | null = null;
      if (inst) {
        const tok = await tokenForInstance(inst);
        if (body.conta) {
          cur[inst] = body.conta as string;
          // auto: configura uazapi→Chatwoot na CONTA da tela (sem depender de outra ação).
          try {
            if (tok) { const acct = await acctByKey(body.conta as string); cwResult = await applyChatwootConfig(tok, acct, {}, inst); }
          } catch (e) { cwResult = { ok: false, reason: String(e) }; }
        } else {
          delete cur[inst];
          // Se desassociou a instância de uma tela, desliga o Chatwoot nela para evitar
          // recriação automática de inboxes antigos no próximo boot.
          try {
            if (tok) cwResult = await disableChatwootConfig(tok);
          } catch (e) { cwResult = { ok: false, reason: String(e) }; }
        }
      }
      await writeAssign(cur);
      return json({ ok: true, assign: cur, chatwoot: cwResult });
    }

    // Demais ações precisam do token da instância
    if (!instance) return json({ error: "instance obrigatório" }, 400);
    const token = await tokenForInstance(instance);
    if (!token) return json({ error: "instância não encontrada" }, 404);

    switch (action) {
      case "status":
        return passthru(await instGet("/instance/status", token));
      case "connect":
        return passthru(await instPost("/instance/connect", token, { phone: body.phone ?? undefined }));
      case "disconnect":
        return passthru(await instPost("/instance/disconnect", token, {}));
      case "check": {
        const numbers = (body.numbers ?? []) as string[];
        return passthru(await instPost("/chat/check", token, { numbers }));
      }
      case "send_text":
        return passthru(await instPost("/send/text", token, { number: body.number, text: body.text, delay: body.delay }));
      case "campaign": {
        // disparo em massa com espaçamento (sender/simple). Um passo da timeline.
        const payload: Json = {
          numbers: body.numbers ?? [],
          type: body.type ?? "text",
          text: body.text,
          file: body.file,
          delayMin: body.delayMin ?? 60,
          delayMax: body.delayMax ?? 180,
          scheduled_for: body.scheduled_for ?? 0,
          info: body.info,
        };
        // campos extra p/ botões/listas/enquete/documento/presença
        for (const k of ["choices", "buttonText", "footerText", "listButton", "docName", "imageButton", "selectableCount", "delay"]) {
          if (body[k] !== undefined) payload[k] = body[k];
        }
        return passthru(await instPost("/sender/simple", token, payload));
      }
      case "campaigns_list":
        return passthru(await instGet("/sender/listfolders", token));
      case "campaign_carousel": {
        // carrossel não existe no sender em massa — loop /send/carousel (cap 1000, async).
        const numbers = ((body.numbers ?? []) as string[]).slice(0, 1000);
        const text = body.text ?? "";
        const carousel = body.carousel ?? [];
        let ok = 0;
        for (const n of numbers) {
          const r = await instPost("/send/carousel", token, { number: n, text, carousel, async: true });
          if (r.ok) ok++;
        }
        return json({ ok: true, sent: ok, total: numbers.length });
      }

      // ── monitor de eventos: aponta a instância pro nosso receptor ────────
      case "set_webhook": {
        const base = env("BRIDGE_PUBLIC_BASE").replace(/\/+$/, "");
        const wtoken = optionalEnv("UAZAPI_WEBHOOK_TOKEN") ?? env("CHATWOOT_WEBHOOK_SECRET");
        const hookUrl = `${base}/uazapi-webhook?token=${encodeURIComponent(wtoken)}`;
        return passthru(await instPost("/webhook", token, { url: hookUrl, enabled: true, action: "add" }));
      }
      case "webhook_get":
        return passthru(await instGet("/webhook", token));

      // ── Fase 4: contatos / bloqueios / etiquetas / CRM ──────────────────
      case "contacts":
        return passthru(await instGet("/contacts", token));
      case "contact_add":
        return passthru(await instPost("/contact/add", token, { number: body.number, name: body.name }));
      case "contact_remove":
        return passthru(await instPost("/contact/remove", token, { number: body.number }));
      case "contact_details":
        return passthru(await instPost("/chat/details", token, { number: body.number }));
      case "block":
        return passthru(await instPost("/chat/block", token, { number: body.number, action: body.block ? "block" : "unblock" }));
      case "blocklist":
        return passthru(await instGet("/chat/blocklist", token));
      case "labels":
        return passthru(await instGet("/labels", token));
      case "label_edit":
        return passthru(await instPost("/label/edit", token, body.label ?? {}));
      case "chat_labels":
        return passthru(await instPost("/chat/labels", token, { number: body.number, labelIds: body.labelIds, action: body.action }));
      case "label_bulk": {
        // aplica etiqueta a vários números (quem recebeu o disparo). Cap 2000 por chamada.
        const numbers = ((body.numbers ?? []) as string[]).slice(0, 2000);
        const labelIds = body.labelIds;
        let ok = 0;
        for (const n of numbers) {
          const r = await instPost("/chat/labels", token, { number: n, labelIds, action: "add" });
          if (r.ok) ok++;
        }
        return json({ ok: true, applied: ok, total: numbers.length });
      }
      case "block_filter": {
        // retorna os números que NÃO estão bloqueados.
        const numbers = (body.numbers ?? []) as string[];
        const bl = await instGet("/chat/blocklist", token);
        const raw = JSON.stringify(bl.data ?? {});
        const blocked = new Set((raw.match(/\d{12,}/g) ?? []));
        return json({ allowed: numbers.filter((n) => !blocked.has(n)), removed: numbers.filter((n) => blocked.has(n)).length });
      }
      case "crm_fields":
        return passthru(await instPost("/instance/updateFieldsMap", token, body.fields ?? {}));
      case "edit_lead":
        return passthru(await instPost("/chat/editLead", token, body.lead ?? {}));

      // ── Fase 5: grupos e canais ─────────────────────────────────────────
      case "groups_list":
        return passthru(await instGet("/group/list", token));
      case "group_create":
        return passthru(await instPost("/group/create", token, { name: body.name, participants: body.participants ?? [] }));
      case "group_info":
        return passthru(await instPost("/group/info", token, { groupjid: body.groupjid }));
      case "group_leave":
        return passthru(await instPost("/group/leave", token, { groupjid: body.groupjid }));
      case "newsletters_list":
        return passthru(await instGet("/newsletter/list", token));
      case "newsletter_create":
        return passthru(await instPost("/newsletter/create", token, { name: body.name, description: body.description }));

      // ── controle de instância ───────────────────────────────────────────
      case "restart_instance":
        return passthru(await instPost("/instance/reset", token, {}));
      case "rename":
        return passthru(await instPost("/instance/updateInstanceName", token, { name: body.name }));
      case "delete":
        return passthru(await instDelete("/instance", token, {}));
      case "limits":
        return passthru(await instGet("/instance/wa_messages_limits", token));
      case "presence":
        return passthru(await instPost("/instance/presence", token, { presence: body.presence ?? "available" }));
      case "privacy_get":
        return passthru(await instGet("/instance/privacy", token));

      // ── proxy ───────────────────────────────────────────────────────────
      case "proxy_get":
        return passthru(await instGet("/instance/proxy", token));
      case "proxy_set":
        return passthru(await instPost("/instance/proxy", token, body.proxy ?? {}));
      case "proxy_cities":
        return passthru(await instGet("/proxy-managed/cities", token));

      // ── Chatwoot nativo ─────────────────────────────────────────────────
      case "chatwoot_get":
        return passthru(await instGet("/chatwoot/config", token));
      case "chatwoot_set": {
        // Conta = a tela atribuída à instância (multi-cliente); url/token vêm da conta, não do env.
        const cfg = (body.config ?? {}) as Json;
        const assign = await readAssign();
        const contaKey = (body.conta as string) ?? assign[instance];
        const acct = contaKey ? await acctByKey(contaKey) : envAcct();
        const r = await applyChatwootConfig(token, acct, cfg, instance);
        return json(r, r.ok ? 200 : (r.status as number));
      }
      case "chatwoot_webhook_sync":
        return json(await syncChatwootWebhook(token));

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
