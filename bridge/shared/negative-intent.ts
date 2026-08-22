// negative-intent — recusa explícita do contato, separada de qualquer frase comum com "não".

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Reconhece somente pedidos claros para sair da abordagem comercial. */
export function isNegativeIntent(value: string | null | undefined): boolean {
  const text = normalize(String(value ?? ""));
  if (!text) return false;
  return /^(?:nao tenho interesse|sem interesse|nao quero(?: mais)?|pode parar|pare de (?:mandar|enviar)|sair da lista|remover da lista|nao compra)$/.test(text) ||
    /\b(?:pare de|parar de) (?:mandar|enviar)\b/.test(text);
}
