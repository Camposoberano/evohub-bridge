// outcome-labels — regra única de "etiqueta comercial → desfecho da conversa".
//
// As etiquetas vêm de dois lugares com grafias diferentes:
//   Chatwoot   : "pago", "pagamento-feito", "nao-compra"
//   WhatsApp   : "Pago " (com espaço no fim), "Não COMPRA", "não compra"
// Por isso tudo passa por canonize() antes de comparar: minúscula, sem acento,
// hífen/underscore/espaço colapsados. Assim "Não COMPRA" e "nao-compra" viram a
// mesma chave e o time pode escrever do jeito que preferir.

export type Outcome = "won" | "lost";

// Prefixo das etiquetas vindas do WhatsApp em conversations.labels. Mantém as duas
// origens distinguíveis e permite cada sync mexer só no que é seu.
export const WA_PREFIX = "wa:";

const OUTCOME_BY_LABEL: Record<string, Outcome> = {
  "pago": "won",
  "pagamento feito": "won",
  "pedido finalizado": "won",
  "venda": "won",
  "nao compra": "lost",
  "nao tem interesse": "lost",
  "sem interesse": "lost",
};

/** minúscula, sem acento, separadores colapsados em espaço único. */
export function canonize(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove diacríticos separados pelo NFD
    .toLowerCase()
    .replace(/[-_\s]+/g, " ")
    .trim();
}

/**
 * Desfecho a partir de uma lista de etiquetas (de qualquer origem, com ou sem
 * prefixo `wa:`). "won" vence "lost" quando as duas aparecem: venda registrada é
 * fato, "não compra" pode ter sobrado de antes.
 */
export function deriveOutcome(labels: string[]): Outcome | null {
  let lost = false;
  for (const label of labels) {
    const bare = label.startsWith(WA_PREFIX)
      ? label.slice(WA_PREFIX.length)
      : label;
    const outcome = OUTCOME_BY_LABEL[canonize(bare)];
    if (outcome === "won") return "won";
    if (outcome === "lost") lost = true;
  }
  return lost ? "lost" : null;
}

/**
 * A conversa está comercialmente encerrada?
 *
 * `conversations.outcome` é enum NOT NULL com default `'open'` — nunca é nulo. Quem
 * testa a coluna por veracidade (`if (outcome)`) conclui que TODA conversa está fechada
 * e desliga o que veio depois. Foi o que aconteceu com o follow-up silencioso: 135 funis
 * concluídos e zero follow-ups agendados. Só `won` e `lost` encerram; `open` é o estado
 * normal de quem ainda está em jogo.
 */
export function isClosedOutcome(outcome: string | null | undefined): boolean {
  return outcome === "won" || outcome === "lost";
}

/** Separa as etiquetas guardadas por origem, para cada sync substituir só a sua. */
export function splitByOrigin(
  stored: unknown,
): { chatwoot: string[]; whatsapp: string[] } {
  const all = Array.isArray(stored) ? stored.map((l) => String(l)) : [];
  return {
    chatwoot: all.filter((l) => !l.startsWith(WA_PREFIX)),
    whatsapp: all.filter((l) => l.startsWith(WA_PREFIX)),
  };
}

/** União ordenada e sem repetição — formato estável para comparar antes de gravar. */
export function mergeLabels(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b].map((l) => l.trim()).filter(Boolean))].sort();
}

export function sameLabels(current: unknown, next: string[]): boolean {
  const a = Array.isArray(current)
    ? [...new Set(current.map((l) => String(l).trim()).filter(Boolean))].sort()
    : [];
  return a.length === next.length && a.every((v, i) => v === next[i]);
}
