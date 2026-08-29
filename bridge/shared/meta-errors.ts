type Json = Record<string, unknown>;

// Subcodes de janela fechada. O texto da mensagem muda por produto (WhatsApp/Messenger/IG)
// e por idioma da conta, então o subcode é o único sinal estável — foi o que faltou em
// 27-29/08, quando 47 saídas do Instagram viraram "falha genérica, tente novamente".
const WINDOW_SUBCODES = new Set([
  2534022, // IGApiException: "This message is sent outside of allowed window."
  2018278, // Messenger: fora da janela padrão de mensagem
]);

export function metaErrorDetail(data: unknown): string {
  if (!data || typeof data !== "object") return String(data ?? "");
  const error = (data as Json).error;
  if (!error || typeof error !== "object") return JSON.stringify(data);
  const message = (error as Json).message;
  return typeof message === "string" ? message : JSON.stringify(error);
}

function metaErrorNumber(data: unknown, field: string): number {
  const error = data && typeof data === "object" ? (data as Json).error : null;
  return error && typeof error === "object" ? Number((error as Json)[field]) : NaN;
}

export function isMetaWindowError(status: number, data: unknown): boolean {
  // WhatsApp/Messenger recusam com 400; Instagram recusa com 403.
  if (status !== 400 && status !== 403) return false;
  if (WINDOW_SUBCODES.has(metaErrorNumber(data, "error_subcode"))) return true;

  const detail = metaErrorDetail(data).toLowerCase();
  return metaErrorNumber(data, "code") === 10 && (
    detail.includes("fora do espaço de tempo permitido") ||
    detail.includes("fora do período permitido") ||
    detail.includes("outside of allowed window") ||
    detail.includes("outside the allowed time window") ||
    detail.includes("24 hour") ||
    detail.includes("24-hour")
  );
}

export function isMetaThreadControlError(data: unknown): boolean {
  const detail = metaErrorDetail(data).toLowerCase();
  return metaErrorNumber(data, "error_subcode") === 2018300 ||
    detail.includes("outro app está controlando") ||
    detail.includes("another app is controlling");
}

export function metaDeliveryStatus(
  status: number,
  data: unknown,
): "failed" | "blocked" {
  return isMetaWindowError(status, data) ? "blocked" : "failed";
}
