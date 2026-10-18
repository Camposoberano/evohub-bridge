type Json = Record<string, unknown>;

export type MediaBlock5895 = {
  id: string;
  conversation: number;
  step: number;
  type: string;
  outcome: string;
  stage: string;
};

/** Uma mídia incerta sem liberação de sequência é uma causa, não cada peça pendente. */
export function mediaBlocks5895(rows: Json[]): MediaBlock5895[] {
  const blocks = rows.flatMap((row) => {
    const payload = (row.payload ?? {}) as Json;
    const delivery = (payload.__funnel_delivery ?? {}) as Json;
    if (
      row.status !== "failed" || delivery.last_outcome !== "uncertain" ||
      delivery.followups_released_at
    ) return [];
    return [{
      id: String(row.id ?? ""),
      conversation: Number(row.chatwoot_conversation_id ?? 0),
      step: Number(row.step ?? 0),
      type: String(row.type ?? "mídia"),
      outcome: String(delivery.last_outcome),
      stage: String(delivery.transport_stage ?? "unknown"),
    }];
  });
  return blocks.sort((a, b) =>
    a.conversation - b.conversation || a.step - b.step
  );
}

export function mediaBlocks5895Detail(blocks: MediaBlock5895[]): string {
  return blocks.slice(0, 6).map((block) =>
    `#${block.conversation} etapa ${block.step} ${block.type} sem confirmação`
  ).join("; ");
}

export async function mediaBlocks5895Key(
  blocks: MediaBlock5895[],
): Promise<string> {
  const value = blocks.map((block) =>
    `${block.id}:${block.outcome}:${block.stage}`
  ).sort().join("|");
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return `alerta-5895-media-${
    Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    ).slice(0, 32)
  }`;
}
