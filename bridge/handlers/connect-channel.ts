// connect-channel — chamado pelo dashboard.
// Criação: cria canal local -> canal no Hub -> inbox no Chatwoot -> grava mapa/segredo.
// Reconexão: devolve a URL pública de conexão para um canal já existente.
import { admin } from "../shared/supabase.ts";
import { env } from "../shared/env.ts";
import { createApiInbox } from "../shared/chatwoot.ts";
import { createChannel, createMessagesWebhook, publicConnectUrl } from "../shared/hub.ts";
import { acctByKey, setAccountForChannel } from "../shared/accounts.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ChannelType = "whatsapp" | "facebook" | "instagram";

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  // Auth: exige usuário autenticado do dashboard (JWT do Supabase).
  const authz = req.headers.get("Authorization") ?? "";
  const userClient = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authz } },
    auth: { persistSession: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const db = admin();

  const existingChannelId = (body.channel_id as string | undefined)?.trim();
  if (existingChannelId) {
    const { data: channel, error: channelError } = await db.from("channels")
      .select("id, hub_channel_id")
      .eq("id", existingChannelId)
      .maybeSingle();
    if (channelError) return json({ error: channelError.message }, 500);
    if (!channel) return json({ error: "canal não encontrado" }, 404);

    const { data: secret, error: secretError } = await db.from("channel_secrets")
      .select("channel_token")
      .eq("channel_id", existingChannelId)
      .maybeSingle();
    if (secretError) return json({ error: secretError.message }, 500);
    if (!secret?.channel_token) return json({ error: "canal sem token de conexão" }, 404);

    return json({
      channel_id: channel.id,
      hub_channel_id: channel.hub_channel_id,
      connect_url: publicConnectUrl(secret.channel_token),
    });
  }

  const type = body.type as ChannelType;
  const name = (body.name as string)?.trim();
  if (!["whatsapp", "facebook", "instagram"].includes(type) || !name) {
    return json({ error: "type (whatsapp|facebook|instagram) e name são obrigatórios" }, 400);
  }
  // conta Chatwoot de destino (multi-conta na mesma instância). Default = conta principal.
  const accountId = (body.account_id as string | number | undefined)?.toString().trim() || env("CHATWOOT_ACCOUNT_ID");

  // 1) canal local (external_id = id local)
  const { data: channel, error } = await db.from("channels")
    .insert({ type, name, status: "inactive" }).select().single();
  if (error) return json({ error: error.message }, 500);

  try {
    const base = env("BRIDGE_PUBLIC_BASE").replace(/\/+$/, "");
    const cwSecret = env("CHATWOOT_WEBHOOK_SECRET");

    // 2) canal no Hub (single-shot)
    const hub = await createChannel({
      name,
      type,
      external_id: channel.id,
      webhook_url: `${base}/hub-webhook`,
      webhook_secret: env("EVOLUTION_HUB_WEBHOOK_SECRET"),
    });

    // 2b) webhook de MENSAGENS (createChannel só assina ciclo de vida; sem isto a entrada não chega)
    await createMessagesWebhook(hub.channel.id, `${base}/hub-webhook`, env("EVOLUTION_HUB_WEBHOOK_SECRET")).catch(() => {});

    // 3) inbox no Chatwoot na CONTA escolhida (instância própria: URL+token da conta)
    const acct = await acctByKey(accountId);
    const inbox = await createApiInbox(name, `${base}/chatwoot-webhook?token=${encodeURIComponent(cwSecret)}`, acct);

    // 3b) grava o mapa canal -> conta (pro bridge rotear entrada/echo na conta certa)
    if (accountId !== env("CHATWOOT_ACCOUNT_ID")) await setAccountForChannel(channel.id, accountId);

    // 4) grava mapa + segredo
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

    // 5) URL pública pro popup
    return json({
      channel_id: channel.id,
      connect_url: publicConnectUrl(hub.channel.token),
      hub_channel_id: hub.channel.id,
      chatwoot_inbox_id: inbox.id,
    }, 201);
  } catch (e) {
    await db.from("channels").update({ status: "error", last_error: String(e) }).eq("id", channel.id);
    return json({ error: String(e), channel_id: channel.id }, 502);
  }
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
