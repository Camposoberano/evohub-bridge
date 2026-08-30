// msg-type — normalização do tipo de mensagem para o enum msg_type do Postgres.
//
// A Meta manda o tipo já no vocabulário do enum ("text", "image", "interactive"...), mas os
// o canal não-oficial (uazapi, Baileys por baixo) manda o nome do campo do
// protocolo do WhatsApp: "conversation", "extendedTextMessage", "imageMessage", "ptt",
// "listResponseMessage". Antes desta tabela tudo isso caía em "unknown" — 95% do inbound e
// ~32% do outbound gravados sem tipo, o que inviabiliza qualquer recorte por tipo de mensagem.
//
// A normalização é feita aqui (e não no webhook de cada provedor) porque uazapi e
// reparo de mídia passam todos por ingestInbound.
export type MsgType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "sticker"
  | "location"
  | "contact"
  | "interactive"
  | "template"
  | "unknown";

const CANONICAL = new Set<MsgType>([
  "text",
  "image",
  "audio",
  "video",
  "document",
  "sticker",
  "location",
  "contact",
  "interactive",
  "template",
  "unknown",
]);

// Chave = valor cru já normalizado (minúsculo, sem "message"/"msg" no fim, só letras).
const ALIASES: Record<string, MsgType> = {
  // texto
  conversation: "text",
  chat: "text",
  extendedtext: "text",
  ephemeral: "text",
  edited: "text",
  // áudio (ptt = push to talk, o áudio gravado na hora)
  ptt: "audio",
  voice: "audio",
  // mídia
  img: "image",
  photo: "image",
  gif: "video",
  documentwithcaption: "document",
  doc: "document",
  file: "document",
  // localização e contato
  livelocation: "location",
  locationlive: "location",
  contactsarray: "contact",
  contacts: "contact",
  vcard: "contact",
  // interativo: clique em botão/lista volta com o nome do campo de resposta
  button: "interactive",
  buttons: "interactive",
  buttonsresponse: "interactive",
  buttonresponse: "interactive",
  templatebuttonreply: "interactive",
  list: "interactive",
  listresponse: "interactive",
  singleselectreply: "interactive",
  interactiveresponse: "interactive",
  poll: "interactive",
  pollcreation: "interactive",
  pollupdate: "interactive",
  // template aprovado da Meta
  hsm: "template",
};

// Tipos que existem no protocolo mas não têm correspondente no enum: ficam "unknown" de
// propósito, e não por falha de mapeamento.
const KNOWN_UNMAPPED = new Set([
  "reaction",
  "protocol",
  "senderkeydistribution",
  "viewonce",
  "viewoncev",
  "ciphertext",
  "call",
  "order",
  "product",
  "groupinvite",
]);

export function normalizeMsgType(value: string | null | undefined): MsgType {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return "unknown";
  if (CANONICAL.has(raw as MsgType)) return raw as MsgType;

  // "extendedTextMessage" -> "extendedtext"; "audioMsg" -> "audi"... por isso só corta o
  // sufixo inteiro, nunca pedaço de palavra.
  const letters = raw.replace(/[^a-z]/g, "");
  const base = letters.replace(/(message|msg)$/, "");
  if (CANONICAL.has(base as MsgType)) return base as MsgType;
  if (ALIASES[base]) return ALIASES[base];
  if (ALIASES[letters]) return ALIASES[letters];
  if (KNOWN_UNMAPPED.has(base)) return "unknown";

  return "unknown";
}

// Só para diagnóstico: tipo cru que não casou com nada, pra aparecer no log e virar alias
// depois em vez de sumir silenciosamente em "unknown".
export function isUnmappedMsgType(value: string | null | undefined): boolean {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return false;
  if (CANONICAL.has(raw as MsgType)) return false;
  const letters = raw.replace(/[^a-z]/g, "");
  const base = letters.replace(/(message|msg)$/, "");
  if (CANONICAL.has(base as MsgType)) return false;
  if (ALIASES[base] || ALIASES[letters]) return false;
  return !KNOWN_UNMAPPED.has(base);
}
