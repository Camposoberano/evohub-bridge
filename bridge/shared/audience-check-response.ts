// audience-check-response — mapeia a resposta do /chat/check da uazapi para status por telefone.
// Portado do hub CECAPE. Puro. "unconfirmed" quando a resposta não dá confirmação única.
type Json = Record<string, unknown>;
export type CheckStatus = "confirmed" | "not_found" | "unconfirmed";

function rowsFrom(data: unknown): Json[] {
  if (Array.isArray(data)) return data.filter((row): row is Json => !!row && typeof row === "object" && !Array.isArray(row));
  if (!data || typeof data !== "object") return [];
  const root = data as Json;
  for (const key of ["data", "result", "results", "numbers"]) {
    if (Array.isArray(root[key])) return rowsFrom(root[key]);
  }
  return [];
}

export function mapAudienceCheckResponse(
  phones: string[], ok: boolean, data: unknown,
): { phone: string; status: CheckStatus; reason: string | null }[] {
  const wanted = new Set(phones);
  const byPhone = new Map<string, Json>();
  for (const row of rowsFrom(data)) {
    const phone = String(row.query ?? row.number ?? "").replace(/\D/g, "");
    if (!wanted.has(phone)) continue;
    if (byPhone.has(phone)) byPhone.set(phone, { ambiguous: true });
    else byPhone.set(phone, row);
  }
  return phones.map((phone) => {
    const row = byPhone.get(phone);
    if (!ok || row?.ambiguous === true || typeof row?.isInWhatsapp !== "boolean") {
      return { phone, status: "unconfirmed" as const,
        reason: ok ? "resposta sem confirmação única para este número" : "consulta indisponível" };
    }
    return { phone, status: row.isInWhatsapp ? "confirmed" as const : "not_found" as const, reason: null };
  });
}
