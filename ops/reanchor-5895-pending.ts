// One-time recovery of overdue 5895 funnel rows. Hold first, reconcile
// provider-confirmed failures, then resume with new business-hour times.
import { admin } from "../bridge/shared/supabase.ts";
import { clampBusinessTime } from "../bridge/shared/business-time.ts";
import { RESTORED_5895_FUNNEL } from "../bridge/shared/funnel-identity.ts";

type Row = {
  id: string;
  conversation_id: string;
  step: number;
  send_at: string;
  status: string;
};
type Snapshot = { createdAt: string; rows: Row[]; plannedAt?: Record<string, string> };
const db = admin();
const mode = Deno.args[0];
const snapshotPath = new URL("./reanchor-5895-pending.snapshot.json", import.meta.url);
const fail = (message: string): never => { throw new Error(message); };

async function readSnapshot(): Promise<Snapshot> {
  return JSON.parse(await Deno.readTextFile(snapshotPath)) as Snapshot;
}
async function saveSnapshot(snapshot: Snapshot) {
  await Deno.writeTextFile(snapshotPath, JSON.stringify(snapshot, null, 2));
}
async function getCurrent(ids: string[]): Promise<Map<string, Row>> {
  const out = new Map<string, Row>();
  for (let i = 0; i < ids.length; i += 20) {
    let result;
    for (let attempt = 0; attempt < 3; attempt++) {
      result = await db.from("scheduled_messages")
        .select("id,conversation_id,step,send_at,status")
        .in("id", ids.slice(i, i + 20)).limit(20);
      if (!result.error) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const { data, error } = result!;
    if (error) throw error;
    for (const row of (data ?? []) as Row[]) out.set(row.id, row);
  }
  return out;
}

if (mode === "--hold") {
  try {
    await Deno.stat(snapshotPath);
    fail("snapshot já existe; concluir ou revisar recuperação anterior");
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const now = new Date().toISOString();
  const { data: overdue, error: overdueError } = await db.from(
    "scheduled_messages",
  ).select("conversation_id").eq("funnel", RESTORED_5895_FUNNEL)
    .eq("status", "pending").lte("send_at", now).limit(1000);
  if (overdueError) throw overdueError;
  const conversations = [...new Set(
    ((overdue ?? []) as Row[]).map((row) => row.conversation_id),
  )];
  if (!conversations.length) fail("nenhuma conversa vencida para segurar");
  const { data: candidates, error: candidateError } = await db.from(
    "scheduled_messages",
  ).select("id,conversation_id,step,send_at,status")
    .eq("funnel", RESTORED_5895_FUNNEL).eq("status", "pending")
    .in("conversation_id", conversations).limit(1000);
  if (candidateError) throw candidateError;
  const rows = (candidates ?? []) as Row[];
  if (rows.length >= 1000) fail("lote atingiu limite de 1000 linhas");
  const snapshot: Snapshot = { createdAt: now, rows };
  await saveSnapshot(snapshot);
  let held = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const ids = rows.slice(i, i + 100).map((row) => row.id);
    const { data, error } = await db.from("scheduled_messages")
      .update({ status: "paused" }).in("id", ids)
      .eq("status", "pending").select("id");
    if (error) throw error;
    held += data?.length ?? 0;
  }
  const current = await getCurrent(rows.map((row) => row.id));
  const stillPending = [...current.values()].filter((row) => row.status === "pending");
  if (stillPending.length) fail(`${stillPending.length} linhas não entraram em espera`);
  console.log(JSON.stringify({ mode: "hold", conversations: conversations.length,
    candidates: rows.length, held, alreadySent: rows.length - held }));
  Deno.exit(0);
}

if (mode === "--plan" || mode === "--resume") {
  const snapshot = await readSnapshot();
  const current = await getCurrent(snapshot.rows.map((row) => row.id));
  const remaining = snapshot.rows.filter((row) => {
    const status = current.get(row.id)?.status;
    if (status === "sent" || status === "cancelled") return false;
    if (status !== "paused" && status !== "pending") {
      fail(`estado inesperado para ${row.id}: ${status}`);
    }
    return true;
  });
  if (!snapshot.plannedAt) {
    const groups = new Map<string, Row[]>();
    for (const row of remaining) {
      groups.set(row.conversation_id, [...(groups.get(row.conversation_id) ?? []), row]);
    }
    const orderedGroups = [...groups.entries()].sort((a, b) =>
      Math.min(...a[1].map((row) => Date.parse(row.send_at))) -
      Math.min(...b[1].map((row) => Date.parse(row.send_at)))
    );
    const plannedAt: Record<string, string> = {};
    orderedGroups.forEach(([, rows], index) => {
      rows.sort((a, b) =>
        Date.parse(a.send_at) - Date.parse(b.send_at) || a.step - b.step
      );
      let previousOld = Date.parse(rows[0].send_at);
      let previousNew = clampBusinessTime(
        Date.now() + 120_000 + index * 20_000,
      );
      for (let i = 0; i < rows.length; i++) {
        const old = Date.parse(rows[i].send_at);
        if (i > 0) {
          previousNew = clampBusinessTime(
            previousNew + Math.max(30_000, old - previousOld),
          );
          previousOld = old;
        }
        plannedAt[rows[i].id] = new Date(previousNew).toISOString();
      }
    });
    // Cap recovery traffic globally at one piece per 20-second slot (three
    // per minute). A delayed piece pushes later pieces of the same conversation
    // forward, so no original pause is shortened by the global cap.
    const slots = new Set<number>();
    const finalPlan: Record<string, string> = {};
    const indexes = new Map(orderedGroups.map(([id]) => [id, 0]));
    while (Object.keys(finalPlan).length < remaining.length) {
      const choices = orderedGroups.flatMap(([id, rows]) => {
        const index = indexes.get(id)!;
        if (index >= rows.length) return [];
        let candidate = Date.parse(plannedAt[rows[index].id]);
        if (index > 0) {
          const previous = rows[index - 1];
          const oldGap = Date.parse(rows[index].send_at) -
            Date.parse(previous.send_at);
          candidate = Math.max(candidate,
            Date.parse(finalPlan[previous.id]) + Math.max(30_000, oldGap));
        }
        return [{ id, row: rows[index], candidate }];
      }).sort((a, b) => a.candidate - b.candidate || a.id.localeCompare(b.id));
      const choice = choices[0];
      if (!choice) fail("não foi possível distribuir o lote");
      let slot = Math.ceil(clampBusinessTime(choice.candidate) / 20_000) *
        20_000;
      slot = Math.ceil(clampBusinessTime(slot) / 20_000) * 20_000;
      while (slots.has(slot)) {
        slot = Math.ceil(clampBusinessTime(slot + 20_000) / 20_000) *
          20_000;
      }
      slots.add(slot);
      finalPlan[choice.row.id] = new Date(slot).toISOString();
      indexes.set(choice.id, indexes.get(choice.id)! + 1);
    }
    snapshot.plannedAt = finalPlan;
    await saveSnapshot(snapshot);
  }
  const planned = Object.entries(snapshot.plannedAt);
  const first = planned.map(([, at]) => at).sort()[0];
  const last = planned.map(([, at]) => at).sort().at(-1);
  console.log(JSON.stringify({ mode, remaining: remaining.length,
    planned: planned.length, conversations: new Set(remaining.map((row) => row.conversation_id)).size,
    first, last }));
  if (mode === "--plan") Deno.exit(0);
  let resumed = 0;
  const ordered = remaining.sort((a, b) =>
    Date.parse(snapshot.plannedAt![a.id]) - Date.parse(snapshot.plannedAt![b.id])
  );
  for (let i = 0; i < ordered.length; i += 8) {
    const results = await Promise.all(ordered.slice(i, i + 8).map(async (row) => {
      const plannedAt = snapshot.plannedAt![row.id];
      const state = current.get(row.id)!;
      if (state.status === "pending" && state.send_at === plannedAt) return 0;
      if (state.status !== "paused" || state.send_at !== row.send_at) {
        fail(`linha alterada durante espera: ${row.id}`);
      }
      const { data, error } = await db.from("scheduled_messages")
        .update({ status: "pending", send_at: plannedAt })
        .eq("id", row.id).eq("status", "paused")
        .eq("send_at", row.send_at).select("id");
      if (error) throw error;
      if (data?.length !== 1) fail(`linha alterada durante retomada: ${row.id}`);
      return 1;
    }));
    resumed += results.reduce((sum, count) => sum + count, 0);
  }
  const { error: eventError } = await db.from("events").insert({
    source: "funil", event_type: "funnel_queue_reanchored",
    payload: { funnel: RESTORED_5895_FUNNEL,
      conversations: new Set(remaining.map((row) => row.conversation_id)).size,
      resumed, first, last },
  });
  if (eventError) throw eventError;
  console.log(JSON.stringify({ mode: "resume", resumed }));
  Deno.exit(0);
}
fail("use --hold, --plan ou --resume");
