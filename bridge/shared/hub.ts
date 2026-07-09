// Cliente EVO Hub.
import { env } from "./env.ts";

const HUB = () => env("EVOLUTION_HUB_URL").replace(/\/+$/, "");

// Envio Meta via proxy /meta/* — Bearer = channel_token.
// ATENÇÃO: caminho SEM versão (/v23.0). O Hub abstrai; versão duplicada = 404.
// path ex.: "<phone_number_id>/messages" (WhatsApp) ou "me/messages" (Messenger/IG).
export async function sendMeta(
  channelToken: string,
  path: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${HUB()}/meta/${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${channelToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function getMeta(
  channelToken: string,
  path: string,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${HUB()}/meta/${path.replace(/^\/+/, "")}`, {
    headers: { "Authorization": `Bearer ${channelToken}` },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// Atalho WhatsApp.
export function sendMetaMessage(channelToken: string, phoneNumberId: string, body: unknown) {
  return sendMeta(channelToken, `${phoneNumberId}/messages`, body);
}

// Upload de mídia pro Meta (multipart) -> media_id. Necessário pra ÁUDIO virar VOZ gravada
// (PTT): áudio por link renderiza como arquivo; só media_id (bytes subidos direto) vira bolha
// de voz. path: /meta/<phone_number_id>/media.
export async function uploadMetaMedia(
  channelToken: string,
  phoneNumberId: string,
  bytes: Uint8Array,
  mimeType: string,
  filename: string,
): Promise<{ ok: boolean; status: number; id: string | null; data: unknown }> {
  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set("type", mimeType);
  const bytesCopy = new Uint8Array(bytes);
  const fileBlob = new Blob([bytesCopy.buffer], { type: mimeType });
  form.append("file", fileBlob, filename);
  const res = await fetch(`${HUB()}/meta/${phoneNumberId}/media`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${channelToken}` }, // sem Content-Type: FormData põe o boundary
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, id: (data as { id?: string })?.id ?? null, data };
}

// Detalhe do canal no Hub. O webhook channel_connected é magro (sem meta_connection),
// então buscamos a conexão aqui: facebook_connection / whatsapp_connection / instagram_connection.
export async function getChannelDetail(hubChannelId: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${HUB()}/api/v1/channels/${hubChannelId}`, {
    headers: { "Authorization": `Bearer ${env("EVOLUTION_HUB_API_KEY")}` },
  });
  if (!res.ok) return null;
  return await res.json().catch(() => null);
}

// Criação single-shot de canal (cria canal + webhook numa chamada). Bearer = API Key (evh_pk_).
export async function createChannel(input: {
  name: string;
  type: "whatsapp" | "facebook" | "instagram";
  external_id: string;
  webhook_url: string;
  webhook_secret: string;
  webhook_events?: string[];
}): Promise<{
  channel: { id: string; token: string; type: string; name: string; status: string; external_id: string };
  webhook_id?: string;
}> {
  const res = await fetch(`${HUB()}/api/v1/channels`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env("EVOLUTION_HUB_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: input.name,
      type: input.type,
      external_id: input.external_id,
      webhook_url: input.webhook_url,
      webhook_secret: input.webhook_secret,
      webhook_events: input.webhook_events ?? [
        "channel_connected",
        "channel_disconnected",
        "event_received",
        "webhook_delivered",
        "webhook_failed",
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Hub createChannel ${res.status}: ${err}`);
  }
  const json = await res.json();
  // single-shot encapsula em { channel, webhook_id }
  return json.channel ? json : { channel: json, webhook_id: undefined };
}

// Cria um webhook de MENSAGENS pro canal (o createChannel só assina ciclo de vida).
// Sem isso, o Hub não encaminha messages/echoes/statuses -> entrada não chega.
export async function createMessagesWebhook(hubChannelId: string, webhookUrl: string, secret: string): Promise<boolean> {
  const events = [
    "messages", "message_echoes", "message_reactions", "message_reads", "message_deliveries",
    "smb_message_echoes", "messaging_postbacks", "messaging_optins", "messaging_referral",
    "account_update", "message_template_status_update", "*",
  ];
  const res = await fetch(`${HUB()}/api/v1/webhooks`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${env("EVOLUTION_HUB_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "mensagens", channel_id: hubChannelId, url: webhookUrl, events, secret }),
  });
  return res.ok;
}

// URL pública do link de conexão (cliente final loga na Meta).
export function publicConnectUrl(channelToken: string): string {
  return `${env("EVOLUTION_HUB_FRONTEND_URL").replace(/\/+$/, "")}/connect/${channelToken}`;
}
