// metrics-rollup — agregação diária para daily_metrics (operacional + comercial).
// Acionável por agendamento (Coolify scheduled task / pg_cron) batendo em /metrics-rollup.
// Idempotente por (day, channel_id). Fase 4 refina avg_first_response_s e regras comerciais.
import { admin } from "../shared/supabase.ts";

type Db = ReturnType<typeof admin>;

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const day = url.searchParams.get("day") ?? yesterdayUtc();
  const db = admin();

  const { data: channels } = await db.from("channels").select("id");
  let processed = 0;

  for (const ch of channels ?? []) {
    const dayStart = `${day}T00:00:00Z`;
    const dayEnd = `${day}T23:59:59Z`;

    const [msgsIn, msgsOut, newContacts, opened, resolved, won, lost] = await Promise.all([
      count(db, "messages", (q) => q.eq("channel_id", ch.id).eq("direction", "in").gte("sent_at", dayStart).lte("sent_at", dayEnd)),
      count(db, "messages", (q) => q.eq("channel_id", ch.id).eq("direction", "out").gte("sent_at", dayStart).lte("sent_at", dayEnd)),
      count(db, "contacts", (q) => q.eq("channel_id", ch.id).gte("first_seen_at", dayStart).lte("first_seen_at", dayEnd)),
      count(db, "conversations", (q) => q.eq("channel_id", ch.id).gte("opened_at", dayStart).lte("opened_at", dayEnd)),
      count(db, "conversations", (q) => q.eq("channel_id", ch.id).gte("resolved_at", dayStart).lte("resolved_at", dayEnd)),
      count(db, "conversations", (q) => q.eq("channel_id", ch.id).eq("outcome", "won").gte("outcome_set_at", dayStart).lte("outcome_set_at", dayEnd)),
      count(db, "conversations", (q) => q.eq("channel_id", ch.id).eq("outcome", "lost").gte("outcome_set_at", dayStart).lte("outcome_set_at", dayEnd)),
    ]);

    await db.from("daily_metrics").upsert({
      day,
      channel_id: ch.id,
      msgs_in: msgsIn,
      msgs_out: msgsOut,
      new_contacts: newContacts,
      conversations_opened: opened,
      conversations_resolved: resolved,
      won_count: won,
      lost_count: lost,
      // TODO Fase 4: avg_first_response_s, won_value_cents
    }, { onConflict: "day,channel_id" });
    processed++;
  }

  return new Response(JSON.stringify({ day, channels: processed }), {
    headers: { "Content-Type": "application/json" },
  });
}

function yesterdayUtc(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

// deno-lint-ignore no-explicit-any
async function count(db: Db, table: string, build: (q: any) => any): Promise<number> {
  const { count } = await build(db.from(table).select("*", { count: "exact", head: true }));
  return count ?? 0;
}
