// sync-chatwoot-out — fallback por PULL para a saída do WhatsApp quando o webhook do
// Chatwoot não dispara message_created (Sidekiq travado / webhook pausado por downtime).
// Varre as conversas WhatsApp não-resolvidas, pega as mensagens de SAÍDA recentes do
// Chatwoot e as entrega reusando handleOutgoing (texto/mídia/áudio/botões + dedup atômico
// por claim cw-out-<id>). Idempotente: se o webhook real voltar, o claim impede duplicar.
// Roda em loop interno no server.ts (cada SYNC_OUT_INTERVAL_MS). Auth: ?token=<SYNC/WEBHOOK secret>.
import { admin } from "../shared/supabase.ts";
import { env, optionalEnv } from "../shared/env.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { listConversationMessages } from "../shared/chatwoot.ts";
import { handleOutgoing } from "./chatwoot-webhook.ts";

type Json = Record<string, unknown>;
type Db = ReturnType<typeof admin>;

export async function handle(req: Request): Promise<Response> {
  if (!["GET", "POST"].includes(req.method)) return json({ error: "method not allowed" }, 405);
  const url = new URL(req.url);
  if (!isAuthorized(req, url)) return json({ error: "unauthorized" }, 401);

  const sinceMinutes = intParam(url, "since_minutes", 30, 1, 1440);
  const convLimit = intParam(url, "conversation_limit", 40, 1, 100);
  const cutoffMs = Date.now() - sinceMinutes * 60_000;

  const db = admin();
  const { data: channels, error: chErr } = await db.from("channels")
    .select("id,name,chatwoot_inbox_id")
    .eq("type", "whatsapp").eq("status", "active");
  if (chErr) return json({ error: chErr.message }, 500);

  const totals = { channels: channels?.length ?? 0, conversations_scanned: 0, outgoing_found: 0, dispatched: 0, skipped: 0, errors: [] as string[] };

  for (const ch of channels ?? []) {
    const cwInboxId = ch.chatwoot_inbox_id as number | undefined;
    if (!cwInboxId) continue;
    const { data: convs, error: convErr } = await db.from("conversations")
      .select("id,chatwoot_conversation_id")
      .eq("channel_id", ch.id).neq("status", "resolved")
      .order("opened_at", { ascending: false }).limit(convLimit);
    if (convErr) { totals.errors.push(`${ch.name}: ${convErr.message}`); continue; }

    for (const conv of convs ?? []) {
      const cwConvId = conv.chatwoot_conversation_id as number | undefined;
      if (!cwConvId) continue;
      totals.conversations_scanned++;
      let messages: Json[];
      try { messages = await listConversationMessages(cwConvId) as Json[]; }
      catch (e) { totals.errors.push(`conv ${cwConvId}: ${msg(e)}`); continue; }

      for (const m of messages) {
        if (!isOutgoing(m) || m.private === true) continue;
        const created = createdAtMs(m.created_at);
        if (created && created < cutoffMs) continue;
        const cwMsgId = m.id as number | undefined;
        const content = (m.content as string | undefined) ?? "";
        const attachments = (m.attachments as Json[] | undefined) ?? [];
        if (!cwMsgId || (!content && attachments.length === 0)) continue;
        totals.outgoing_found++;

        // dedup leve: já registrada na nossa base -> handleOutgoing também pularia (anti-echo),
        // mas evita a chamada e o delay defensivo de 600ms à toa.
        const { data: exist } = await db.from("messages").select("id")
          .eq("chatwoot_message_id", cwMsgId).limit(1).maybeSingle();
        if (exist) { totals.skipped++; continue; }

        // monta o payload no formato do webhook do Chatwoot e reusa handleOutgoing
        const p: Json = {
          id: cwMsgId, message_type: "outgoing", private: false,
          content, attachments,
          conversation: { id: cwConvId }, inbox: { id: cwInboxId },
        };
        try { await handleOutgoing(db, p); totals.dispatched++; }
        catch (e) { totals.errors.push(`msg ${cwMsgId}: ${msg(e)}`); }
      }
    }
  }

  if (totals.dispatched > 0 || totals.errors.length > 0) {
    db.from("events").insert({ source: "sync-chatwoot-out", event_type: "sync_completed", payload: { ...totals, since_minutes: sinceMinutes } }).then(() => {}, () => {});
  }
  return json(totals);
}

function isOutgoing(m: Json): boolean {
  return m.message_type === "outgoing" || m.message_type === 1;
}

function createdAtMs(v: unknown): number | null {
  if (typeof v === "number") return v * 1000;
  if (typeof v === "string") { const p = Date.parse(v); return Number.isNaN(p) ? null : p; }
  return null;
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

function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
