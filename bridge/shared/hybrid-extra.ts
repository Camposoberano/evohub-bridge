// hybrid-extra — os tipos de mensagem que a Meta não tem e só existem pela uazapi:
// enquete, carrossel, botão PIX e solicitação de pagamento. Mais a verificação de
// instância que roda ANTES do disparo.
//
// Separado de hybrid.ts de propósito: lá tudo tem fallback para o oficial, porque texto,
// mídia, botões e lista existem nos dois lados. Aqui não existe fallback — a Meta não tem
// equivalente destes formatos. Chamar sem rota devolve null, e o chamador decide se pula o
// contato ou manda outra coisa.
//
// Campos conferidos contra docs.uazapi.com/openapi-bundled.json (uazapiGO - WhatsApp API).
import { instGet, instPost } from "./uazapi.ts";
import type { HybridRoute, SendResult } from "./hybrid.ts";

type Json = Record<string, unknown>;

async function enviar(
  route: HybridRoute,
  endpoint: string,
  body: Json,
  tipo: string,
): Promise<SendResult | null> {
  try {
    const r = await instPost(endpoint, route.token, body);
    if (!r.ok) {
      console.warn(
        `hybrid ${tipo} falhou:`,
        r.status,
        JSON.stringify(r.data).slice(0, 300),
      );
      return null;
    }
    return { ok: true, status: r.status, data: r.data, via: "uazapi" };
  } catch (e) {
    console.warn(`hybrid ${tipo} erro:`, String(e).slice(0, 120));
    return null;
  }
}

/**
 * Enquete. `POST /send/menu` com `type: "poll"`.
 *
 * `selectableCount` define quantas opções o contato pode marcar — 1 é escolha única, que é
 * o caso de qualificação ("leite ou corte?"). A resposta chega como voto, não como clique
 * de botão, então quem consome precisa tratar os dois formatos.
 */
export function hybridSendPoll(
  route: HybridRoute,
  to: string,
  text: string,
  opcoes: string[],
  selectableCount = 1,
): Promise<SendResult | null> {
  return enviar(route, "/send/menu", {
    number: to,
    type: "poll",
    text,
    choices: opcoes,
    selectableCount,
  }, "poll");
}

export type CarouselCard = {
  /** primeira linha vira título em negrito no cartão */
  text: string;
  image?: string;
  video?: string;
  document?: string;
  filename?: string;
  buttons: { id: string; title: string }[];
};

/**
 * Carrossel de cartões com imagem e botões próprios. `POST /send/carousel`.
 *
 * Cada cartão tem os seus botões, então dá para oferecer "ver preço" por produto — é o
 * formato certo para catálogo, onde a lista obriga o contato a abrir um menu antes de ver
 * qualquer coisa.
 */
export function hybridSendCarousel(
  route: HybridRoute,
  to: string,
  text: string,
  cards: CarouselCard[],
): Promise<SendResult | null> {
  return enviar(route, "/send/carousel", {
    number: to,
    text,
    carousel: cards.map((c) => ({
      text: c.text,
      image: c.image,
      video: c.video,
      document: c.document,
      filename: c.filename,
      buttons: c.buttons.map((b) => ({ id: b.id, text: b.title })),
    })),
  }, "carousel");
}

export type PixType = "CPF" | "CNPJ" | "PHONE" | "EMAIL" | "EVP";

/** Botão PIX nativo: o contato vê recebedor e chave e paga sem sair do WhatsApp. */
export function hybridSendPixButton(
  route: HybridRoute,
  to: string,
  pix: { pixType: PixType; pixKey: string; pixName?: string },
): Promise<SendResult | null> {
  return enviar(route, "/send/pix-button", {
    number: to,
    pixType: pix.pixType,
    pixKey: pix.pixKey,
    pixName: pix.pixName,
  }, "pix-button");
}

/**
 * Solicitação de pagamento com o botão nativo "Revisar e pagar". `POST /send/request-payment`.
 *
 * Junta valor, item e forma de pagamento numa mensagem só. Aceita PIX, boleto e link de
 * checkout — `paymentLink` só funciona com domínio homologado na Meta, então link de
 * gateway qualquer é recusado.
 */
export function hybridRequestPayment(
  route: HybridRoute,
  to: string,
  p: {
    amount: number;
    title?: string;
    text?: string;
    footer?: string;
    itemName?: string;
    invoiceNumber?: string;
    pixKey?: string;
    pixType?: PixType;
    pixName?: string;
    paymentLink?: string;
    boletoCode?: string;
    fileUrl?: string;
    fileName?: string;
  },
): Promise<SendResult | null> {
  return enviar(route, "/send/request-payment", {
    number: to,
    amount: p.amount,
    title: p.title,
    text: p.text,
    footer: p.footer,
    itemName: p.itemName,
    invoiceNumber: p.invoiceNumber,
    pixKey: p.pixKey,
    pixType: p.pixType,
    pixName: p.pixName,
    paymentLink: p.paymentLink,
    boletoCode: p.boletoCode,
    fileUrl: p.fileUrl,
    fileName: p.fileName,
  }, "request-payment");
}

export type ProntidaoInstancia = {
  pronta: boolean;
  status: string;
  /** o WhatsApp diz que esta conta pode iniciar novas conversas? */
  podeIniciarConversa: boolean | null;
  motivo?: string;
};

/**
 * Confere se dá para disparar ANTES de começar.
 *
 * São duas perguntas diferentes e as duas derrubam campanha:
 * 1. a instância está conectada? (`/instance/status`) — desconectada, todo envio falha
 * 2. a conta pode iniciar novas conversas? (`/instance/wa_messages_limits`) — é o limite
 *    que produz `provider_code: 463`, e ele aparece só no meio do disparo, quando metade da
 *    lista já foi queimada
 *
 * Falha de consulta não bloqueia (`pronta` segue o status): deixar de disparar porque o
 * endpoint de diagnóstico oscilou seria pior que disparar.
 */
export async function checarProntidao(
  route: HybridRoute,
): Promise<ProntidaoInstancia> {
  let status = "desconhecido";
  try {
    const r = await instGet("/instance/status", route.token);
    const d = (r.data ?? {}) as Json;
    const inst = (d.instance ?? d.status ?? {}) as Json;
    status = String(inst.status ?? d.status ?? "desconhecido");
  } catch (e) {
    return {
      pronta: false,
      status: "erro",
      podeIniciarConversa: null,
      motivo: `status inacessível: ${String(e).slice(0, 80)}`,
    };
  }

  let podeIniciar: boolean | null = null;
  let motivo: string | undefined;
  try {
    const r = await instGet("/instance/wa_messages_limits", route.token);
    const d = (r.data ?? {}) as Json;
    if (d.reachable === true) {
      // o campo exato varia com a resposta do WhatsApp; qualquer sinal explícito de bloqueio
      // vale mais que o default otimista
      const bloqueado = JSON.stringify(d).match(/"(blocked|limited|restricted)"\s*:\s*true/i);
      podeIniciar = !bloqueado;
      if (bloqueado) motivo = "WhatsApp sinaliza limite de novas conversas";
    }
  } catch {
    // diagnóstico indisponível não é impedimento
  }

  const conectada = /connected|open/i.test(status);
  return {
    pronta: conectada && podeIniciar !== false,
    status,
    podeIniciarConversa: podeIniciar,
    motivo: motivo ??
      (conectada ? undefined : `instância ${status}`),
  };
}
