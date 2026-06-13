// hub-webhook — recebe webhooks do EVO Hub.
//  * lifecycle (event_type): channel_connected / channel_disconnected / channel_auto_imported
//  * passthrough Meta (object): whatsapp_business_account / page / instagram
//
// Fase 1: WhatsApp TEXTO ponta a ponta (Meta -> Chatwoot + Postgres).
// FB/IG e mídia: evento é persistido; tradução fica para Fase 2/3 (TODO marcados).
import { admin, claimDelivery } from "../shared/supabase.ts";
import { verifyHubSignature } from "../shared/hmac.ts";
import { env } from "../shared/env.ts";
import { getChannelDetail } from "../shared/hub.ts";
import { ingestInbound } from "../shared/inbound.ts";

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
    } else if (payload.object === "page" || payload.object === "instagram") {
      await handleMessenger(db, payload);
    } else {
      console.log("passthrough não tratado:", payload.object);
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
  const hubChannelId = p.channel_id as string;
  const eventType = p.event_type as string;

  const patch: Json = { hub_channel_id: hubChannelId ?? null };

  if (eventType === "channel_connected" || eventType === "channel_auto_imported") {
    patch.status = "active";
    patch.connected_at = new Date().toISOString();

    // O webhook channel_connected é magro (sem meta_connection). Buscamos o detalhe no Hub
    // pra extrair page_id (FB) / phone_number_id+waba_id (WA) / ig_id (IG).
    const detail = await getChannelDetail(hubChannelId);
    if (detail) {
      const fb = (detail.facebook_connection ?? {}) as Json;
      const wa = (detail.whatsapp_connection ?? detail.meta_connection ?? {}) as Json;
      const ig = (detail.instagram_connection ?? {}) as Json;
      if (fb.page_id) { patch.page_id = fb.page_id; patch.display_name = fb.page_name ?? null; }
      if (wa.phone_number_id) {
        patch.phone_number_id = wa.phone_number_id;
        patch.waba_id = wa.waba_id ?? null;
        patch.phone_number = wa.phone_number ?? null;
        patch.display_name = (patch.display_name as string | undefined) ?? wa.display_name ?? null;
      }
      const igId = ig.ig_id ?? ig.instagram_id ?? ig.id;
      if (igId) {
        patch.ig_id = igId;
        patch.display_name = (patch.display_name as string | undefined) ?? ig.username ?? null;
      }
      // channel_token vem no detalhe — guarda/atualiza (idempotente).
      if (detail.token) {
        await db.from("channel_secrets").upsert({ channel_id: externalId, channel_token: detail.token as string });
      }
    }
  } else if (eventType === "channel_disconnected") {
    patch.status = "inactive";
  }

  await db.from("channels").update(patch).eq("id", externalId);
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

// ── Messenger / Instagram passthrough (entrada) ──────────────────────────────
async function handleMessenger(db: Db, p: Json) {
  const entries = (p.entry ?? []) as Json[];
  for (const entry of entries) {
    const pageId = entry.id as string | undefined; // page_id (FB) ou ig id
    if (!pageId) continue;

    const { data: channel } = await db.from("channels").select("*")
      .or(`page_id.eq.${pageId},ig_id.eq.${pageId}`).maybeSingle();
    if (!channel?.chatwoot_inbox_identifier) {
      console.warn("sem canal p/ page/ig id", pageId);
      continue;
    }

    for (const m of ((entry.messaging ?? []) as Json[])) {
      const sender = (m.sender as Json)?.id as string | undefined;
      const message = m.message as Json | undefined;
      if (!sender || !message) continue; // ignora delivery/read/postback sem texto
      if (message.is_echo) continue; // ignora echo das mensagens enviadas pela própria página
      const text = (message.text as string) ?? "[anexo]"; // TODO Fase 3: mídia/attachments

      await ingestInbound(db, channel as Json, {
        from: sender,
        name: undefined,
        metaMessageId: (message.mid as string) ?? "",
        msgType: "text",
        content: text,
      });
    }
  }
}
