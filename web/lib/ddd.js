// DDD brasileiro -> UF (estado). Usado pra requalificar contatos WhatsApp pelo número.
const DDD_UF = {
  11: "SP", 12: "SP", 13: "SP", 14: "SP", 15: "SP", 16: "SP", 17: "SP", 18: "SP", 19: "SP",
  21: "RJ", 22: "RJ", 24: "RJ",
  27: "ES", 28: "ES",
  31: "MG", 32: "MG", 33: "MG", 34: "MG", 35: "MG", 37: "MG", 38: "MG",
  41: "PR", 42: "PR", 43: "PR", 44: "PR", 45: "PR", 46: "PR",
  47: "SC", 48: "SC", 49: "SC",
  51: "RS", 53: "RS", 54: "RS", 55: "RS",
  61: "DF", 62: "GO", 64: "GO", 63: "TO", 65: "MT", 66: "MT", 67: "MS",
  68: "AC", 69: "RO",
  71: "BA", 73: "BA", 74: "BA", 75: "BA", 77: "BA", 79: "SE",
  81: "PE", 87: "PE", 82: "AL", 83: "PB", 84: "RN", 85: "CE", 88: "CE", 86: "PI", 89: "PI",
  91: "PA", 93: "PA", 94: "PA", 92: "AM", 97: "AM", 95: "RR", 96: "AP", 98: "MA", 99: "MA",
};

// Regiões (pra filtro "Sul", "Sudeste", etc.)
export const UF_REGIAO = {
  RS: "Sul", SC: "Sul", PR: "Sul",
  SP: "Sudeste", RJ: "Sudeste", ES: "Sudeste", MG: "Sudeste",
  DF: "Centro-Oeste", GO: "Centro-Oeste", MT: "Centro-Oeste", MS: "Centro-Oeste",
  BA: "Nordeste", SE: "Nordeste", AL: "Nordeste", PE: "Nordeste", PB: "Nordeste",
  RN: "Nordeste", CE: "Nordeste", PI: "Nordeste", MA: "Nordeste",
  AC: "Norte", RO: "Norte", AM: "Norte", RR: "Norte", AP: "Norte", PA: "Norte", TO: "Norte",
};

// Extrai DDD de um número BR (com ou sem +55). Retorna null se não der.
export function dddFromPhone(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, "");
  // remove código do país por TAMANHO, não por conteúdo -- "startsWith 55" é ambíguo
  // (DDD 55 é Rio Grande do Sul; um número de RS sem código de país também começa com 55).
  if (d.length === 12 || d.length === 13) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return null; // DDD(2) + número local (8 antigo ou 9 atual)
  const ddd = parseInt(d.slice(0, 2), 10);
  return Number.isFinite(ddd) ? ddd : null;
}

export function ufFromPhone(raw) {
  const ddd = dddFromPhone(raw);
  return ddd ? (DDD_UF[ddd] || null) : null;
}

export function regiaoFromPhone(raw) {
  const uf = ufFromPhone(raw);
  return uf ? (UF_REGIAO[uf] || null) : null;
}
