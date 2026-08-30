// envio-multiplo — resume o resultado de uma mensagem do Chatwoot que virou VÁRIOS envios.
//
// Uma mensagem com dois anexos vira dois envios ao provedor, mas continua sendo UMA linha em
// `messages` (o `chatwoot_message_id` é a chave que o pull-loop usa para deduplicar —
// sync-chatwoot-out.ts casa por ele, e o CLAUDE.md fixa isso como regra do projeto; gravar
// uma linha por anexo faria o pull-loop reprocessar).
//
// O laço em chatwoot-webhook sobrescrevia `res` a cada volta e gravava só o resultado do
// ÚLTIMO. Se a segunda imagem falhava depois da primeira ter sido entregue, a linha inteira
// virava `failed` e o atendente recebia nota de falha por uma mídia que chegou — além de o
// relatório subcontar envio de mídia.

export type EnvioIndividual = {
  ok: boolean;
  /** URL da mídia efetivamente usada nesse envio (após transcodificação, quando houve) */
  mediaUrl?: string | null;
};

export type ResumoDeEnvios = {
  /** "sent" quando algo chegou; "failed" só quando NADA chegou */
  status: "sent" | "failed";
  entregues: number;
  falhados: number;
  /** true quando parte entregou e parte não — merece aviso diferente da falha total */
  parcial: boolean;
  /** primeira mídia ENTREGUE (não a última tentada), para gravar em messages.media_url */
  mediaUrl: string | null;
};

export function resumoDeEnvios(envios: EnvioIndividual[]): ResumoDeEnvios {
  const entregues = envios.filter((e) => e.ok);
  const falhados = envios.length - entregues.length;
  return {
    status: entregues.length > 0 ? "sent" : "failed",
    entregues: entregues.length,
    falhados,
    parcial: entregues.length > 0 && falhados > 0,
    mediaUrl: entregues.find((e) => e.mediaUrl)?.mediaUrl ?? null,
  };
}

export function notaDeEnvioParcial(resumo: ResumoDeEnvios): string {
  return `⚠️ Envio parcial: ${resumo.entregues} de ${
    resumo.entregues + resumo.falhados
  } partes chegaram ao cliente. As que faltaram precisam ser reenviadas — o restante NÃO deve ser repetido, para o cliente não receber duplicado.`;
}
