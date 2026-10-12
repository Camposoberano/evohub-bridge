import { RESTORED_5895_FUNNEL } from "./funnel-identity.ts";

type Json = Record<string, unknown>;

/** A known receipt wait is visible as an incident, not a new queue failure each minute. */
export function isAwaitingVideoReceipt(
  row: Json,
  funnel: unknown,
): boolean {
  if (funnel !== RESTORED_5895_FUNNEL || row.status !== "failed" ||
    row.type !== "video") return false;
  const payload = row.payload && typeof row.payload === "object"
    ? row.payload as Json : {};
  const delivery = payload.__funnel_delivery &&
      typeof payload.__funnel_delivery === "object"
    ? payload.__funnel_delivery as Json : {};
  return delivery.last_outcome === "uncertain" &&
    delivery.transport_stage === "await_receipt" &&
    typeof delivery.async_track_id === "string" &&
    !!delivery.async_track_id &&
    typeof delivery.attempt_id === "string" && !!delivery.attempt_id;
}

/** Accept only a reconciliation decision on an async 5895 video, not an arbitrary failure. */
export function allowsContinuationAfterUnconfirmedVideo(
  row: Json,
  funnel: unknown,
): boolean {
  if (!isAwaitingVideoReceipt(row, funnel)) return false;
  const payload = row.payload as Json;
  const delivery = payload.__funnel_delivery as Json;
  return typeof delivery.followups_released_at === "string" &&
    delivery.provider_status === "Sent" &&
    typeof delivery.provider_id === "string" &&
    delivery.provider_copies === 1;
}
