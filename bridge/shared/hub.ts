// Cliente EVO Hub.
import { env } from "./env.ts";

const HUB = () => env("EVOLUTION_HUB_URL").replace(/\/+$/, "");

// Envio Meta via proxy /meta/* — Bearer = channel_token.
// ATENÇÃO: caminho SEM versão (/v23.0). O Hub abstrai; versão duplicada = 404.
export async function sendMetaMessage(
  channelToken: string,
  phoneNumberId: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${HUB()}/meta/${phoneNumberId}/messages`, {
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

// URL pública do link de conexão (cliente final loga na Meta).
export function publicConnectUrl(channelToken: string): string {
  return `${env("EVOLUTION_HUB_FRONTEND_URL").replace(/\/+$/, "")}/connect/${channelToken}`;
}
