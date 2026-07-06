// funil-control — controle manual do funil (pause/stop/resume/status).
// Chamado por macros do Chatwoot ou API direta.
// Auth: ?token=<CHATWOOT_WEBHOOK_SECRET>.
import { admin } from "../shared/supabase.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { env } from "../shared/env.ts";
import { createConversationMessage } from "../shared/chatwoot.ts";
import { accountForChannel } from "../shared/accounts.ts";

type Json = Record<string, unknown>;

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  if (!timingSafeEqual(token, env("CHATWOOT_WEBHOOK_SECRET"))) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({})) as Json;
  const action = (body.action as string) ?? url.searchParams.get("action") ?? "";
  const cwConvId = Number(body.chatwoot_conversation_id ?? body.conversation_id);
  if (!cwConvId) return json({ error: "chatwoot_conversation_id obrigatório" }, 400);

  const db = admin();
  const { data: conv } = await db.from("conversations").select("id, channel_id, chatwoot_conversation_id")
    .eq("chatwoot_conversation_id", cwConvId).maybeSingle();
  if (!conv) return json({ error: "conversa não encontrada" }, 404);

  const acct = await accountForChannel(conv.channel_id as string);

  if (action === "pause") {
    const { count: paused } = await db.from("scheduled_messages").update({ status: "paused" })
      .eq("conversation_id", conv.id).eq("status", "pending")
      .select("id", { count: "exact", head: true });
    await db.from("sales_sequences").update({ status: "paused" })
      .eq("conversation_id", conv.id).eq("status", "running");
    await nota(cwConvId, `⏸️ *Funil pausado* — ${paused ?? 0} mensagens pendentes suspensas.\nPara retomar: macro "▶️ Retomar Funil".`, acct);
    return json({ ok: true, action: "pause", paused: paused ?? 0 });
  }

  if (action === "stop") {
    const { count: cancelled } = await db.from("scheduled_messages").update({ status: "cancelled" })
      .eq("conversation_id", conv.id).in("status", ["pending", "paused"])
      .select("id", { count: "exact", head: true });
    await db.from("sales_sequences").update({ status: "cancelled" })
      .eq("conversation_id", conv.id).in("status", ["running", "paused"]);
    await nota(cwConvId, `⏹️ *Funil cancelado* — ${cancelled ?? 0} mensagens removidas da fila.`, acct);
    return json({ ok: true, action: "stop", cancelled: cancelled ?? 0 });
  }

  if (action === "resume") {
    const { count: resumed } = await db.from("scheduled_messages").update({ status: "pending" })
      .eq("conversation_id", conv.id).eq("status", "paused")
      .select("id", { count: "exact", head: true });
    await db.from("sales_sequences").update({ status: "running" })
      .eq("conversation_id", conv.id).eq("status", "paused");
    await nota(cwConvId, `▶️ *Funil retomado* — ${resumed ?? 0} mensagens reativadas.`, acct);
    return json({ ok: true, action: "resume", resumed: resumed ?? 0 });
  }

  if (action === "status") {
    const { data: seq } = await db.from("sales_sequences").select("funnel, status")
      .eq("conversation_id", conv.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const { count: pending } = await db.from("scheduled_messages").select("id", { count: "exact", head: true })
      .eq("conversation_id", conv.id).eq("status", "pending");
    const { count: paused } = await db.from("scheduled_messages").select("id", { count: "exact", head: true })
      .eq("conversation_id", conv.id).eq("status", "paused");
    const { count: sent } = await db.from("scheduled_messages").select("id", { count: "exact", head: true })
      .eq("conversation_id", conv.id).eq("status", "sent");
    return json({
      ok: true, funnel: seq?.funnel ?? null, sequence_status: seq?.status ?? null,
      pending: pending ?? 0, paused: paused ?? 0, sent: sent ?? 0,
    });
  }

  return json({ error: "ação desconhecida: " + action + " (use: pause, stop, resume, status)" }, 400);
}

async function nota(cwConvId: number, text: string, acct: string) {
  try { await createConversationMessage(cwConvId, { content: text, messageType: "outgoing", private: true }, acct); }
  catch (e) { console.warn("funil-control nota falhou:", String(e).slice(0, 120)); }
}

// Auto-pause: chamado pelo inbound quando intent é detectado em conversa com funil ativo.
export async function autoPauseFunil(conversationId: string): Promise<boolean> {
  const db = admin();
  const { data: seq } = await db.from("sales_sequences").select("id, status")
    .eq("conversation_id", conversationId).eq("status", "running").maybeSingle();
  if (!seq) return false;
  await db.from("scheduled_messages").update({ status: "paused" })
    .eq("conversation_id", conversationId).eq("status", "pending");
  await db.from("sales_sequences").update({ status: "paused" }).eq("id", seq.id);
  console.log("funil auto-paused:", conversationId);
  return true;
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
