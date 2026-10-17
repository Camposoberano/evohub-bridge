// Confere cada webhook de entrada contra a mensagem persistida e, nos cliques,
// contra o claim da ação. Usa o evento bruto que já foi salvo antes do HTTP 200.
import { accountForChannel } from "./accounts.ts";
import {
  normalizeHybridButtonReply,
  normalizeHybridMenuClick,
} from "./hybrid-menu.ts";
import { type DbClient } from "./supabase.ts";

type Json = Record<string, unknown>;
type RawEvent = { id: string; received_at: string; payload: Json };
type MessageRow = {
  id: string;
  meta_message_id: string;
  conversation_id: string;
  channel_id: string;
  created_at: string;
};
type DeliveryRow = { delivery_id: string; received_at: string };

export type InboundIncident = {
  event_id: string;
  message_id: string;
  channel_id: string | null;
  channel: string;
  contact_suffix: string;
  received_at: string;
  choice: string | null;
  state:
    | "missing_message"
    | "missing_action"
    | "action_failed"
    | "missing_channel"
    | "recovered_late";
  reason: string;
  delay_minutes?: number;
  can_retry: boolean;
  chatwoot_url: string | null;
};

type Candidate = {
  eventId: string;
  messageId: string;
  receivedAt: string;
  instance: string;
  contactSuffix: string;
  choice: string | null;
};

function asObject(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Json
    : {};
}

export function inboundCandidate(event: RawEvent): Candidate | null {
  const payload = asObject(event.payload);
  const msg = asObject(payload.message);
  if (
    msg.fromMe !== false || msg.isGroup === true ||
    asObject(payload.chat).wa_isGroup === true ||
    String(msg.chatid ?? "").includes("@g.us")
  ) return null;
  const id = String(msg.id ?? "").trim();
  const instance = String(payload.instanceName ?? payload.instance ?? "")
    .trim();
  if (!id || !instance || id.startsWith("call_")) return null;
  const content = asObject(msg.content);
  const rawChoice = String(
    msg.buttonOrListid ?? content.buttonOrListid ?? content.selectedRowID ??
      asObject(content.singleSelectReply).selectedRowID ??
      asObject(content.buttonReply).selectedButtonId ?? "",
  ).trim();
  const visibleText = String(
    content.text ?? content.body ?? content.title ?? msg.text ?? "",
  ).trim();
  const choice = normalizeHybridMenuClick(rawChoice || undefined) ??
    normalizeHybridButtonReply(visibleText) ?? null;
  const phone = String(msg.sender_pn ?? msg.chatid ?? "").replace(/\D/g, "");
  return {
    eventId: event.id,
    messageId: id,
    receivedAt: event.received_at,
    instance,
    contactSuffix: phone ? `••••${phone.slice(-4)}` : "não identificado",
    choice,
  };
}

function chunks<T>(values: T[], size = 25): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    result.push(values.slice(i, i + size));
  }
  return result;
}

async function rowsIn(
  db: DbClient,
  table: string,
  columns: string,
  key: string,
  values: string[],
): Promise<Json[]> {
  const result: Json[] = [];
  for (const part of chunks([...new Set(values)])) {
    const { data, error } = await db.from(table).select(columns).in(key, part);
    if (error) {
      throw new Error(`${table}: ${error.code ?? "consulta indisponível"}`);
    }
    result.push(...(data ?? []));
  }
  return result;
}

export function inboundState(
  ageMs: number,
  hasMessage: boolean,
  choice: string | null,
  actionClaim: boolean,
  actionFailed: boolean,
): InboundIncident["state"] | null {
  if (ageMs < 90_000) return null;
  if (!hasMessage) return "missing_message";
  if (actionFailed && actionClaim) return "action_failed";
  if (choice && !actionClaim) return "missing_action";
  return null;
}

export async function auditInboundIncidents(
  db: DbClient,
  hours = 72,
  now = new Date(),
): Promise<{
  checked_at: string;
  scanned: number;
  late: number;
  incidents: InboundIncident[];
  delayed: InboundIncident[];
}> {
  const since = new Date(now.getTime() - hours * 3_600_000).toISOString();
  const { data: raw, error: rawError } = await db.from("events")
    .select("id,received_at,payload")
    .eq("source", "uazapi").eq("event_type", "messages")
    .eq("payload->message->>fromMe", "false")
    .gte("received_at", since)
    .order("received_at", { ascending: false }).limit(2000);
  if (rawError) {
    throw new Error(`events/raw: ${rawError.code ?? "consulta indisponível"}`);
  }
  const candidates: Candidate[] = (raw ?? []).map((event: RawEvent) =>
    inboundCandidate(event)
  )
    .filter((candidate: Candidate | null): candidate is Candidate =>
      Boolean(candidate)
    );
  if (!candidates.length) {
    return {
      checked_at: now.toISOString(),
      scanned: 0,
      late: 0,
      incidents: [],
      delayed: [],
    };
  }

  const ids = candidates.map((candidate) => candidate.messageId);
  const [messages, channels, failures] = await Promise.all([
    rowsIn(
      db,
      "messages",
      "id,meta_message_id,conversation_id,channel_id,created_at",
      "meta_message_id",
      ids,
    ),
    db.from("channels").select("id,name,external_id"),
    db.from("events").select("event_type,payload,received_at")
      .eq("source", "uazapi")
      .in("event_type", [
        "inbound_processing_failed",
        "inbound_ingest_failed",
        "inbound_action_failed",
      ])
      .gte("received_at", since).order("received_at", { ascending: false })
      .limit(2000),
  ]);
  if (channels.error) {
    throw new Error(
      `channels: ${channels.error.code ?? "consulta indisponível"}`,
    );
  }
  if (failures.error) {
    throw new Error(
      `events/failures: ${failures.error.code ?? "consulta indisponível"}`,
    );
  }
  const channelByName = new Map<string, Json>();
  for (const channel of channels.data ?? []) {
    channelByName.set(String(channel.name ?? ""), channel);
    if (channel.external_id) {
      channelByName.set(String(channel.external_id), channel);
    }
  }
  const messageById = new Map<string, MessageRow>();
  for (const message of messages as MessageRow[]) {
    messageById.set(message.meta_message_id, message);
  }
  const claimKeys = candidates.flatMap((candidate) => {
    const channelId = String(channelByName.get(candidate.instance)?.id ?? "");
    if (!channelId) return [];
    return [
      `wa-${channelId}-${candidate.messageId}`,
      ...(candidate.choice
        ? [`uazapi-click-${channelId}-${candidate.messageId}`]
        : []),
    ];
  });
  const deliveries = await rowsIn(
    db,
    "deliveries",
    "delivery_id,received_at",
    "delivery_id",
    claimKeys,
  ) as DeliveryRow[];
  const claimById = new Map(
    deliveries.map((delivery) => [delivery.delivery_id, delivery]),
  );
  const failureByEvent = new Map<string, Json>();
  for (const failure of failures.data ?? []) {
    const eventId = String(asObject(failure.payload).raw_event_id ?? "");
    if (eventId && !failureByEvent.has(eventId)) {
      failureByEvent.set(eventId, failure);
    }
  }

  let late = 0;
  const incidents: InboundIncident[] = [];
  const delayed: InboundIncident[] = [];
  for (const candidate of candidates) {
    const channel = channelByName.get(candidate.instance);
    const channelId = channel ? String(channel.id) : null;
    const message = messageById.get(candidate.messageId);
    const failure = failureByEvent.get(candidate.eventId);
    const actionClaim = Boolean(
      channelId &&
        claimById.has(`uazapi-click-${channelId}-${candidate.messageId}`),
    );
    const actionFailed = failure?.event_type === "inbound_action_failed";
    const ageMs = now.getTime() - Date.parse(candidate.receivedAt);
    const state = channelId
      ? inboundState(
        ageMs,
        Boolean(message),
        candidate.choice,
        actionClaim,
        actionFailed,
      )
      : ageMs >= 90_000
      ? "missing_channel"
      : null;
    const delayMs = message
      ? Date.parse(message.created_at) - Date.parse(candidate.receivedAt)
      : 0;
    if (delayMs > 60_000) late++;
    if (!state && delayMs <= 60_000) continue;
    const reason = state === "missing_channel"
      ? "Instância sem canal cadastrado"
      : state === "action_failed"
      ? `Ação iniciou e falhou (${
        String(asObject(failure?.payload).reason ?? "erro")
      }); confira a conversa antes de tentar novamente`
      : state === "missing_action"
      ? "Clique registrado, mas a ação não foi iniciada"
      : failure
      ? `Entrada interrompida (${
        String(asObject(failure.payload).reason ?? "erro")
      })`
      : "Webhook recebido, mas a mensagem não entrou";
    const row: InboundIncident = {
      event_id: candidate.eventId,
      message_id: candidate.messageId,
      channel_id: channelId,
      channel: String(channel?.name ?? candidate.instance),
      contact_suffix: candidate.contactSuffix,
      received_at: candidate.receivedAt,
      choice: candidate.choice,
      state: state ?? "recovered_late",
      reason: state
        ? reason
        : `Mensagem registrada ${
          Math.round(delayMs / 60_000)
        } min após o webhook`,
      delay_minutes: delayMs > 60_000
        ? Math.round(delayMs / 60_000)
        : undefined,
      can_retry: state === "missing_message" || state === "missing_action",
      chatwoot_url: null,
    };
    if (state) incidents.push(row);
    else delayed.push(row);
  }

  const records = [...incidents, ...delayed];
  const conversationIds = records.map((incident) =>
    messageById.get(incident.message_id)?.conversation_id ?? ""
  ).filter(Boolean);
  const conversations = await rowsIn(
    db,
    "conversations",
    "id,chatwoot_conversation_id,channel_id",
    "id",
    conversationIds,
  );
  const conversationById = new Map(
    conversations.map((conv) => [String(conv.id), conv]),
  );
  const accountByChannel = new Map<
    string,
    { url: string; accountId: string }
  >();
  for (const incident of records) {
    if (!incident.channel_id) continue;
    const message = messageById.get(incident.message_id);
    const conversation = message
      ? conversationById.get(message.conversation_id)
      : null;
    if (!conversation?.chatwoot_conversation_id) continue;
    if (!accountByChannel.has(incident.channel_id)) {
      accountByChannel.set(
        incident.channel_id,
        await accountForChannel(incident.channel_id),
      );
    }
    const acct = accountByChannel.get(incident.channel_id)!;
    incident.chatwoot_url = `${acct.url.replace(/\/$/, "")}/app/accounts/${
      encodeURIComponent(acct.accountId)
    }/conversations/${conversation.chatwoot_conversation_id}`;
  }
  return {
    checked_at: now.toISOString(),
    scanned: candidates.length,
    late,
    incidents,
    delayed,
  };
}
