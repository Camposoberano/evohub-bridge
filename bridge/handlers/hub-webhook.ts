// hub-webhook — recebe webhooks do EVO Hub.
//  * lifecycle (event_type): channel_connected / channel_disconnected / channel_auto_imported
//  * passthrough Meta (object): whatsapp_business_account / page / instagram
//
// Fase 1: WhatsApp TEXTO ponta a ponta (Meta -> Chatwoot + Postgres).
// FB/IG e mídia: evento é persistido; tradução fica para Fase 2/3 (TODO marcados).
import { admin, claimDelivery } from "../shared/supabase.ts";
import { verifyHubSignature } from "../shared/hmac.ts";
import { env, optionalEnv } from "../shared/env.ts";
import { getChannelDetail, sendMeta } from "../shared/hub.ts";
import { ingestInbound, type InboundAttachment } from "../shared/inbound.ts";
import { numKey, readCampaigns, writeCampaigns } from "../shared/campaigns.ts";
import { isNativeChannel } from "../shared/native.ts";

type Json = Record<string, unknown>;
type Db = ReturnType<typeof admin>;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const WA_MEDIA_TYPES = new Set(["image", "audio", "video", "document", "sticker"]);
const GRAPH_VERSION = optionalEnv("META_GRAPH_VERSION") ?? "v21.0";

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
      const igId = ig.instagram_user_id ?? ig.ig_id ?? ig.instagram_id ?? ig.id;
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

      // Status de saída (sent/delivered/read/failed) — atualiza messages e marca número morto.
      const statuses = (value.statuses ?? []) as Json[];
      if (statuses.length > 0) await handleWhatsAppStatuses(db, channel as Json, statuses);

      // Mídia WhatsApp baixa direto na Graph API com o token Meta (Usuário do Sistema da
      // WABA). O Hub está em modo "shared" e não expõe download de binário; o channel_token
      // do Hub não autentica a lookaside. META_ACCESS_TOKEN é o token da sua WABA.
      const metaToken = optionalEnv("META_ACCESS_TOKEN");

      // Canal nativo: a entrada/echo já chega na caixa nativa do Chatwoot pelo repasse do EVO Hub.
      // Aqui o bridge NÃO posta no Chatwoot (evita duplicata) — só persiste no banco (analytics)
      // e roda o motor de campanha.
      const native = await isNativeChannel(channel.phone_number_id as string | undefined);

      // Echoes: mensagem enviada PELO APARELHO (modo coexistência app+API).
      // Vem em message_echoes (não em messages) -> entra como SAÍDA na conversa do cliente.
      // Dedup por meta_message_id: echo de msg que NÓS mandamos via API já está no banco -> pula.
      const echoes = (value.message_echoes ?? []) as Json[];
      for (const e of echoes) {
        const to = e.to as string;
        if (!to) continue;
        const { content, attachments } = await extractWaContent(e, e.type as string, metaToken, channel.id as string);
        await ingestInbound(db, channel as Json, {
          from: to, metaMessageId: e.id as string, msgType: e.type as string, content, attachments, outgoing: true, skipChatwoot: native,
        });
      }

      const contactsMeta = (value.contacts ?? []) as Json[];
      const messages = (value.messages ?? []) as Json[];
      if (messages.length === 0) continue;

      for (const m of messages) {
        const from = m.from as string;
        const profileName = (contactsMeta.find((c) => (c.wa_id as string) === from)?.profile as Json)?.name as string | undefined;

        const type = m.type as string;
        const { content, attachments } = await extractWaContent(m, type, metaToken, channel.id as string);

        await ingestInbound(db, channel as Json, {
          from,
          name: profileName,
          metaMessageId: m.id as string,
          msgType: type,
          content,
          attachments,
          skipChatwoot: native,
        });

        // gated campaign: cliente respondeu → janela aberta → dispara a sequência.
        try { await resumeCampaign(db, channel as Json, from); } catch (e) { console.error("resumeCampaign erro:", e); }
      }
    }
  }
}

// Erros da Meta que indicam número inexistente / não-WhatsApp (número morto).
const DEAD_NUMBER_ERRORS = new Set([131026, 131051, 131047, 131000]);

async function handleWhatsAppStatuses(db: Db, channel: Json, statuses: Json[]) {
  for (const s of statuses) {
    const wamid = stringValue(s.id);
    const status = stringValue(s.status); // sent | delivered | read | failed
    if (!wamid || !status) continue;

    // ordem: não regredir read->delivered. Atualiza só se "avança" ou é failed.
    const patch: Json = { status };
    await db.from("messages").update(patch).eq("meta_message_id", wamid).eq("direction", "out");

    if (status === "failed") {
      const errors = (s.errors ?? []) as Json[];
      const code = errors[0]?.code as number | undefined;
      const recipient = stringValue(s.recipient_id);
      if (recipient && code && DEAD_NUMBER_ERRORS.has(code)) {
        // marca contato como número morto (attributes.dead) p/ limpar das campanhas.
        const { data: contact } = await db.from("contacts").select("id,attributes")
          .eq("channel_id", channel.id).eq("external_contact_id", recipient).maybeSingle();
        if (contact) {
          const attrs = (contact.attributes ?? {}) as Json;
          await db.from("contacts").update({
            attributes: { ...attrs, dead: true, dead_reason: code, dead_at: new Date().toISOString() },
          }).eq("id", contact.id);
        }
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
      if (hasMessengerAttachments(message)) continue; // o sync-facebook baixa e envia a mídia real
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

// ── Campanha gated: resposta do cliente dispara a sequência (janela 24h aberta) ──
async function resumeCampaign(db: Db, channel: Json, from: string) {
  const key = numKey(from);
  const state = await readCampaigns();
  const t = state.targets[key];
  if (!t || t.status !== "awaiting") return; // só dispara quem está aguardando resposta
  const camp = state.campaigns.find((c) => c.id === t.campaignId);
  if (!camp) return;

  // marca ativo já (evita disparo duplo se chegar 2 msgs juntas)
  t.status = "active";
  await writeCampaigns(state);

  const { data: secret } = await db.from("channel_secrets").select("channel_token").eq("channel_id", channel.id).maybeSingle();
  const token = secret?.channel_token as string | undefined;
  const phone = channel.phone_number_id as string | undefined;
  if (!token || !phone) return;

  for (const step of camp.steps) {
    let body: Json;
    if (step.type === "text") {
      if (!step.text) continue; // texto vazio = pula
      body = { messaging_product: "whatsapp", to: key, type: "text", text: { body: step.text } };
    } else {
      if (!step.file) continue; // mídia sem URL = pula (não quebra a sequência)
      const media: Json = { link: step.file };
      // áudio NÃO aceita caption na Cloud API; image/video/document aceitam.
      if (step.type !== "audio" && step.text) media.caption = step.text;
      if (step.type === "document" && step.text) media.filename = step.text;
      body = { messaging_product: "whatsapp", to: key, type: step.type, [step.type]: media };
    }
    const r = await sendMeta(token, `${phone}/messages`, body);
    if (!r.ok) console.error(`resumeCampaign step falhou (${step.type}):`, JSON.stringify((r.data as Json)?.error ?? r.data).slice(0, 200));
  }

  // marca concluído
  const s2 = await readCampaigns();
  if (s2.targets[key]) { s2.targets[key].status = "done"; s2.targets[key].step = camp.steps.length; s2.targets[key].ts = new Date().toISOString(); await writeCampaigns(s2); }
}

function hasMessengerAttachments(message: Json): boolean {
  const attachments = message.attachments;
  return Array.isArray(attachments) && attachments.length > 0;
}

// ── Mídia WhatsApp (entrada) ──────────────────────────────────────────────────
// Baixa direto na Graph API da Meta (o Hub em modo shared não serve o binário):
// 1) GET graph.facebook.com/<ver>/<media_id> com Bearer <metaToken> -> { url, mime_type, file_size }
// 2) fetch(url) com Bearer <metaToken> -> bytes (lookaside exige o token Meta)
async function downloadWhatsAppMedia(metaToken: string, mediaId: string, filenameHint?: string): Promise<InboundAttachment | null> {
  const auth = { Authorization: `Bearer ${metaToken}` };
  const infoRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, { headers: auth });
  if (!infoRes.ok) {
    console.warn("WA mídia metadata falhou", infoRes.status, (await infoRes.text()).slice(0, 200));
    return null;
  }
  const d = await infoRes.json().catch(() => ({})) as Json;
  const url = stringValue(d.url);
  if (!url) return null;

  const declaredSize = typeof d.file_size === "number" ? d.file_size : null;
  if (declaredSize && declaredSize > MAX_ATTACHMENT_BYTES) return null;

  const res = await fetch(url, { headers: auth });
  if (!res.ok) { console.warn("WA mídia download falhou", res.status); return null; }

  const length = Number(res.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_ATTACHMENT_BYTES) return null;

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) return null;

  const contentType = cleanContentType(res.headers.get("content-type")) ??
    cleanContentType(d.mime_type as string | undefined) ??
    "application/octet-stream";

  return {
    filename: filenameHint ?? `${mediaId}${extensionForMime(contentType)}`,
    contentType,
    bytes,
    sourceUrl: url,
  };
}

// Extrai texto + anexo de uma mensagem/echo WhatsApp (mesmo formato p/ inbound e echo).
async function extractWaContent(
  m: Json, type: string, metaToken: string | undefined, channelId: string,
): Promise<{ content: string; attachments?: InboundAttachment[] }> {
  if (type === "text") return { content: ((m.text as Json)?.body as string) ?? "" };
  if (WA_MEDIA_TYPES.has(type)) {
    const media = (m[type] ?? {}) as Json;
    const mediaId = stringValue(media.id);
    const caption = stringValue(media.caption);
    const filenameHint = type === "document" ? stringValue(media.filename) ?? undefined : undefined;
    if (!metaToken) console.warn("WA mídia sem META_ACCESS_TOKEN — usando placeholder", channelId);
    const downloaded = metaToken && mediaId ? await downloadWhatsAppMedia(metaToken, mediaId, filenameHint) : null;
    // anexo baixou: conteúdo = legenda (ou vazio; sem rótulo "[audio]"). Sem anexo: placeholder textual.
    if (downloaded) return { content: caption ?? "", attachments: [downloaded] };
    return { content: caption ?? fallbackContent(type) };
  }
  return { content: `[${type}]` }; // tipo sem tradução (location/contacts/interactive/etc.)
}

function fallbackContent(type: string): string {
  if (type === "image") return "[imagem]";
  if (type === "audio") return "[audio]";
  if (type === "video") return "[video]";
  if (type === "document") return "[documento]";
  if (type === "sticker") return "[sticker]";
  return "[anexo]";
}

function cleanContentType(value: string | null | undefined): string | null {
  const clean = value?.split(";")[0]?.trim().toLowerCase();
  return clean || null;
}

function extensionForMime(mime: string): string {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/gif") return ".gif";
  if (mime === "image/webp") return ".webp";
  if (mime === "audio/mpeg") return ".mp3";
  if (mime === "audio/mp4" || mime === "video/mp4") return ".mp4";
  if (mime === "audio/ogg") return ".ogg";
  if (mime === "application/pdf") return ".pdf";
  return "";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
