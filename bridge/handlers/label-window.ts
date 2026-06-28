// label-window — marca em cada conversa (WhatsApp/FB/IG) se a janela de 24h da Meta
// (texto livre sem template) está aberta, fechando ou fechada, via label do Chatwoot.
// Sem isso o atendente não tem como saber, na tela, quem ele pode responder livre e quem só
// com template (ou perde a venda, como ocorreu com Cezar Hoffman/campo soberano em 28/06).
import { admin } from "../shared/supabase.ts";
import { env, optionalEnv } from "../shared/env.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { getConversationLabels, setConversationLabels } from "../shared/chatwoot.ts";
import { accountForChannel } from "../shared/accounts.ts";

type Json = Record<string, unknown>;
type Db = ReturnType<typeof admin>;

const WINDOW_MS = 24 * 60 * 60 * 1000;
const CLOSING_SOON_MS = 60 * 60 * 1000; // <1h pra fechar
const LABEL_OPEN = "janela-aberta";
const LABEL_CLOSING = "janela-fechando";
const LABEL_CLOSED = "janela-fechada";
const WINDOW_LABELS = new Set([LABEL_OPEN, LABEL_CLOSING, LABEL_CLOSED]);

export async function handle(req: Request): Promise<Response> {
  if (!["GET", "POST"].includes(req.method)) return json({ error: "method not allowed" }, 405);
  const url = new URL(req.url);
  if (!isAuthorized(req, url)) return json({ error: "unauthorized" }, 401);

  const convLimit = intParam(url, "conversation_limit", 80, 1, 200);
  const db = admin();

  const { data: channels, error: chErr } = await db.from("channels")
    .select("id,name,chatwoot_inbox_id")
    .in("type", ["whatsapp", "facebook", "instagram"]).eq("status", "active");
  if (chErr) return json({ error: chErr.message }, 500);

  const totals = { channels: channels?.length ?? 0, conversations_scanned: 0, labeled: 0, skipped_no_inbound: 0, unchanged: 0, errors: [] as string[] };

  for (const ch of channels ?? []) {
    const { data: convs, error: convErr } = await db.from("conversations")
      .select("id,chatwoot_conversation_id")
      .eq("channel_id", ch.id).neq("status", "resolved")
      .order("opened_at", { ascending: false }).limit(convLimit);
    if (convErr) { totals.errors.push(`${ch.name}: ${convErr.message}`); continue; }

    const acct = await accountForChannel(ch.id as string);

    for (const conv of convs ?? []) {
      const cwConvId = conv.chatwoot_conversation_id as number | undefined;
      if (!cwConvId) continue;
      totals.conversations_scanned++;

      const { data: lastIn } = await db.from("messages").select("sent_at")
        .eq("conversation_id", conv.id).eq("direction", "in")
        .order("sent_at", { ascending: false }).limit(1).maybeSingle();
      const lastInMs = lastIn?.sent_at ? Date.parse(lastIn.sent_at as string) : NaN;
      if (Number.isNaN(lastInMs)) { totals.skipped_no_inbound++; continue; }

      const elapsed = Date.now() - lastInMs;
      const target = elapsed >= WINDOW_MS ? LABEL_CLOSED : (WINDOW_MS - elapsed <= CLOSING_SOON_MS ? LABEL_CLOSING : LABEL_OPEN);

      try {
        const current = await getConversationLabels(cwConvId, acct);
        if (current.includes(target) && current.filter((l) => WINDOW_LABELS.has(l)).length === 1) {
          totals.unchanged++;
          continue;
        }
        const next = [...current.filter((l) => !WINDOW_LABELS.has(l)), target];
        await setConversationLabels(cwConvId, next, acct);
        totals.labeled++;
      } catch (e) {
        totals.errors.push(`conv ${cwConvId}: ${errorMessage(e)}`);
      }
    }
  }

  if (totals.labeled > 0 || totals.errors.length > 0) {
    db.from("events").insert({ source: "label-window", event_type: "sync_completed", payload: totals }).then(() => {}, () => {});
  }
  return json(totals);
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

function errorMessage(e: unknown): string { return e instanceof Error ? e.message : String(e); }

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
