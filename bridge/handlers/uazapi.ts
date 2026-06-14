// uazapi — proxy autenticado pro dashboard operar o WhatsApp não-oficial.
// O browser manda { action, instance, ...params }; o bridge resolve o token da
// instância e chama a uazapi. Tokens nunca vão pro browser.
// Auth: JWT do usuário do dashboard.
import { env, optionalEnv } from "../shared/env.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { adminPost, instDelete, instGet, instPost, instPut, listInstances, tokenForInstance, uazapiConfigured } from "../shared/uazapi.ts";

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
        // url/token/conta vêm do env (não trafegam pelo browser); só inbox_id/flags vêm da UI.
        const cfg = (body.config ?? {}) as Json;
        const merged = {
          enabled: cfg.enabled ?? true,
          url: env("CHATWOOT_URL"),
          access_token: optionalEnv("CHATWOOT_API_ACCESS_TOKEN") ?? "",
          account_id: optionalEnv("CHATWOOT_ACCOUNT_ID") ?? "",
          inbox_id: cfg.inbox_id ?? "",
          sign_messages: cfg.sign_messages ?? false,
          create_new_conversation: cfg.create_new_conversation ?? true,
          ignore_groups: cfg.ignore_groups ?? true,
        };
        return passthru(await instPut("/chatwoot/config", token, merged));
      }

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
