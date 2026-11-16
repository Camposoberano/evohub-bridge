// whatsapp-name-source — escolhe o melhor nome de um contato WhatsApp entre as fontes disponíveis
// (existente → perfil WhatsApp → público → fallback telefone) e valida vínculo de inbox. Portado
// do hub CECAPE, generalizado (sem nomes de curso).
import {
  equivalentBrazilianPhoneKeys,
  uniqueTrustedAudienceName,
} from "./phone-keys.ts";
import { usableContactName } from "./contact-name.ts";

type Json = Record<string, unknown>;

export function trustedWhatsAppName(value: unknown): string | null {
  const name = usableContactName(value);
  if (!name || /^(?:indispon[ií]vel|unavailable|n\/a)$/iu.test(name)) {
    return null;
  }
  return name;
}

export function chooseWhatsAppName(
  current: unknown,
  profile: unknown,
  audience: unknown,
  phone: unknown,
):
  | { name: string; source: "existing" | "whatsapp" | "audience" | "phone" }
  | null {
  const keys = equivalentBrazilianPhoneKeys(phone);
  if (!keys.length) return null;
  const human = trustedWhatsAppName(current);
  if (human) return { name: human, source: "existing" };
  const wa = trustedWhatsAppName(profile);
  if (wa) return { name: wa, source: "whatsapp" };
  const csv = trustedWhatsAppName(audience);
  if (csv) return { name: csv, source: "audience" };
  return { name: `+${keys[0]}`, source: "phone" };
}

export function verifiedWhatsAppContact(
  contact: unknown,
  expectedId: number,
  phone: unknown,
  inboxId: number,
): boolean {
  const item = contact as Json | null;
  if (
    !item || Number(item.id) !== expectedId ||
    !Number.isSafeInteger(expectedId) ||
    expectedId <= 0 || !Number.isSafeInteger(inboxId) || inboxId <= 0
  ) return false;
  const target = new Set(equivalentBrazilianPhoneKeys(phone));
  if (
    !target.size || !equivalentBrazilianPhoneKeys(item.phone_number)
      .some((key) => target.has(key))
  ) return false;
  const inboxes = item.contact_inboxes;
  return Array.isArray(inboxes) &&
    inboxes.filter((entry) =>
        Number(((entry as Json | null)?.inbox as Json | undefined)?.id) ===
          inboxId
      ).length === 1;
}

/** Só escolhe uma fonte quando exatamente uma inbox configurada liga ao contato. */
export function uniqueEligibleWhatsAppInbox(
  contactInboxes: unknown,
  eligibleInboxIds: number[],
): number | null {
  if (!Array.isArray(contactInboxes)) return null;
  const eligible = new Set(
    eligibleInboxIds.filter((id) => Number.isSafeInteger(id) && id > 0),
  );
  const matches = contactInboxes.map((entry) =>
    Number(((entry as Json | null)?.inbox as Json | undefined)?.id)
  ).filter((id) => eligible.has(id));
  return matches.length === 1 ? matches[0] : null;
}

/** Públicos antigos podem ter turno/curso na coluna name — não os trata como nome confiável. */
export function uniqueSafeAudienceName(
  phone: unknown,
  rows: { phone: unknown; name: unknown }[],
): string | null {
  const safeRows = rows.filter((row) => {
    const name = trustedWhatsAppName(row.name);
    if (!name || [...name.matchAll(/\p{L}{2,}/gu)].length < 2) return false;
    if (
      /\b(?:curso|turma|turno|matutino|noturno|manha|manhã|tarde|noite|integral|online|presencial)\b/iu
        .test(name)
    ) return false;
    return true;
  });
  return uniqueTrustedAudienceName(phone, safeRows);
}
