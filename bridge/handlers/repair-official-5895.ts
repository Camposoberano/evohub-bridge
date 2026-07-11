// Repara o vinculo do WhatsApp oficial 5895 sem criar canal ou inbox duplicados.
// Uso interno: GET/POST /repair-official-5895?token=<CHATWOOT_WEBHOOK_SECRET>
import { env, optionalEnv } from "../shared/env.ts";
import { admin } from "../shared/supabase.ts";
import { getChannelDetail } from "../shared/hub.ts";
import { acctByKey } from "../shared/accounts.ts";
import { createApiInbox, findInboxByName, setInboxWebhook } from "../shared/chatwoot.ts";

type Json = Record<string, unknown>;

const DEFAULT_HUB_CHANNEL_ID = "3cd9df61-a599-4c32-8da8-b3e683550284";
const DEFAULT_PHONE_NUMBER_ID = "956105997592428";
const DEFAULT_WABA_ID = "743886211614541";
const DEFAULT_PHONE = "+55 19 99971-5895";

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (token !== env("CHATWOOT_WEBHOOK_SECRET")) return json({ error: "unauthorized" }, 401);

  const db = admin();
  const hubChannelId = optionalEnv("OFFICIAL_5895_HUB_CHANNEL_ID") ?? DEFAULT_HUB_CHANNEL_ID;
  const phoneNumberId = optionalEnv("OFFICIAL_5895_PHONE_NUMBER_ID") ?? DEFAULT_PHONE_NUMBER_ID;
  const wabaId = optionalEnv("OFFICIAL_5895_WABA_ID") ?? DEFAULT_WABA_ID;
  const phone = optionalEnv("OFFICIAL_5895_PHONE") ?? DEFAULT_PHONE;
  const inboxName = optionalEnv("OFFICIAL_5895_INBOX_NAME") ?? "WA Oficial 5895";
  const accountKey = optionalEnv("OFFICIAL_5895_CHATWOOT_ACCOUNT_ID") ?? env("CHATWOOT_ACCOUNT_ID");

  const detail = await getChannelDetail(hubChannelId);
  if (!detail) return json({ error: "canal 5895 nao encontrado no EVO Hub", hub_channel_id: hubChannelId }, 404);

  const wa = (detail.whatsapp_connection ?? detail.meta_connection ?? {}) as Json;
  const detailPhoneId = String(wa.phone_number_id ?? detail.phone_number_id ?? phoneNumberId);
  const detailWaba = String(wa.waba_id ?? detail.waba_id ?? wabaId);
  const detailPhone = String(wa.phone_number ?? phone);
  const displayName = String(wa.display_name ?? detail.display_name ?? "Campo Soberano");

  const { data: existing, error: findError } = await db.from("channels")
    .select("id,name,hub_channel_id,phone_number_id,chatwoot_inbox_id,chatwoot_inbox_identifier")
    .or(`hub_channel_id.eq.${hubChannelId},phone_number_id.eq.${detailPhoneId},name.eq.5895`)
    .limit(1)
    .maybeSingle();
  if (findError) return json({ error: findError.message }, 500);

  const acct = await acctByKey(accountKey);
  let inbox = await findInboxByName(inboxName, acct);
  let inboxCreated = false;
  if (!inbox) {
    const webhookUrl = `${env("BRIDGE_PUBLIC_BASE").replace(/\/+$/, "")}/chatwoot-webhook?token=${encodeURIComponent(env("CHATWOOT_WEBHOOK_SECRET"))}`;
    inbox = await createApiInbox(inboxName, webhookUrl, acct);
    inboxCreated = true;
  }
  if (!inbox?.inbox_identifier) return json({ error: "inbox sem inbox_identifier", inbox_name: inboxName }, 502);

  const channelId = existing?.id ?? crypto.randomUUID();
  const patch = {
    id: channelId,
    type: "whatsapp",
    name: existing?.name ?? "5895",
    status: "active",
    hub_channel_id: hubChannelId,
    phone_number_id: detailPhoneId,
    waba_id: detailWaba,
    phone_number: detailPhone,
    display_name: displayName,
    chatwoot_inbox_id: existing?.chatwoot_inbox_id ?? inbox.id,
    chatwoot_inbox_identifier: existing?.chatwoot_inbox_identifier ?? inbox.inbox_identifier,
    connected_at: new Date().toISOString(),
  };
  const { data: channel, error: upsertError } = await db.from("channels").upsert(patch, { onConflict: "id" }).select().single();
  if (upsertError) return json({ error: upsertError.message }, 500);

  if (detail.token) {
    const { error: secretError } = await db.from("channel_secrets").upsert({
      channel_id: channelId,
      channel_token: detail.token,
      webhook_secret: env("EVOLUTION_HUB_WEBHOOK_SECRET"),
    }, { onConflict: "channel_id" });
    if (secretError) return json({ error: secretError.message }, 500);
  }

  const webhookUrl = `${env("BRIDGE_PUBLIC_BASE").replace(/\/+$/, "")}/chatwoot-webhook?token=${encodeURIComponent(env("CHATWOOT_WEBHOOK_SECRET"))}`;
  const webhook = await setInboxWebhook(acct.accountId, patch.chatwoot_inbox_id, webhookUrl, acct);
  return json({
    ok: true,
    created: !existing,
    inbox_created: inboxCreated,
    channel: { id: channelId, name: patch.name, phone_number_id: detailPhoneId },
    inbox: { id: patch.chatwoot_inbox_id, name: inboxName, identifier: patch.chatwoot_inbox_identifier },
    hub: { channel_id: hubChannelId, status: detail.status ?? "unknown" },
    webhook,
    next: "hybrid auto-discovery will match Uazapi 5895 on the next request or within 60s",
  });
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
