// hub-webhook — recebe webhooks do EVO Hub.
//  * lifecycle (event_type): channel_connected / channel_disconnected / channel_auto_imported
//  * passthrough Meta (object): whatsapp_business_account / page / instagram
//
// Fase 1: WhatsApp TEXTO ponta a ponta (Meta -> Chatwoot + Postgres).
// FB/IG e mídia: evento é persistido; tradução fica para Fase 2/3 (TODO marcados).
import { admin, claimDelivery } from "../shared/supabase.ts";
import { verifyHubSignature } from "../shared/hmac.ts";
import { env } from "../shared/env.ts";
import { createConversation, createIncomingMessage, ensureContact } from "../shared/chatwoot.ts";

type Json = Record<string, unknown>;
type Db = ReturnType<typeof admin>;

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const raw = await req.text();
  const sig = req.headers.get("X-Hub-Signature-256");
  const deliveryId = req.headers.get("X-Hub-Delivery-Id");

  if (!(await verifyHubSignature(env("EVOLUTION_HUB_WEBHOOK_SECRET"), raw, sig))) {
    return new Response("invalid signature", { status: 401 });
  }

  const db = admin();

  if (!(await claimDelivery(db, deliveryId, "hub"))) {
    return new Response("ok (dup)", { status: 200 });
  }

  let payload: Json;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  await db.from("events").insert({
    source: "hub",
    event_type: (payload.event_type as string) ?? (payload.event as string) ?? (payload.object as string) ?? "unknown",
    payload,
    occurred_at: (payload.occurred_at as string) ?? null,
  });

  try {
    const eventType = payload.event_type as string | undefined;
    if (eventType && ["channel_connected", "channel_disconnected", "channel_auto_imported"].includes(eventType)) {
      await handleLifecycle(db, payload);
    } else if (payload.object === "whatsapp_business_account") {
      await handleWhatsApp(db, payload);
    } else {
      // TODO Fase 2/3: object === "page" (Messenger) / "instagram"
      console.log("passthrough não tratado ainda:", payload.object);
    }
  } catch (e) {
    console.error("hub-webhook erro:", e);
    return new Response("ok (logged error)", { status: 200 });
  }

  return new Response("ok", { status: 200 });
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
async function handleLifecycle(db: Db, p: Json) {
  const externalId = p.external_id as string;
  const meta = (p.meta_connection ?? {}) as Json;
  const eventType = p.event_type as string;

  const patch: Json = { hub_channel_id: p.channel_id ?? null };
  if (eventType === "channel_connected" || eventType === "channel_auto_imported") {
    patch.status = "active";
    patch.connected_at = new Date().toISOString();
    patch.phone_number_id = meta.phone_number_id ?? null;
    patch.waba_id = meta.waba_id ?? null;
    patch.phone_number = meta.phone_number ?? null;
    patch.display_name = meta.display_name ?? null;
    patch.page_id = meta.page_id ?? null;
    patch.ig_id = meta.ig_id ?? null;
  } else if (eventType === "channel_disconnected") {
    patch.status = "inactive";
  }

  // NOTA: ignoramos meta.access_token de propósito — no modo Hub o Bearer é o channel_token.
  await db.from("channels").update(patch).eq("id", externalId);

  if (p.channel_token) {
    await db.from("channel_secrets").upsert({
      channel_id: externalId,
      channel_token: p.channel_token as string,
    });
  }
}

// ── WhatsApp passthrough (entrada) ───────────────────────────────────────────
async function handleWhatsApp(db: Db, p: Json) {
  const entries = (p.entry ?? []) as Json[];
  for (const entry of entries) {
    for (const change of ((entry.changes ?? []) as Json[])) {
      const value = (change.value ?? {}) as Json;
      const phoneNumberId = (value.metadata as Json)?.phone_number_id as string | undefined;
      if (!phoneNumberId) continue;

      const { data: channel } = await db.from("channels").select("*").eq("phone_number_id", phoneNumberId).maybeSingle();
      if (!channel?.chatwoot_inbox_identifier) {
        console.warn("canal sem inbox_identifier p/ phone_number_id", phoneNumberId);
        continue;
      }

      const contactsMeta = (value.contacts ?? []) as Json[];
      const messages = (value.messages ?? []) as Json[];

      for (const m of messages) {
        const from = m.from as string;
        const profileName = (contactsMeta.find((c) => (c.wa_id as string) === from)?.profile as Json)?.name as string | undefined;

        const type = m.type as string;
        let content: string;
        if (type === "text") content = ((m.text as Json)?.body as string) ?? "";
        else content = `[${type}]`; // placeholder até a tradução de mídia (Fase 3)

        await ingestInbound(db, channel as Json, {
          from,
          name: profileName,
          metaMessageId: m.id as string,
          msgType: type,
          content,
        });
      }
    }
  }
}

async function ingestInbound(
  db: Db,
  channel: Json,
  msg: { from: string; name?: string; metaMessageId: string; msgType: string; content: string },
) {
  const inboxId = channel.chatwoot_inbox_identifier as string;

  // 1) contato local (upsert por channel+external)
  const { data: existing } = await db
    .from("contacts").select("*")
    .eq("channel_id", channel.id).eq("external_contact_id", msg.from).maybeSingle();

  let contact = existing;
  let sourceId = (existing?.attributes as Json)?.source_id as string | undefined;

  if (!contact || !sourceId) {
    const cw = await ensureContact(inboxId, { name: msg.name, phone: `+${msg.from}`, identifier: msg.from });
    sourceId = cw.source_id;
    const up = await db.from("contacts").upsert({
      channel_id: channel.id,
      external_contact_id: msg.from,
      name: msg.name ?? null,
      phone: `+${msg.from}`,
      chatwoot_contact_id: cw.contact_id ?? null,
      attributes: { source_id: sourceId },
      last_seen_at: new Date().toISOString(),
    }, { onConflict: "channel_id,external_contact_id" }).select().single();
    contact = up.data;
  } else {
    await db.from("contacts").update({ last_seen_at: new Date().toISOString() }).eq("id", contact.id);
  }

  // 2) conversa aberta (reusa; senão cria nova no Chatwoot)
  const { data: openConv } = await db
    .from("conversations").select("*")
    .eq("contact_id", contact.id).neq("status", "resolved")
    .order("opened_at", { ascending: false }).maybeSingle();

  let conv = openConv;
  if (!conv) {
    const cwConv = await createConversation(inboxId, sourceId!);
    const ins = await db.from("conversations").insert({
      channel_id: channel.id,
      contact_id: contact.id,
      chatwoot_conversation_id: cwConv.id,
      status: "open",
    }).select().single();
    conv = ins.data;
  }

  // 3) mensagem no Chatwoot + Postgres
  const cwMsg = await createIncomingMessage(inboxId, sourceId!, conv.chatwoot_conversation_id, msg.content);
  await db.from("messages").insert({
    conversation_id: conv.id,
    channel_id: channel.id,
    direction: "in",
    msg_type: msg.msgType === "text" ? "text" : "unknown",
    content: msg.content,
    meta_message_id: msg.metaMessageId,
    chatwoot_message_id: cwMsg?.id ?? null,
    status: "received",
  });
}
