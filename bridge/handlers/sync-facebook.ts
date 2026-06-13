// sync-facebook — fallback por pull para Messenger quando o webhook de mensagens
// da Meta/EVO Hub não entrega evento. Deve rodar por cron curto no Coolify.
import { admin } from "../shared/supabase.ts";
import { env, optionalEnv } from "../shared/env.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { getMeta } from "../shared/hub.ts";
import { ingestInbound } from "../shared/inbound.ts";

type Json = Record<string, unknown>;
type Db = ReturnType<typeof admin>;

export async function handle(req: Request): Promise<Response> {
  if (!["GET", "POST"].includes(req.method)) return json({ error: "method not allowed" }, 405);

  const url = new URL(req.url);
  if (!isAuthorized(req, url)) return json({ error: "unauthorized" }, 401);

  const channelId = url.searchParams.get("channel_id") ?? undefined;
  const sinceMinutes = intParam(url, "since_minutes", 360, 1, 10_080);
  const conversationLimit = intParam(url, "conversation_limit", 10, 1, 50);
  const messageLimit = intParam(url, "message_limit", 20, 1, 100);
  const cutoffMs = Date.now() - sinceMinutes * 60_000;

  const db = admin();
  let query = db.from("channels")
    .select("id,type,name,status,page_id,display_name,chatwoot_inbox_identifier")
    .eq("type", "facebook")
    .eq("status", "active")
    .not("page_id", "is", null);
  if (channelId) query = query.eq("id", channelId);

  const { data: channels, error: channelError } = await query;
  if (channelError) return json({ error: channelError.message }, 500);

  const totals = {
    channels: channels?.length ?? 0,
    conversations_scanned: 0,
    inbound_found: 0,
    inserted: 0,
    duplicates: 0,
    skipped_self: 0,
    errors: [] as string[],
  };

  for (const channel of channels ?? []) {
    try {
      const result = await syncChannel(db, channel as Json, { cutoffMs, conversationLimit, messageLimit });
      totals.conversations_scanned += result.conversations_scanned;
      totals.inbound_found += result.inbound_found;
      totals.inserted += result.inserted;
      totals.duplicates += result.duplicates;
      totals.skipped_self += result.skipped_self;
      await db.from("channels").update({ last_error: null }).eq("id", channel.id);
    } catch (e) {
      const message = String(e);
      totals.errors.push(`${channel.name ?? channel.id}: ${message}`);
      await db.from("channels").update({ last_error: message }).eq("id", channel.id);
    }
  }

  await db.from("events").insert({
    source: "sync-facebook",
    event_type: "sync_completed",
    payload: { ...totals, since_minutes: sinceMinutes, conversation_limit: conversationLimit, message_limit: messageLimit },
  });

  return json(totals);
}

async function syncChannel(
  db: Db,
  channel: Json,
  opts: { cutoffMs: number; conversationLimit: number; messageLimit: number },
) {
  const pageId = channel.page_id as string | undefined;
  const inboxIdentifier = channel.chatwoot_inbox_identifier as string | undefined;
  if (!pageId) throw new Error("canal sem page_id");
  if (!inboxIdentifier) throw new Error("canal sem inbox Chatwoot");

  const { data: secret, error: secretError } = await db.from("channel_secrets")
    .select("channel_token")
    .eq("channel_id", channel.id)
    .maybeSingle();
  if (secretError) throw secretError;
  if (!secret?.channel_token) throw new Error("canal sem token");

  const conversationsPath =
    `${pageId}/conversations?fields=id,updated_time,message_count,participants&limit=${opts.conversationLimit}`;
  const convRes = await getMeta(secret.channel_token as string, conversationsPath);
  if (!convRes.ok) throw new Error(`Meta conversations ${convRes.status}: ${JSON.stringify(convRes.data)}`);

  const conversations = ((convRes.data as Json).data ?? []) as Json[];
  const result = { conversations_scanned: 0, inbound_found: 0, inserted: 0, duplicates: 0, skipped_self: 0 };

  for (const conversation of conversations) {
    const updatedMs = Date.parse(conversation.updated_time as string);
    if (!Number.isNaN(updatedMs) && updatedMs < opts.cutoffMs) continue;
    result.conversations_scanned++;

    const messagesPath =
      `${conversation.id}/messages?fields=id,from,to,message,created_time,attachments&limit=${opts.messageLimit}`;
    const msgRes = await getMeta(secret.channel_token as string, messagesPath);
    if (!msgRes.ok) throw new Error(`Meta messages ${msgRes.status}: ${JSON.stringify(msgRes.data)}`);

    const messages = (((msgRes.data as Json).data ?? []) as Json[]).slice().reverse();
    for (const message of messages) {
      const createdMs = Date.parse(message.created_time as string);
      if (!Number.isNaN(createdMs) && createdMs < opts.cutoffMs) continue;

      const from = (message.from ?? {}) as Json;
      const senderId = from.id as string | undefined;
      if (!senderId) continue;
      if (senderId === pageId) {
        result.skipped_self++;
        continue;
      }

      result.inbound_found++;
      const content = (message.message as string | undefined)?.trim() || "[anexo]";
      const ingest = await ingestInbound(db, channel, {
        from: senderId,
        name: from.name as string | undefined,
        metaMessageId: message.id as string | undefined,
        msgType: content === "[anexo]" ? "unknown" : "text",
        content,
        sentAt: message.created_time as string | undefined,
      });

      if (ingest.inserted) result.inserted++;
      else if (ingest.reason === "duplicate") result.duplicates++;
    }
  }

  return result;
}

function isAuthorized(req: Request, url: URL): boolean {
  const auth = req.headers.get("Authorization") ?? "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  const token = bearer || url.searchParams.get("token") || "";
  const expected = optionalEnv("SYNC_SECRET") ?? env("CHATWOOT_WEBHOOK_SECRET");
  return timingSafeEqual(token, expected);
}

function intParam(url: URL, key: string, fallback: number, min: number, max: number): number {
  const raw = Number(url.searchParams.get(key) ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(raw)));
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
