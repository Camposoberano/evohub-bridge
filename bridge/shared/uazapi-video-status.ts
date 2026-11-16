/** Extract only confirmed outbound delivery notices; no personal data is logged. */
type Json = Record<string, unknown>;

const CONFIRMED = new Set(["Delivered", "Read", "Played"]);
const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");

export type ConfirmedVideoNotice = {
  instanceName: string;
  recipient: string;
  messageIds: string[];
};

export function confirmedVideoNotice(
  eventType: string,
  payload: Json,
): ConfirmedVideoNotice | null {
  if (eventType !== "ReadReceipt" && eventType !== "messages_update") return null;
  const raw = eventType === "ReadReceipt" ? payload.event : payload.data ?? payload.event;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const event = raw as Json;
  // Atualizações dos demais números não devem consultar o histórico do 5895.
  if (digits(payload.owner) !== "5519999715895") return null;
  const status = String(event.Type ?? event.status ?? event.Status ?? "");
  if (!CONFIRMED.has(status)) return null;
  // ReadReceipt.IsFromMe describes the ack sender and is false for the
  // outbound receipts observed in production. The history match checks fromMe.
  const instanceName = String(payload.instanceName ?? payload.instance ?? "").trim();
  const recipient = digits(event.chatid ?? event.chatId ?? event.chat);
  const rawIds = Array.isArray(event.MessageIDs)
    ? event.MessageIDs
    : [event.messageId ?? event.id];
  const messageIds = [...new Set(rawIds.filter((id): id is string =>
    typeof id === "string" && id.length > 0 && id.length <= 256
  ))].slice(0, 50);
  if (!instanceName || !/^55\d{10,11}$/.test(recipient) || !messageIds.length) {
    return null;
  }
  return { instanceName, recipient, messageIds };
}
