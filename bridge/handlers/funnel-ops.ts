import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { env } from "../shared/env.ts";
import { admin } from "../shared/supabase.ts";
import { handle as funnelControl } from "./funil-control.ts";

type Json = Record<string, unknown>;

async function authenticatedUser(req: Request): Promise<Json | null> {
  const client = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: {
      headers: { Authorization: req.headers.get("Authorization") ?? "" },
    },
    auth: { persistSession: false },
  });
  return (await client.auth.getUser()).data?.user as Json | null;
}

export async function handle(req: Request): Promise<Response> {
  const user = await authenticatedUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);
  const db = admin();

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({})) as Json;
    const action = String(body.action ?? "").trim();
    const cwConversationId = Number(body.chatwoot_conversation_id ?? 0);
    if (action === "retry") {
      const messageId = String(body.message_id ?? "").trim();
      if (!messageId) return json({ error: "message_id obrigatório" }, 400);
      const { data, error } = await db.from("scheduled_messages")
        .update({ status: "pending", send_at: new Date().toISOString() })
        .eq("id", messageId).eq("status", "failed").select("id").maybeSingle();
      if (error) return json({ error: error.message }, 500);
      if (!data) return json({ error: "mensagem falha não encontrada" }, 404);
      await audit(db, "funnel_retry", user, { message_id: messageId });
      return json({ ok: true, action, message_id: messageId });
    }
    if (!["pause", "resume", "stop", "funil"].includes(action)) {
      return json({ error: "ação inválida" }, 400);
    }
    if (!cwConversationId) {
      return json({ error: "chatwoot_conversation_id obrigatório" }, 400);
    }
    const response = await funnelControl(
      new Request(
        `http://internal/funil-control?token=${
          encodeURIComponent(env("CHATWOOT_WEBHOOK_SECRET"))
        }`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            chatwoot_conversation_id: cwConversationId,
          }),
        },
      ),
    );
    const result = await response.json().catch(() => ({}));
    await audit(db, `funnel_${action}`, user, {
      chatwoot_conversation_id: cwConversationId,
      ok: response.ok,
    });
    return json(result, response.status);
  }
  if (req.method !== "GET") return json({ error: "method not allowed" }, 405);

  const { data: recentConversations, error: recentError } = await db.from(
    "conversations",
  )
    .select("id").order("opened_at", { ascending: false }).limit(500);
  if (recentError) return json({ error: recentError.message }, 500);
  const recentIds = (recentConversations ?? []).map((item: Json) => item.id)
    .filter(Boolean);
  const [activeSequenceResult, recentSequenceResult, messageResult] =
    await Promise.all([
      db.from("sales_sequences").select(
        "id,conversation_id,chatwoot_conversation_id,funnel,status",
      ).in("status", ["running", "paused"]).limit(1000),
      recentIds.length
        ? db.from("sales_sequences").select(
          "id,conversation_id,chatwoot_conversation_id,funnel,status",
        ).in("conversation_id", recentIds)
        : Promise.resolve({ data: [], error: null }),
      db.from("scheduled_messages").select(
        "id,conversation_id,chatwoot_conversation_id,funnel,day,step,type,send_at,status",
      ).order("send_at", { ascending: true }).limit(2000),
    ]);
  if (
    activeSequenceResult.error || recentSequenceResult.error ||
    messageResult.error
  ) {
    return json({
      error: activeSequenceResult.error?.message ??
        recentSequenceResult.error?.message ?? messageResult.error?.message,
    }, 500);
  }
  const sequenceMap = new Map<string, Json>();
  for (
    const item of [
      ...(activeSequenceResult.data ?? []),
      ...(recentSequenceResult.data ?? []),
    ] as Json[]
  ) {
    sequenceMap.set(String(item.id), item);
  }
  const sequences = [...sequenceMap.values()];
  const messages = messageResult.data ?? [];
  const conversationIds = [
    ...new Set(
      sequences.map((item: Json) => item.conversation_id).filter(Boolean),
    ),
  ];
  const { data: conversations } = conversationIds.length
    ? await db.from("conversations").select(
      "id,channel_id,contact_id,chatwoot_conversation_id,outcome,outcome_value_cents,status",
    ).in("id", conversationIds)
    : { data: [] };
  const contactIds = [
    ...new Set(
      (conversations ?? []).map((item: Json) => item.contact_id).filter(
        Boolean,
      ),
    ),
  ];
  const { data: contacts } = contactIds.length
    ? await db.from("contacts").select("id,name,phone,external_contact_id").in(
      "id",
      contactIds,
    )
    : { data: [] };
  const contactMap = new Map(
    (contacts ?? []).map((item: Json) => [item.id, item]),
  );
  const conversationMap = new Map(
    (conversations ?? []).map((
      item: Json,
    ) => [item.id, {
      ...item,
      contact: contactMap.get(item.contact_id) ?? null,
    }]),
  );
  const enrichedSequences = sequences.map((item: Json) => ({
    ...item,
    conversation: conversationMap.get(item.conversation_id) ?? null,
  }));
  const won = (conversations ?? []).filter((item: Json) =>
    item.outcome === "won"
  );
  const lost = (conversations ?? []).filter((item: Json) =>
    item.outcome === "lost"
  );
  const { data: failureEvents } = await db.from("events")
    .select("id,received_at,payload").eq("source", "funil").eq(
      "event_type",
      "send_failed",
    )
    .order("received_at", { ascending: false }).limit(200);

  return json({
    sequences: enrichedSequences,
    messages,
    failures: failureEvents ?? [],
    summary: {
      running: sequences.filter((item: Json) =>
        item.status === "running"
      ).length,
      paused: sequences.filter((item: Json) => item.status === "paused").length,
      pending:
        messages.filter((item: Json) => item.status === "pending").length,
      failed: messages.filter((item: Json) => item.status === "failed").length,
      sent: messages.filter((item: Json) => item.status === "sent").length,
      won: won.length,
      lost: lost.length,
      won_value_cents: won.reduce((total: number, item: Json) =>
        total + Number(item.outcome_value_cents ?? 0), 0),
      conversion_rate: won.length + lost.length
        ? Math.round((won.length / (won.length + lost.length)) * 100)
        : null,
    },
  });
}

async function audit(
  db: ReturnType<typeof admin>,
  eventType: string,
  user: Json,
  payload: Json,
) {
  await db.from("events").insert({
    source: "dashboard",
    event_type: eventType,
    payload: { ...payload, actor: user.id ?? null },
    occurred_at: new Date().toISOString(),
  });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
