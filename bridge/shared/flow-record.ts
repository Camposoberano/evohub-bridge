// flow-record — registra no banco e no Chatwoot cada peça que o fluxo enviou.
//
// O fluxo envia direto pela rota híbrida (uazapi), sem passar por `/send-outbound`, e o
// webhook do uazapi descarta o eco de mensagem enviada pela API (`wasSentByApi`, ver
// handlers/uazapi-webhook.ts). Com isso a saída não existia em lugar nenhum.
//
// O estrago era operacional, não técnico: em 20/08 o atendente via no Chatwoot as respostas
// soltas do lead — "Faltou pasto", "Quero a conta", "4 hectare" — sem nenhuma das perguntas
// que as geraram. Do teste de 15/08, o WhatsApp tinha ~10 saídas nossas e o banco tinha 1.
//
// Reusa `ingestInbound` com `outgoing: true` em vez de escrever à mão: aquele caminho já
// resolve contato e conversa, posta no Chatwoot como saída, deduplica e trata canal nativo.
import type { DbClient } from "./supabase.ts";
import type { CwAcct } from "./chatwoot.ts";
import { ingestInbound } from "./inbound.ts";
import type { FlowStep } from "./flow.ts";
import type { OnStepSent } from "./flow-runner.ts";

type Json = Record<string, unknown>;

/** Texto que representa a peça no histórico. Botões e listas viram o enunciado da pergunta. */
export function textoDoStep(step: FlowStep): string {
  if (step.kind === "media") {
    // legenda quando existe; senão um rótulo, para a linha não ficar vazia no Chatwoot
    return step.text?.trim() || `[${step.media?.type ?? "mídia"}]`;
  }
  return step.text?.trim() ?? "";
}

/** Tipo de mensagem equivalente, para o histórico ficar igual ao de qualquer outra saída. */
export function msgTypeDoStep(step: FlowStep): string {
  if (step.kind === "media") return step.media?.type ?? "document";
  if (step.kind === "buttons" || step.kind === "list") return "interactive";
  return "text";
}

/**
 * Devolve o callback que o runner chama a cada peça enviada.
 *
 * Curried por canal/contato porque o runner só conhece o step — quem sabe em qual conversa
 * aquilo entra é o chamador.
 */
export function gravadorDeFluxo(
  db: DbClient,
  channel: Json,
  to: string,
  acct?: CwAcct,
): OnStepSent {
  return async (step: FlowStep) => {
    // Sem anexo de propósito: `InboundAttachment` exige os bytes, e baixar cada vídeo só
    // para registrar duplicaria o tráfego. O que resolve o problema do atendente é o TEXTO
    // — ele precisa ver a pergunta que gerou a resposta, não rever o vídeo no Chatwoot.
    await ingestInbound(db, channel, {
      from: to,
      msgType: msgTypeDoStep(step),
      content: textoDoStep(step),
      outgoing: true,
      acct,
      // Sem id do provedor: `ingestInbound` cai na chave de dedupe por conteúdo, o que já
      // impede a mesma peça de entrar duas vezes se o passo for reprocessado.
    });
  };
}
