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

const WINDOW_24H_MS = 24 * 60 * 60 * 1000;
const WINDOW_72H_MS = 72 * 60 * 60 * 1000; // CTWA/anúncio (free entry point) = 72h
const CLOSING_SOON_MS = 2 * 60 * 60 * 1000; // <2h pra fechar (regras Meta 2026: aviso antecipado)
const LABEL_OPEN = "janela-aberta";
const LABEL_CLOSING = "janela-fechando";
const LABEL_CLOSED = "janela-fechada";
const WINDOW_LABELS = new Set([LABEL_OPEN, LABEL_CLOSING, LABEL_CLOSED]);
// etiquetas INFORMATIVAS (o time não mexe, só lê): origem e tipo de canal.
const LABEL_ANUNCIO = "origem-anuncio";
const LABEL_OFICIAL = "canal-oficial";
const LABEL_NAO_OFICIAL = "canal-nao-oficial";

export async function handle(req: Request): Promise<Response> {
  if (!["GET", "POST"].includes(req.method)) return json({ error: "method not allowed" }, 405);
  const url = new URL(req.url);
  if (!isAuthorized(req, url)) return json({ error: "unauthorized" }, 401);

  const convLimit = intParam(url, "conversation_limit", 80, 1, 200);
  const db = admin();

  const { data: channels, error: chErr } = await db.from("channels")
    .select("id,name,chatwoot_inbox_id,phone_number_id,external_id,type")
    .in("type", ["whatsapp", "facebook", "instagram"]).eq("status", "active");
  if (chErr) return json({ error: chErr.message }, 500);

  const totals = { channels: channels?.length ?? 0, conversations_scanned: 0, labeled: 0, skipped_no_inbound: 0, unchanged: 0, errors: [] as string[] };

  for (const ch of channels ?? []) {
    const { data: convs, error: convErr } = await db.from("conversations")
      .select("id,chatwoot_conversation_id,origem")
      .eq("channel_id", ch.id).neq("status", "resolved")
      .order("opened_at", { ascending: false }).limit(convLimit);
    if (convErr) { totals.errors.push(`${ch.name}: ${convErr.message}`); continue; }

    const acct = await accountForChannel(ch.id as string);
    // canal oficial Meta = tem phone_number_id; não-oficial (ryzeapi/uazapi) = external_id sem phone.
    const oficial = ch.type !== "whatsapp" || Boolean(ch.phone_number_id);
    const canalLabel = oficial ? LABEL_OFICIAL : LABEL_NAO_OFICIAL;

    for (const conv of convs ?? []) {
      const cwConvId = conv.chatwoot_conversation_id as number | undefined;
      if (!cwConvId) continue;
      totals.conversations_scanned++;

      const { data: lastIn } = await db.from("messages").select("sent_at")
        .eq("conversation_id", conv.id).eq("direction", "in")
        .order("sent_at", { ascending: false }).limit(1).maybeSingle();
      const lastInMs = lastIn?.sent_at ? Date.parse(lastIn.sent_at as string) : NaN;
      if (Number.isNaN(lastInMs)) { totals.skipped_no_inbound++; continue; }

      // anúncio (CTWA/free entry point) = 72h; orgânico = 24h. Regras Meta ago-out/2026.
      const windowMs = conv.origem === "anuncio" ? WINDOW_72H_MS : WINDOW_24H_MS;
      const elapsed = Date.now() - lastInMs;
      const target = elapsed >= windowMs ? LABEL_CLOSED : (windowMs - elapsed <= CLOSING_SOON_MS ? LABEL_CLOSING : LABEL_OPEN);

      try {
        const current = await getConversationLabels(cwConvId, acct);
        const extras = [canalLabel, ...(conv.origem === "anuncio" ? [LABEL_ANUNCIO] : [])];
        const jaTemExtras = extras.every((l) => current.includes(l));
        if (current.includes(target) && current.filter((l) => WINDOW_LABELS.has(l)).length === 1 && jaTemExtras) {
          totals.unchanged++;
          continue;
        }
        const next = [...new Set([...current.filter((l) => !WINDOW_LABELS.has(l)), target, ...extras])];
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
