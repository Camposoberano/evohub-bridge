// segredo-bridge — comparação central do token que autentica os endpoints do bridge.
//
// Hoje um único segredo (`CHATWOOT_WEBHOOK_SECRET`) autentica coisas de risco muito
// diferente: os webhooks das 10 inboxes do Chatwoot, os loops internos, e endpoints de
// ESCRITA como /send-outbound e /funil-control. Ele viaja em `?token=` porque o webhook de
// inbox do Chatwoot só aceita URL — não há como mandar cabeçalho por ali. Query string
// aparece em log de proxy, e quem lê o token consegue disparar mensagem para qualquer
// conversa.
//
// Trocar esse segredo de uma vez derrubaria o recebimento: as 10 inboxes vivem configuradas
// FORA deste repositório. Por isso a rotação é feita em etapas, e a etapa 1 é esta: aceitar
// um segundo segredo ao mesmo tempo.
//
//   1. definir CHATWOOT_WEBHOOK_SECRET_NOVO  -> os dois passam a valer
//   2. migrar as 10 inboxes para o novo, uma a uma, confirmando tráfego em cada
//   3. promover o novo a CHATWOOT_WEBHOOK_SECRET e remover a env de rotação
//
// Enquanto a env de rotação não existir, o comportamento é idêntico ao de antes.
import { optionalEnv } from "./env.ts";
import { timingSafeEqual } from "./hmac.ts";

/** Segredo adicional aceito durante uma rotação. Ausente = etapa não iniciada. */
export function segredoEmRotacao(): string | undefined {
  const v = optionalEnv("CHATWOOT_WEBHOOK_SECRET_NOVO");
  return v && v.trim() ? v : undefined;
}

/**
 * Confere o token contra a lista de segredos válidos, sempre em tempo constante e sempre
 * percorrendo a lista inteira — sair no primeiro acerto abriria um canal de temporização.
 */
export function confereSegredo(
  informado: string | null | undefined,
  esperados: (string | null | undefined)[],
): boolean {
  const token = informado ?? "";
  if (!token) return false;
  const rotacao = segredoEmRotacao();
  const legados = esperados.filter((s): s is string => Boolean(s && s.trim()));

  // percorre a lista inteira de propósito: sair no primeiro acerto abriria canal de temporização
  let casouLegado = false;
  for (const esperado of legados) {
    if (timingSafeEqual(token, esperado)) casouLegado = true;
  }
  const casouNovo = rotacao ? timingSafeEqual(token, rotacao) : false;

  // Durante a rotação, quem ainda chega com o segredo ANTIGO precisa aparecer. As 10 inboxes
  // do Chatwoot já migraram, mas o n8n dispara /send-outbound e /funil-enroll e seus workflows
  // não são visíveis deste repositório. Sem este aviso, promover o novo seria adivinhação —
  // e derrubaria esses jobs em silêncio.
  if (rotacao && casouLegado && !casouNovo) {
    console.warn("segredo LEGADO ainda em uso — falta migrar este chamador");
  }
  return casouLegado || casouNovo;
}
