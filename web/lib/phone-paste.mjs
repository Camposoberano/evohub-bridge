/** Um telefone por linha, vírgula ou ponto e vírgula. Espaços internos de um
 * telefone formatado continuam válidos; dois blocos completos separados por
 * espaço também são aceitos. Nunca une linhas diferentes. */
export function parsePastedPhones(input) {
  const phones = [];
  for (const chunk of String(input ?? "").split(/[\r\n,;]+/)) {
    const value = chunk.trim();
    if (!value) continue;
    const digits = value.replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 13) {
      phones.push(digits);
      continue;
    }
    for (const token of value.split(/\s+/)) {
      const phone = token.replace(/\D/g, "");
      if (phone.length >= 10 && phone.length <= 13) phones.push(phone);
    }
  }
  return [...new Set(phones)];
}
