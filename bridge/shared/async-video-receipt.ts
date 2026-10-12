/** Receipt check for async Uazapi video sends. A queued response is not delivery. */
import { instPost } from "./uazapi.ts";

type Json = Record<string, unknown>;
type Route = { token: string };

export type VideoReceiptCriteria = {
  recipient: string;
  mediaUrl: string;
  trackId: string;
  providerId?: string | null;
  startedAt: number;
};

const CONFIRMED = new Set(["Delivered", "Read", "Played"]);
const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");

export function matchingAsyncVideoReceipt(
  message: Json,
  criteria: VideoReceiptCriteria,
): boolean {
  const timestamp = Number(message.messageTimestamp);
  const payload = (message.sendPayload ?? {}) as Json;
  return message.fromMe === true &&
    message.chatid === `${digits(criteria.recipient)}@s.whatsapp.net` &&
    String(message.messageType ?? "").toLowerCase().includes("video") &&
    payload.file === criteria.mediaUrl &&
    message.track_id === criteria.trackId &&
    (!criteria.providerId || message.id === criteria.providerId) &&
    CONFIRMED.has(String(message.status ?? "")) &&
    Number.isFinite(timestamp) &&
    timestamp >= criteria.startedAt - 30_000 &&
    timestamp <= criteria.startedAt + 180_000;
}

export class AsyncVideoReceiptError extends Error {
  readonly stage = "await_receipt";
  constructor(readonly elapsedMs: number, reason: "missing" | "ambiguous" | "lookup_failed") {
    super(`uazapi await_receipt ${reason} após ${elapsedMs}ms`);
    this.name = "AsyncVideoReceiptError";
  }
}

export async function waitForVideoReceipt(
  route: Route,
  criteria: VideoReceiptCriteria,
  opts: {
    maxWaitMs?: number;
    intervalMs?: number;
    lookup?: (token: string, recipient: string) => Promise<Json[]>;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<Json> {
  const maxWaitMs = opts.maxWaitMs ?? 20_000;
  const intervalMs = opts.intervalMs ?? 2_000;
  const started = Date.now();
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const lookup = opts.lookup ?? lookupVideoReceipts;
  do {
    let messages: Json[];
    try {
      messages = await lookup(route.token, criteria.recipient);
    } catch {
      throw new AsyncVideoReceiptError(Date.now() - started, "lookup_failed");
    }
    const matches = messages.filter((message) => matchingAsyncVideoReceipt(message, criteria));
    if (matches.length > 1) {
      throw new AsyncVideoReceiptError(Date.now() - started, "ambiguous");
    }
    if (matches.length === 1) return matches[0];
    if (Date.now() - started >= maxWaitMs) break;
    await sleep(Math.min(intervalMs, maxWaitMs - (Date.now() - started)));
  } while (Date.now() - started <= maxWaitMs);
  throw new AsyncVideoReceiptError(Date.now() - started, "missing");
}

async function lookupVideoReceipts(token: string, recipient: string): Promise<Json[]> {
  const messages: Json[] = [];
  for (let offset = 0; offset <= 400; offset += 200) {
    const page = await instPost("/message/find", token, {
      chatid: `${digits(recipient)}@s.whatsapp.net`, limit: 200, offset,
    });
    if (!page.ok) throw new Error("provider_lookup_failed");
    const found = Array.isArray((page.data as Json).messages)
      ? (page.data as Json).messages as Json[] : [];
    messages.push(...found);
    if (found.length < 200) break;
  }
  return messages;
}
