type Json = Record<string, unknown>;

export function metaErrorDetail(data: unknown): string {
  if (!data || typeof data !== "object") return String(data ?? "");
  const error = (data as Json).error;
  if (!error || typeof error !== "object") return JSON.stringify(data);
  const message = (error as Json).message;
  return typeof message === "string" ? message : JSON.stringify(error);
}

export function isMetaWindowError(status: number, data: unknown): boolean {
  if (status !== 400) return false;
  const error = data && typeof data === "object" ? (data as Json).error : null;
  const code = error && typeof error === "object"
    ? Number((error as Json).code)
    : NaN;
  const detail = metaErrorDetail(data).toLowerCase();
  return code === 10 && (
    detail.includes("fora do espaço de tempo permitido") ||
    detail.includes("outside the allowed time window") ||
    detail.includes("24 hour") ||
    detail.includes("24-hour")
  );
}

export function metaDeliveryStatus(
  status: number,
  data: unknown,
): "failed" | "blocked" {
  return isMetaWindowError(status, data) ? "blocked" : "failed";
}
