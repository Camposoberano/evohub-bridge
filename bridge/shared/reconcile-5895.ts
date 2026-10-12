/** Confirm uncertain 5895 funnel pieces from provider receipts. Never sends a message. */
import { RESTORED_5895_FUNNEL } from "./funnel-identity.ts";
import { admin, claimDelivery, type DbClient } from "./supabase.ts";
import { instPost, listInstances } from "./uazapi.ts";
import type { ConfirmedVideoNotice } from "./uazapi-video-status.ts";

type Json = Record<string, unknown>;
type Row = {
  id: string;
  conversation_id: string;
  funnel: string;
  step: number;
  type: string;
  status: string;
  payload: Json;
};

const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const HUB_5895_NUMBER = "5519999715895";
const confirmedStatuses = new Set(["Delivered", "Read", "Played"]);
const MAX_CANDIDATES = 3;

export type ReconcileSummary = {
  checked: number;
  reconciled: number;
  unresolved: number;
  errors: Record<string, number>;
};

export function matchingReceipt(
  row: Pick<Row, "type" | "payload">,
  message: Json,
  attemptAt: number,
): boolean {
  const timestamp = Number(message.messageTimestamp);
  const delivery = (row.payload.__funnel_delivery ?? {}) as Json;
  const asyncTrackId = typeof delivery.async_track_id === "string"
    ? delivery.async_track_id : null;
  const latest = asyncTrackId ? attemptAt + 24 * 60 * 60_000 : attemptAt + 180_000;
  if (!Number.isFinite(timestamp) || timestamp < attemptAt - 30_000 ||
    timestamp > latest || message.fromMe !== true ||
    !confirmedStatuses.has(String(message.status))) return false;
  const sendPayload = (message.sendPayload ?? {}) as Json;
  if (asyncTrackId && message.track_id !== asyncTrackId) return false;
  if (["video", "document"].includes(row.type)) {
    return String(message.messageType).toLowerCase().includes(row.type) &&
      sendPayload.file === row.payload.media_url;
  }
  return row.type === "interactive" && sendPayload.text === row.payload.text;
}

export function uniqueConfirmedReceipt(matches: Json[]):
  | { receipt: Json; error: null }
  | { receipt: null; error: "receipt_missing" | "receipt_ambiguous" } {
  if (matches.length === 1) return { receipt: matches[0], error: null };
  return { receipt: null, error: matches.length === 0 ? "receipt_missing" : "receipt_ambiguous" };
}

function problem(summary: ReconcileSummary, code: string): void {
  summary.unresolved++;
  summary.errors[code] = (summary.errors[code] ?? 0) + 1;
}

export async function reconcile5895Uncertain(
  db: DbClient = admin(),
  now = Date.now(),
): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { checked: 0, reconciled: 0, unresolved: 0, errors: {} };
  const { data, error } = await db.from("scheduled_messages")
    .select("id,conversation_id,funnel,step,type,status,payload")
    .like("funnel", `${RESTORED_5895_FUNNEL}%`).eq("status", "failed")
    .eq("payload->__funnel_delivery->>last_outcome", "uncertain")
    .order("send_at", { ascending: true }).limit(1000);
  if (error) throw error;
  const ready = ((data ?? []) as Row[]).filter((row) => {
    const meta = row.payload?.__funnel_delivery as Json | undefined;
    const at = Date.parse(String(meta?.last_attempt_at ?? ""));
    return meta?.last_outcome === "uncertain" && Number.isFinite(at) &&
      at <= now - 60_000;
  });
  // Rotate the bounded batch so one ambiguous old receipt cannot starve later cases.
  const start = ready.length ? (Math.floor(now / 60_000) * MAX_CANDIDATES) % ready.length : 0;
  const candidates = [...ready.slice(start), ...ready.slice(0, start)].slice(0, MAX_CANDIDATES);
  if (!candidates.length) return summary;

  const ids = [...new Set(candidates.map((row) => row.conversation_id))];
  const { data: conversations, error: conversationsError } = await db.from("conversations")
    .select("id,chatwoot_conversation_id,channel_id,contacts(external_contact_id)")
    .in("id", ids);
  if (conversationsError) throw conversationsError;
  const byId = new Map(((conversations ?? []) as Json[]).map((row) => [String(row.id), row]));
  const channelIds = [...new Set([...byId.values()].map((row) => String(row.channel_id)))];
  if (byId.size !== ids.length || channelIds.length !== 1) throw new Error("invalid_channel");
  const { data: channel, error: channelError } = await db.from("channels")
    .select("phone_number").eq("id", channelIds[0]).single();
  if (channelError || digits(channel?.phone_number) !== HUB_5895_NUMBER) {
    throw new Error("invalid_channel");
  }
  const instance = (await listInstances()).find((item) =>
    digits(item.number) === digits(channel.phone_number)
  );
  if (!instance?.token) throw new Error("provider_instance_unavailable");

  for (const row of candidates) {
    summary.checked++;
    const conversation = byId.get(row.conversation_id)!;
    const recipient = digits((conversation.contacts as Json | null)?.external_contact_id);
    const meta = row.payload.__funnel_delivery as Json;
    const attemptAt = Date.parse(String(meta.last_attempt_at));
    const attemptId = String(meta.attempt_id ?? "");
    if (!/^55\d{10,11}$/.test(recipient) || !attemptId) {
      problem(summary, "invalid_attempt");
      continue;
    }
    if (!["video", "document", "interactive"].includes(row.type)) {
      problem(summary, "unsupported_type");
      continue;
    }
    try {
      const matches: Json[] = [];
      for (let offset = 0; offset <= 800; offset += 200) {
        const result = await instPost("/message/find", instance.token, {
          chatid: `${recipient}@s.whatsapp.net`, limit: 200, offset,
        });
        if (!result.ok) throw new Error("provider_lookup_failed");
        const page = Array.isArray((result.data as Json).messages)
          ? (result.data as Json).messages as Json[] : [];
        matches.push(...page.filter((message) => matchingReceipt(row, message, attemptAt)));
        if (page.length < 200) break;
      }
      const selected = uniqueConfirmedReceipt(matches);
      if (!selected.receipt) {
        problem(summary, selected.error);
        continue;
      }
      const receipt = selected.receipt;
      const providerAt = new Date(Number(receipt.messageTimestamp)).toISOString();
      const providerId = receipt.id == null ? null : String(receipt.id);
      const { data: updated, error: updateError } = await db.from("scheduled_messages")
        .update({
          status: "sent",
          sent_at: providerAt,
          payload: {
            ...row.payload,
            __funnel_delivery: {
              ...meta,
              last_outcome: "sent",
              reconciled_from: "uazapi_message_history",
              provider_status: String(receipt.status),
              provider_id: providerId,
              provider_copies: 1,
            },
          },
        }).eq("id", row.id).eq("status", "failed")
        .eq("payload->__funnel_delivery->>attempt_id", attemptId).select("id");
      if (updateError) throw updateError;
      if (updated?.length !== 1) {
        problem(summary, "attempt_changed");
        continue;
      }
      await claimDelivery(db, `funnel-sent-${row.id}`, "funnel-delivery-success");
      const { error: eventError } = await db.from("events").insert({
        source: "funil",
        event_type: "provider_delivery_reconciled",
        payload: {
          conversation_id: row.conversation_id,
          chatwoot_conversation_id: conversation.chatwoot_conversation_id,
          scheduled_message_id: row.id,
          step: row.step,
          provider_status: String(receipt.status),
          provider_id: providerId,
          provider_copies: 1,
          sent_at: providerAt,
          automated: true,
        },
      });
      if (eventError) throw eventError;
      summary.reconciled++;
    } catch (error) {
      problem(summary, error instanceof Error && error.message === "provider_lookup_failed"
        ? "provider_lookup_failed" : "reconciliation_failed");
    }
  }
  return summary;
}

/** A confirmed webhook narrows the search to its chat and provider message IDs.
 * The provider history remains the source of truth, and this function never sends. */
export async function reconcile5895VideoNotice(
  notice: ConfirmedVideoNotice,
  db: DbClient = admin(),
): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { checked: 0, reconciled: 0, unresolved: 0, errors: {} };
  const { data: contacts, error: contactsError } = await db.from("contacts")
    .select("id,channel_id").eq("external_contact_id", notice.recipient).limit(20);
  if (contactsError) throw contactsError;
  const contactRows = (contacts ?? []) as Json[];
  if (!contactRows.length) return summary;
  const channelIds = [...new Set(contactRows.map((item) => String(item.channel_id)))];
  const { data: channels, error: channelsError } = await db.from("channels")
    .select("id,phone_number").in("id", channelIds);
  if (channelsError) throw channelsError;
  const channel = ((channels ?? []) as Json[]).find((item) =>
    digits(item.phone_number) === HUB_5895_NUMBER
  );
  if (!channel) return summary;
  const contactIds = contactRows.filter((item) => item.channel_id === channel.id)
    .map((item) => item.id);
  if (!contactIds.length) return summary;
  const { data: conversations, error: conversationsError } = await db
    .from("conversations").select("id,chatwoot_conversation_id")
    .eq("channel_id", channel.id).in("contact_id", contactIds)
    .order("opened_at", { ascending: false }).limit(100);
  if (conversationsError) throw conversationsError;
  const conversationRows = (conversations ?? []) as Json[];
  if (!conversationRows.length) return summary;
  const byId = new Map(conversationRows.map((item) => [String(item.id), item]));
  const { data: rows, error: rowsError } = await db.from("scheduled_messages")
    .select("id,conversation_id,funnel,step,type,status,payload")
    .in("conversation_id", [...byId.keys()])
    .eq("funnel", RESTORED_5895_FUNNEL).eq("type", "video")
    .eq("status", "failed")
    .eq("payload->__funnel_delivery->>last_outcome", "uncertain")
    .limit(500);
  if (rowsError) throw rowsError;
  const candidates = ((rows ?? []) as Row[]).filter((row) => {
    const meta = row.payload?.__funnel_delivery as Json | undefined;
    return typeof meta?.async_track_id === "string" &&
      typeof meta?.attempt_id === "string";
  });
  if (!candidates.length) return summary;

  const instance = (await listInstances()).find((item) =>
    item.name === notice.instanceName && digits(item.number) === HUB_5895_NUMBER
  );
  if (!instance?.token) return summary;

  const wantedIds = new Set(notice.messageIds);
  const providerMessages: Json[] = [];
  for (let offset = 0; offset <= 800; offset += 200) {
    const result = await instPost("/message/find", instance.token, {
      chatid: `${notice.recipient}@s.whatsapp.net`, limit: 200, offset,
    });
    if (!result.ok) throw new Error("provider_lookup_failed");
    const page = Array.isArray((result.data as Json).messages)
      ? (result.data as Json).messages as Json[] : [];
    providerMessages.push(...page.filter((message) => wantedIds.has(String(message.id))));
    if (page.length < 200) break;
  }
  for (const row of candidates) {
    const meta = row.payload.__funnel_delivery as Json;
    const attemptAt = Date.parse(String(meta.last_attempt_at ?? ""));
    if (!Number.isFinite(attemptAt)) continue;
    const selected = uniqueConfirmedReceipt(providerMessages.filter((message) =>
      matchingReceipt(row, message, attemptAt)
    ));
    if (!selected.receipt) continue;
    summary.checked++;
    const receipt = selected.receipt;
    const providerAt = new Date(Number(receipt.messageTimestamp)).toISOString();
    const providerId = String(receipt.id);
    const { data: updated, error: updateError } = await db.from("scheduled_messages")
      .update({
        status: "sent",
        sent_at: providerAt,
        payload: {
          ...row.payload,
          __funnel_delivery: {
            ...meta,
            last_outcome: "sent",
            reconciled_from: "uazapi_webhook_receipt",
            provider_status: String(receipt.status),
            provider_id: providerId,
            provider_copies: 1,
          },
        },
      }).eq("id", row.id).eq("status", "failed")
      .eq("payload->__funnel_delivery->>attempt_id", String(meta.attempt_id))
      .select("id");
    if (updateError) throw updateError;
    if (updated?.length !== 1) continue;
    await claimDelivery(db, `funnel-sent-${row.id}`, "funnel-delivery-success");
    const conversation = byId.get(row.conversation_id);
    const { error: eventError } = await db.from("events").insert({
      source: "funil",
      event_type: "provider_delivery_reconciled",
      payload: {
        conversation_id: row.conversation_id,
        chatwoot_conversation_id: conversation?.chatwoot_conversation_id ?? null,
        scheduled_message_id: row.id,
        step: row.step,
        provider_status: String(receipt.status),
        provider_id: providerId,
        provider_copies: 1,
        sent_at: providerAt,
        reconciled_from: "uazapi_webhook_receipt",
        automated: true,
      },
    });
    if (eventError) throw eventError;
    summary.reconciled++;
  }
  return summary;
}
