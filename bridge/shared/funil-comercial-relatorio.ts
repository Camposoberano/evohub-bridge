export type FunilComercialEvent = {
  event_type?: unknown;
  channel_id?: unknown;
  received_at?: unknown;
  payload?: Record<string, unknown> | null;
};

export type FunilComercialOutcome = {
  id?: unknown;
  outcome?: unknown;
  outcome_value_cents?: unknown;
};

export type CanalFunilComercial = {
  channelId: string;
  intents: number;
  uses: number;
  proofs: number;
  quotes: number;
  humanRequests: number;
  humanResponses: number;
  responsesAfterProof: number;
};

export type FunilComercialSummary = {
  intents: number;
  uses: number;
  proofs: number;
  quotes: number;
  humanRequests: number;
  humanResponses: number;
  responsesAfterProof: number;
  firstHumanResponsesAfterQuote: number;
  won: number;
  lost: number;
  open: number;
  revenueCents: number;
  attributionIncomplete: number;
  funnelMessagesWithoutScheduleLink: number;
  byChannel: CanalFunilComercial[];
};

const EVENTOS_COM_ATRIBUICAO = new Set([
  "intencao_identificada",
  "uso_informado",
  "prova_enviada",
  "cotacao_solicitada",
  "pedido_atendimento",
  "human_response",
]);

/**
 * Resume apenas eventos explicitamente registrados. `open` nunca conta como venda; saída
 * automática, atendimento humano e desfecho permanecem em dimensões separadas.
 */
export function summarizeFunilComercial(
  events: FunilComercialEvent[],
  outcomes: FunilComercialOutcome[] = [],
  funnelMessagesWithoutScheduleLink = 0,
  proofHistory: FunilComercialEvent[] = events,
): FunilComercialSummary {
  const summary: FunilComercialSummary = {
    intents: 0,
    uses: 0,
    proofs: 0,
    quotes: 0,
    humanRequests: 0,
    humanResponses: 0,
    responsesAfterProof: 0,
    firstHumanResponsesAfterQuote: 0,
    won: 0,
    lost: 0,
    open: 0,
    revenueCents: 0,
    attributionIncomplete: 0,
    funnelMessagesWithoutScheduleLink,
    byChannel: [],
  };

  const channels = new Map<string, CanalFunilComercial>();
  const quoteAt = new Map<string, number>();
  const proofAt = new Map<string, number>();
  const firstHumanAfterQuote = new Set<string>();
  const responsesAfterProof = new Set<string>();
  const eventConversations = new Set<string>();

  for (const event of proofHistory) {
    const type = String(event.event_type ?? "");
    const conversationId = String(event.payload?.conversation_id ?? "").trim();
    const at = Date.parse(String(event.received_at ?? ""));
    if (!conversationId || !Number.isFinite(at)) continue;
    if (type === "cotacao_solicitada") {
      const previous = quoteAt.get(conversationId);
      if (previous === undefined || at < previous) quoteAt.set(conversationId, at);
    } else if (type === "prova_enviada") {
      const previous = proofAt.get(conversationId);
      if (previous === undefined || at < previous) proofAt.set(conversationId, at);
    }
  }

  for (const event of events) {
    const type = String(event.event_type ?? "");
    if (!EVENTOS_COM_ATRIBUICAO.has(type)) continue;
    const payload = event.payload ?? {};
    const conversationId = String(payload.conversation_id ?? "").trim();
    const channelId = String(event.channel_id ?? "").trim();
    const at = Date.parse(String(event.received_at ?? ""));
    if (!conversationId || !channelId || !payload.message_id) {
      summary.attributionIncomplete++;
    }
    if (conversationId) {
      eventConversations.add(conversationId);
    }

    const bucketId = channelId || "sem-canal";
    const bucket = channels.get(bucketId) ?? {
      channelId: bucketId,
      intents: 0,
      uses: 0,
      proofs: 0,
      quotes: 0,
      humanRequests: 0,
      humanResponses: 0,
      responsesAfterProof: 0,
    };
    channels.set(bucketId, bucket);

    if (type === "intencao_identificada") {
      summary.intents++;
      bucket.intents++;
      if (
        conversationId && proofAt.has(conversationId) && Number.isFinite(at) &&
        at > (proofAt.get(conversationId) as number)
      ) responsesAfterProof.add(conversationId);
    } else if (type === "uso_informado") {
      summary.uses++;
      bucket.uses++;
    } else if (type === "prova_enviada") {
      summary.proofs++;
      bucket.proofs++;
    } else if (type === "cotacao_solicitada") {
      summary.quotes++;
      bucket.quotes++;
    } else if (type === "pedido_atendimento") {
      summary.humanRequests++;
      bucket.humanRequests++;
    } else if (type === "human_response") {
      summary.humanResponses++;
      bucket.humanResponses++;
      const quotedAt = conversationId ? quoteAt.get(conversationId) : undefined;
      if (
        conversationId && quotedAt !== undefined && Number.isFinite(at) &&
        at >= quotedAt
      ) firstHumanAfterQuote.add(conversationId);
    }
  }

  summary.responsesAfterProof = responsesAfterProof.size;
  for (const bucket of channels.values()) {
    const bucketConversations = new Set(
      events.filter((event) =>
        String(event.channel_id ?? "").trim() === bucket.channelId &&
        String(event.event_type ?? "") === "intencao_identificada" &&
        proofAt.has(String(event.payload?.conversation_id ?? "").trim()) &&
        Date.parse(String(event.received_at ?? "")) >
          (proofAt.get(String(event.payload?.conversation_id ?? "").trim()) as number)
      ).map((event) => String(event.payload?.conversation_id ?? "").trim()),
    );
    bucket.responsesAfterProof = bucketConversations.size;
  }

  summary.firstHumanResponsesAfterQuote = firstHumanAfterQuote.size;
  const outcomeById = new Map(
    outcomes.map((row) => [
      String(row.id ?? ""),
      {
        outcome: String(row.outcome ?? "open"),
        value: Number(row.outcome_value_cents ?? 0),
      },
    ]),
  );
  for (const id of eventConversations) {
    const row = outcomeById.get(id);
    if (!row) {
      summary.attributionIncomplete++;
      continue;
    }
    if (row.outcome === "won") {
      summary.won++;
      if (Number.isFinite(row.value) && row.value > 0) {
        summary.revenueCents += row.value;
      }
    } else if (row.outcome === "lost") summary.lost++;
    else summary.open++;
  }
  summary.byChannel = [...channels.values()].sort((a, b) =>
    a.channelId.localeCompare(b.channelId)
  );
  return summary;
}
