export function foldText(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizedWords(value: string): string {
  return foldText(value).replace(/[^a-z0-9]+/g, " ").trim();
}

export function isDefaultAdMessage(content: string): boolean {
  const text = normalizedWords(content);
  return [
    "ola posso ter mais informacoes",
    "posso ter mais informacoes",
    "ola gostaria de mais informacoes",
    "gostaria de mais informacoes",
    "quero mais informacoes",
    "tenho interesse e gostaria de mais informacoes",
    "hola puedo tener mas informacion",
    "hola puedo obtener mas informacion",
    "puedo tener mas informacion",
    "puedo obtener mas informacion",
    "hola me gustaria conseguir mas informacion",
    "me gustaria conseguir mas informacion",
  ].some((phrase) => text.includes(phrase));
}
