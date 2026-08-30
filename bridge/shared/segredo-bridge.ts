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

/**
 * Segredo ADICIONAL aceito além do principal. Durante uma rotação ele guarda o segredo que
 * está saindo — o principal (`CHATWOOT_WEBHOOK_SECRET`) é sempre o vigente.
 */
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
  origem = "desconhecida",
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

  // Quem chega pelo segredo ADICIONAL (o que está saindo) precisa aparecer no log: é assim
  // que se sabe, sem adivinhar, se ainda há chamador por migrar antes de removê-lo. O n8n
  // dispara /send-outbound e /funil-enroll e seus workflows não são visíveis daqui.
  if (rotacao && casouNovo && !casouLegado) {
    console.warn(
      `segredo LEGADO ainda em uso em ${origem} — falta migrar este chamador`,
    );
  }
  return casouLegado || casouNovo;
}

/**
 * Segredo que o BRIDGE usa para chamar a si mesmo (os loops internos do server.ts montam
 * `http://internal/...?token=`). Durante uma rotação ele precisa usar o NOVO — senão o
 * próprio sistema fica gerando o aviso de "segredo legado" e afoga o sinal que importa:
 * o chamador externo que ainda não migrou. Medido em 30/08: 115 avisos em 4 minutos, todos
 * do próprio bridge.
 */
export function segredoParaChamadaInterna(): string {
  // SEMPRE o principal, nunca o adicional: o adicional guarda o segredo que está saindo, e
  // usá-lo faria o próprio bridge disparar o aviso de "legado" a cada 30s — afogando o sinal
  // que existe para dizer qual chamador EXTERNO ainda falta migrar.
  return optionalEnv("SYNC_SECRET") ?? optionalEnv("CHATWOOT_WEBHOOK_SECRET") ?? "";
}
