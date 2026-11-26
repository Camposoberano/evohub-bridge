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
  const legados = esperados.filter((s): s is string => Boolean(s && s.trim()));
  // A rotação é exclusiva do domínio Chatwoot. Um segredo de webhook não pode
  // autenticar rotas que esperam a credencial independente do n8n ou de cron.
  const principalChatwoot = optionalEnv("CHATWOOT_WEBHOOK_SECRET");
  const rotacao = principalChatwoot && legados.some((s) =>
      timingSafeEqual(s, principalChatwoot)
    )
    ? segredoEmRotacao()
    : undefined;

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

// ---------------------------------------------------------------------------------------
// Senha por família de rota (separação do segredo único, nov/2026).
//
// O CHATWOOT_WEBHOOK_SECRET vai no endereço dos webhooks das inboxes (o Chatwoot não manda
// cabeçalho), então aparece em log. Rotas que DISPARAM mensagem ou mexem no funil, e as de
// manutenção, ganham senha própria:
//   envio      -> BRIDGE_SEND_SECRET  (/send-outbound, /funil-enroll, /funil-control, /funil-queue-pump)
//   manutencao -> BRIDGE_OPS_SECRET   (/channel-sync, /hybrid-routes, /repair-official-5895)
//
// Transição sem derrubar nada:
//   1. (este código) a senha do Chatwoot continua valendo como RESERVA nessas rotas;
//   2. com a env da família definida, o bridge passa a usar a senha nova nas próprias
//      chamadas internas, e todo chamador EXTERNO que ainda chegar com a senha do Chatwoot
//      aparece no log ("senha do Chatwoot usada em ...") — é a lista do que falta migrar;
//   3. log limpo por alguns dias -> BRIDGE_SECRET_FALLBACK=false corta a reserva.
// A senha pode vir em `?token=` ou no cabeçalho `x-bridge-token` (preferível: não vai pra log).
// ---------------------------------------------------------------------------------------

export type FamiliaSegredo = "envio" | "manutencao";

const ENV_DA_FAMILIA: Record<FamiliaSegredo, string> = {
  envio: "BRIDGE_SEND_SECRET",
  manutencao: "BRIDGE_OPS_SECRET",
};

function senhaPropria(familia: FamiliaSegredo): string | undefined {
  const v = optionalEnv(ENV_DA_FAMILIA[familia]);
  return v && v.trim() ? v.trim() : undefined;
}

/** Token informado pelo chamador: cabeçalho `x-bridge-token` ou `?token=`. */
export function tokenInformado(req: Request): string {
  const header = req.headers.get("x-bridge-token");
  if (header && header.trim()) return header.trim();
  return new URL(req.url).searchParams.get("token") ?? "";
}

/**
 * Senha que o PRÓPRIO bridge usa ao chamar uma rota da família (chamadas `http://internal/`
 * e `http://localhost/`). Usa a senha própria quando existe, para o log de "reserva usada"
 * mostrar só chamador externo.
 */
export function segredoDaFamilia(familia: FamiliaSegredo): string {
  return senhaPropria(familia) ?? optionalEnv("CHATWOOT_WEBHOOK_SECRET") ?? "";
}

/** A reserva (senha do Chatwoot) vale até alguém desligar com BRIDGE_SECRET_FALLBACK=false. */
export function reservaChatwootLiberada(): boolean {
  return (optionalEnv("BRIDGE_SECRET_FALLBACK") ?? "").trim().toLowerCase() !== "false";
}

const ultimoAvisoReserva = new Map<string, number>();
const AVISO_RESERVA_A_CADA_MS = 10 * 60_000;

/**
 * Confere a senha de uma rota da família. Aceita a senha própria; a do Chatwoot só como
 * reserva (e avisa no log, no máximo 1x a cada 10 min por rota, quando a própria já existe).
 */
export function confereSegredoDaFamilia(
  informado: string | null | undefined,
  familia: FamiliaSegredo,
  origem: string,
  agora = Date.now(),
): boolean {
  const token = informado ?? "";
  if (!token) return false;
  const propria = senhaPropria(familia);
  // as duas comparações sempre rodam, em tempo constante, antes de decidir
  const casouPropria = propria ? timingSafeEqual(token, propria) : false;
  const casouChatwoot = confereSegredo(
    token,
    [optionalEnv("CHATWOOT_WEBHOOK_SECRET")],
    origem,
  );
  if (casouPropria) return true;
  if (!casouChatwoot) return false;
  if (!reservaChatwootLiberada()) {
    console.warn(
      `senha do Chatwoot RECUSADA em ${origem}: reserva desligada, use ${ENV_DA_FAMILIA[familia]}`,
    );
    return false;
  }
  if (propria) {
    const ultimo = ultimoAvisoReserva.get(origem) ?? 0;
    if (agora - ultimo >= AVISO_RESERVA_A_CADA_MS) {
      ultimoAvisoReserva.set(origem, agora);
      console.warn(
        `senha do Chatwoot usada em ${origem} — falta migrar este chamador para ${
          ENV_DA_FAMILIA[familia]
        }`,
      );
    }
  }
  return true;
}
