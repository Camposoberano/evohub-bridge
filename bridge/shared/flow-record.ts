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
import { ingestInbound, type InboundAttachment } from "./inbound.ts";
import type { FlowStep } from "./flow.ts";
import type { OnStepSent } from "./flow-runner.ts";
import { optionalEnv } from "./env.ts";

type Json = Record<string, unknown>;

const MAX_CHATWOOT_IMAGE_BYTES = 6 * 1024 * 1024;
const CHATWOOT_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Texto que representa a peça no histórico. Botões e listas viram o enunciado da pergunta. */
export function textoDoStep(step: FlowStep): string {
  if (step.kind === "media") {
    // legenda quando existe; senão um rótulo, para a linha não ficar vazia no Chatwoot
    return step.text?.trim() || `[${step.media?.type ?? "mídia"}]`;
  }
  return step.text?.trim() ?? "";
}

/**
 * Canal NATIVO (integração direta Uazapi↔Chatwoot) → a saída do fluxo NÃO pode ser postada no
 * Chatwoot: a integração nativa redispararia a mensagem (lead recebe duas). Decisão isolada e pura
 * para teste; o gravador só repassa como `skipChatwoot`. (Coluna channels.native_chatwoot; ausente
 * no EvoHub → sempre false, comportamento inalterado.)
 */
export function pularChatwootNativo(channel: Json): boolean {
  return (channel as { native_chatwoot?: unknown }).native_chatwoot === true;
}

/** Baixa apenas imagens públicas do bucket aprovado para anexar ao histórico do Chatwoot. */
async function imagemParaChatwoot(
  step: FlowStep,
): Promise<InboundAttachment[] | undefined> {
  if (step.kind !== "media" || step.media?.type !== "image") return undefined;

  let url: URL;
  try {
    url = new URL(step.media.url);
    const supabase = optionalEnv("SUPABASE_URL");
    if (!supabase || url.origin !== new URL(supabase).origin) return undefined;
  } catch {
    console.warn(`flow-record: URL de imagem inválida no step ${step.id}`);
    return undefined;
  }
  if (
    url.protocol !== "https:" || url.username || url.password ||
    !url.pathname.startsWith("/storage/v1/object/public/soberano-out/")
  ) {
    console.warn(`flow-record: origem de imagem não permitida no step ${step.id}`);
    return undefined;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) {
      console.warn(
        `flow-record: imagem do step ${step.id} retornou HTTP ${response.status}`,
      );
      return undefined;
    }
    const contentType = response.headers.get("content-type")?.split(";")[0]
      .trim().toLowerCase();
    if (!contentType || !CHATWOOT_IMAGE_TYPES.has(contentType)) {
      console.warn(`flow-record: tipo de imagem inválido no step ${step.id}`);
      return undefined;
    }
    const announcedSize = response.headers.get("content-length");
    if (announcedSize && Number(announcedSize) > MAX_CHATWOOT_IMAGE_BYTES) {
      console.warn(`flow-record: imagem excede o limite no step ${step.id}`);
      return undefined;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > MAX_CHATWOOT_IMAGE_BYTES) {
      console.warn(`flow-record: tamanho de imagem inválido no step ${step.id}`);
      return undefined;
    }

    const extension = contentType === "image/jpeg"
      ? "jpg"
      : contentType.slice("image/".length);
    const filename = step.media.fileName?.trim().replace(/[^\w.-]/g, "_")
      .slice(0, 80) || `campaign-image.${extension}`;
    return [{ filename, contentType, bytes, sourceUrl: url.href }];
  } catch (error) {
    const reason = error instanceof Error ? error.name : "download_failed";
    console.warn(`flow-record: não anexou imagem do step ${step.id}: ${reason}`);
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
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
  const nativo = pularChatwootNativo(channel);
  return async (step: FlowStep, providerMessageId?: string) => {
    // Somente imagens do bucket público aprovado são baixadas; vídeo/áudio/documento não
    // geram tráfego duplicado. A saída já foi aceita pelo UAZAPI e nunca será reenviada daqui.
    const attachments = nativo ? undefined : await imagemParaChatwoot(step);
    await ingestInbound(db, channel, {
      from: to,
      msgType: msgTypeDoStep(step),
      content: textoDoStep(step),
      attachments,
      outgoing: true,
      skipChatwoot: nativo,
      metaMessageId: providerMessageId,
      acct,
      labels: step.labels,
    });
  };
}
