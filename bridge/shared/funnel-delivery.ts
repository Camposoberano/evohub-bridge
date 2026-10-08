import type { DbClient } from "./supabase.ts";

type Json = Record<string, unknown>;

const DELIVERY_META_KEY = "__funnel_delivery";
export const MAX_AUTOMATIC_DELIVERY_RETRIES = 3;

export type FunnelDeliveryOutcome =
  | "started"
  | "sent"
  | "rejected"
  | "retry_scheduled"
  | "uncertain"
  | "media_unavailable"
  | "blocked"
  | "partial";

export type FunnelDeliveryMetadata = {
  attempts: number;
  attempt_id?: string;
  last_attempt_at?: string;
  last_outcome?: FunnelDeliveryOutcome;
  retry_at?: string;
  provider_status?: number;
  provider_code?: string | number;
};

export type FunnelDeliveryEvent = {
  scheduled_message_id: string;
  conversation_id?: string | null;
  funnel?: string | null;
  day?: number | null;
  step?: number | null;
  type?: string | null;
  channel_type?: string | null;
  attempt_id?: string | null;
  attempt_number?: number | null;
  outcome: FunnelDeliveryOutcome;
  http_status?: number | null;
  provider_code?: string | number | null;
  provider_subcode?: string | number | null;
  provider_error_type?: string | null;
  retryable?: boolean;
  retry_at?: string | null;
  failure_stage?: string | null;
  media_key?: string | null;
  partial?: boolean;
};

export function deliveryMetadata(payload: unknown): FunnelDeliveryMetadata {
  const source = payload && typeof payload === "object"
    ? (payload as Json)[DELIVERY_META_KEY]
    : null;
  if (!source || typeof source !== "object") return { attempts: 0 };
  const meta = source as Json;
  return {
    attempts: Math.max(0, Number(meta.attempts ?? 0) || 0),
    attempt_id: typeof meta.attempt_id === "string"
      ? meta.attempt_id
      : undefined,
    last_attempt_at: typeof meta.last_attempt_at === "string"
      ? meta.last_attempt_at
      : undefined,
    last_outcome: typeof meta.last_outcome === "string"
      ? meta.last_outcome as FunnelDeliveryOutcome
      : undefined,
    retry_at: typeof meta.retry_at === "string" ? meta.retry_at : undefined,
    provider_status: Number.isFinite(Number(meta.provider_status))
      ? Number(meta.provider_status)
      : undefined,
    provider_code: typeof meta.provider_code === "string" ||
        typeof meta.provider_code === "number"
      ? meta.provider_code
      : undefined,
  };
}

export const FUNNEL_SEQUENCE_ID_KEY = "__funnel_sequence_id";

export function payloadWithoutDeliveryMetadata(payload: unknown): Json {
  const result = payload && typeof payload === "object"
    ? { ...(payload as Json) }
    : {};
  delete result[DELIVERY_META_KEY];
  delete result[FUNNEL_SEQUENCE_ID_KEY];
  return result;
}

export function payloadWithDeliveryMetadata(
  payload: unknown,
  metadata: FunnelDeliveryMetadata,
): Json {
  const result = payload && typeof payload === "object"
    ? { ...(payload as Json) }
    : {};
  delete result[DELIVERY_META_KEY];
  return {
    ...result,
    [DELIVERY_META_KEY]: metadata,
  };
}

export function nextFunnelRetryAt(
  attemptNumber: number,
  now = Date.now(),
): string {
  const delay = Math.min(
    180_000 * 2 ** Math.max(0, attemptNumber - 1),
    15 * 60_000,
  );
  return new Date(now + delay).toISOString();
}

export function providerDiagnostic(data: unknown): {
  code: string | number | null;
  subcode: string | number | null;
  type: string | null;
} {
  const root = data && typeof data === "object" ? data as Json : {};
  const error = root.error && typeof root.error === "object"
    ? root.error as Json
    : {};
  const code = error.code;
  const subcode = error.error_subcode ?? error.subcode;
  return {
    code: typeof code === "string" || typeof code === "number" ? code : null,
    subcode: typeof subcode === "string" || typeof subcode === "number"
      ? subcode
      : null,
    type: typeof error.type === "string" ? error.type.slice(0, 80) : null,
  };
}

export async function recordFunnelDeliveryEvent(
  db: DbClient,
  channelId: string | null | undefined,
  event: FunnelDeliveryEvent,
): Promise<void> {
  try {
    const { error } = await db.from("events").insert({
      source: "funil",
      event_type: "funnel_delivery_attempt",
      channel_id: channelId ?? null,
      payload: event,
    });
    if (error) {
      console.error(
        "funnel-delivery: falha ao registrar resultado",
        event.scheduled_message_id,
        error,
      );
    }
  } catch (error) {
    console.error(
      "funnel-delivery: exceção ao registrar resultado",
      event.scheduled_message_id,
      error,
    );
  }
}

export async function persistFunnelDeliveryState(
  db: DbClient,
  scheduledMessageId: string,
  payload: unknown,
  metadata: FunnelDeliveryMetadata,
  status: "pending" | "sent" | "failed",
  sentAt?: string,
  retryAt?: string,
): Promise<void> {
  const update: Json = {
    status,
    payload: payloadWithDeliveryMetadata(payload, metadata),
  };
  if (status === "sent") update.sent_at = sentAt ?? new Date().toISOString();
  if (retryAt) update.send_at = retryAt;
  const { error } = await db.from("scheduled_messages").update(update)
    .eq("id", scheduledMessageId);
  if (error) {
    console.error(
      "funnel-delivery: falha ao persistir estado",
      scheduledMessageId,
      error,
    );
    throw error;
  }
}
