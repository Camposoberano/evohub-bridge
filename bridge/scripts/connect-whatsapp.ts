// Cria canal WhatsApp: canal local -> canal no Hub (single-shot) -> inbox no Chatwoot -> grava mapa/segredo.
// Mesma lógica do handler connect-channel.ts, sem o gate de auth do dashboard (uso local/admin).
//
// Rodar (dentro de bridge/):
//   deno run --allow-net --allow-env --env-file=.env scripts/connect-whatsapp.ts
import { admin } from "../shared/supabase.ts";
import { env } from "../shared/env.ts";
import { createApiInbox } from "../shared/chatwoot.ts";
import { createChannel, publicConnectUrl } from "../shared/hub.ts";

const NAME = "Atendimento WhatsApp";
const db = admin();

const { data: channel, error } = await db.from("channels")
  .insert({ type: "whatsapp", name: NAME, status: "inactive" }).select().single();
if (error) throw error;
console.log("canal local:", channel.id);

const base = env("BRIDGE_PUBLIC_BASE").replace(/\/+$/, "");
const cwSecret = env("CHATWOOT_WEBHOOK_SECRET");

const hub = await createChannel({
  name: NAME,
  type: "whatsapp",
  external_id: channel.id,
  webhook_url: `${base}/hub-webhook`,
  webhook_secret: env("EVOLUTION_HUB_WEBHOOK_SECRET"),
});
console.log("hub channel:", hub.channel.id);

const inbox = await createApiInbox(NAME, `${base}/chatwoot-webhook?token=${encodeURIComponent(cwSecret)}`);
console.log("chatwoot inbox:", inbox.id, inbox.inbox_identifier);

await db.from("channels").update({
  hub_channel_id: hub.channel.id,
  external_id: channel.id,
  chatwoot_inbox_id: inbox.id,
  chatwoot_inbox_identifier: inbox.inbox_identifier,
  status: "pending",
}).eq("id", channel.id);

await db.from("channel_secrets").upsert({
  channel_id: channel.id,
  channel_token: hub.channel.token,
  webhook_secret: env("EVOLUTION_HUB_WEBHOOK_SECRET"),
});

console.log("\nLINK PRA CONECTAR (abrir e logar com o WhatsApp Business):");
console.log(publicConnectUrl(hub.channel.token));
