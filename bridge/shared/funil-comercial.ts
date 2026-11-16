import type { DbClient } from "./supabase.ts";
import {
  detectarUsoComercial,
  isDuvidaTecnicaIntent,
  isInteresseComercialIntent,
  isPrecoIntent,
  type UsoComercial,
} from "./intent.ts";

export type IntencaoFunilComercial =
  | "preco"
  | "duvida_tecnica"
  | "uso"
  | "interesse_geral";

export type PacoteComercial = {
  id: "tam_2kg" | "tam_4kg" | "tam_10kg" | "tam_20kg";
  area: number;
  quilos: number;
  titulo: string;
};

export const PACOTES_COMERCIAIS: readonly PacoteComercial[] = [
  { id: "tam_4kg", area: 1, quilos: 4, titulo: "1 hectare" },
  { id: "tam_10kg", area: 2, quilos: 10, titulo: "2 hectares" },
  { id: "tam_20kg", area: 4, quilos: 20, titulo: "4 hectares" },
];

export const OPCOES_DE_USO: ReadonlyArray<{ id: string; title: string }> = [
  { id: "uso_silagem", title: "Silagem" },
  { id: "uso_pastejo", title: "Pastejo" },
  { id: "uso_outro", title: "Outro uso" },
];

export function classificarIntencaoComercial(
  text: string,
): IntencaoFunilComercial | null {
  if (isPrecoIntent(text)) return "preco";
  if (isDuvidaTecnicaIntent(text)) return "duvida_tecnica";
  if (detectarUsoComercial(text)) return "uso";
  if (isInteresseComercialIntent(text)) return "interesse_geral";
  return null;
}

export function pacotePorId(id: string): PacoteComercial | null {
  return PACOTES_COMERCIAIS.find((pacote) => pacote.id === id) ?? null;
}

export function pacotePorResposta(reply: string): PacoteComercial | null {
  const normalized = normalize(reply);
  const known = PACOTES_COMERCIAIS.find((p) =>
    normalize(p.titulo) === normalized ||
    normalize(p.titulo + " " + p.quilos + " kg") === normalized
  );
  if (known) return known;
  // Aliases antigos continuam reconhecidos sem aparecer no seletor novo.
  if (normalized === "meio hectare" || normalized === "2 kg") {
    return { id: "tam_2kg", area: 0.5, quilos: 2, titulo: "½ hectare" };
  }
  return null;
}

export function textoPerguntaUso(): string {
  return "Para eu te orientar melhor, o senhor pretende usar o sorgo para silagem, pastejo ou outra finalidade?";
}

export function textoCondicaoComercial(): string {
  return "As condições comerciais dependem da quantidade e da região. O Cícero confirma a cotação exata para você.";
}

export function textoPacote(pacote: PacoteComercial): string {
  return "📦 Para " + pacote.titulo + ", a referência é " + pacote.quilos +
    " kg.\n\n" + textoCondicaoComercial() +
    "\n\nQuer que o Cícero confirme a cotação exata para sua região?";
}

export function textoAreaMaior(): string {
  return "Para áreas acima de 4 hectares, me diga quantos hectares pretende plantar e sua região. O Cícero confirma o volume e o valor exato.";
}

export function usoPorResposta(reply: string): UsoComercial | null {
  if (/^uso_silagem$/i.test(reply.trim())) return "silagem";
  if (/^uso_pastejo$/i.test(reply.trim())) return "pastejo";
  if (/^uso_outro$/i.test(reply.trim())) return "outro";
  return detectarUsoComercial(reply);
}

export function extrairAreaHectares(text: string): number | null {
  const match = normalize(text).match(
    /(?:^|\s)(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:ha|hectares?|hectareas?)(?:\b|$)/,
  );
  if (!match) return null;
  const hectares = Number(match[1].replace(",", "."));
  return Number.isFinite(hectares) && hectares > 0 ? hectares : null;
}

export function isAreaAcimaDosPacotes(text: string): boolean {
  const hectares = extrairAreaHectares(text);
  return hectares !== null && hectares > 4;
}

export async function registrarEventoComercial(
  db: DbClient,
  input: {
    channelId: string;
    conversationId: string | null;
    eventType: string;
    origin: "automatico" | "humano" | "cliente";
    messageId?: string | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await db.from("events").insert({
    source: "sales-funnel",
    event_type: input.eventType,
    channel_id: input.channelId,
    payload: {
      conversation_id: input.conversationId,
      origin: input.origin,
      message_id: input.messageId ?? null,
      ...(input.details ?? {}),
    },
  });
  if (error) throw error;
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9., ]+/g, " ").replace(/\s+/g, " ").trim();
}
