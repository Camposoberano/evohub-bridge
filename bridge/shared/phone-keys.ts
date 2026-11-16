import { usableContactName } from "./contact-name.ts";

/**
 * Números de celular brasileiros podem chegar com ou sem o 9º dígito no Chatwoot/uazapi.
 * Esta função devolve todas as chaves equivalentes (com e sem o 9) pra casar o mesmo contato.
 * Portado do hub CECAPE (lgt-name-source.ts), generalizado.
 */
export function equivalentBrazilianPhoneKeys(value: unknown): string[] {
  const digits = String(value ?? "").replace(/\D/g, "");
  const full = digits.length === 10 || digits.length === 11
    ? "55" + digits
    : digits;
  if (!/^55\d{10,11}$/.test(full)) return [];
  const keys = new Set([full]);
  const subscriber = full.slice(4);
  if (subscriber.length === 8 && subscriber.startsWith("9")) {
    keys.add(full.slice(0, 4) + "9" + subscriber);
  }
  if (subscriber.length === 9 && subscriber.startsWith("9")) {
    keys.add(full.slice(0, 4) + subscriber.slice(1));
  }
  return [...keys];
}

/**
 * Nome de um público só é confiável se for ÚNICO entre todas as linhas que casam o telefone
 * (considerando o 9º dígito). Se dois contatos com o mesmo número têm nomes diferentes, não dá
 * pra confiar em nenhum → retorna null.
 */
export function uniqueTrustedAudienceName(
  phone: unknown,
  rows: { phone: unknown; name: unknown }[],
): string | null {
  const target = new Set(equivalentBrazilianPhoneKeys(phone));
  if (!target.size) return null;
  const names = new Map<string, string>();
  for (const row of rows) {
    const matches = equivalentBrazilianPhoneKeys(row.phone).some((key) =>
      target.has(key)
    );
    if (!matches) continue;
    const name = usableContactName(row.name);
    if (name) names.set(name.toLocaleLowerCase("pt-BR"), name);
  }
  return names.size === 1 ? [...names.values()][0] : null;
}
