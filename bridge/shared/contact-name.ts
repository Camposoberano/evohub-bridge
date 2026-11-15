// Validação de qualidade de nome de contato. Portado do hub CECAPE (contact-profile-lgt.ts),
// generalizado — sem acoplamento de inbox/faculdade.
//
// O WhatsApp (via Meta/uazapi) entrega contatos sem nome confiável: às vezes vem o telefone,
// um JID (@s.whatsapp.net / @lid / @g.us), mojibake (�) ou rótulos genéricos. Estas
// funções decidem se um nome é usável e escolhem o melhor entre candidatos — nunca sobrescrevem
// um nome bom já salvo (ex.: corrigido por um atendente humano).

export function usableContactName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim();
  if (
    name.length < 2 || name.length > 120 ||
    [...name.matchAll(/\p{L}/gu)].length < 2
  ) return null;
  if (/[~<>\[\]{}|]/u.test(name)) return null;
  // sufixo de turno ("João - manhã") é artefato de importação, não nome
  if (/\s[-–]\s(?:manhã|manha|tarde|noite|integral)$/iu.test(name)) return null;
  if (name.includes("�")) return null;
  // padrão de JID textual "abc-def-12345"
  if (/^[\p{L}]+-[\p{L}]+-\d{1,5}$/u.test(name)) return null;
  if (
    /@(?:s\.whatsapp\.net|g\.us|lid)$/i.test(name) || /\b\d{10,15}\b/.test(name)
  ) return null;
  if (
    /^(?:whatsapp|cliente|sem nome|unknown|desconhecido|indispon[ií]vel|unavailable|contato|user)$/i
      .test(name)
  ) return null;
  return name;
}

export function bestContactName(
  existing: unknown,
  candidates: unknown[],
): string | null {
  const saved = usableContactName(existing);
  if (saved) return saved;
  for (const candidate of candidates) {
    const name = usableContactName(candidate);
    if (name) return name;
  }
  return null;
}
