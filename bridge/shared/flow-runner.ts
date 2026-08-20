// flow-runner — executa o fluxo de shared/flow.ts pela rota híbrida.
//
// Divisão: `flow.ts` decide PARA ONDE ir (puro, testável sem rede); aqui só se envia e se
// guarda onde parou. Quem quiser mudar a regra de ramificação mexe lá, não aqui.
//
// Envio sempre tenta o não-oficial primeiro e cai no oficial quando falha — mesma política
// do resto do projeto (ver shared/hybrid.ts). O motivo de preferir o não-oficial não é só
// custo: botão e lista nativos não dependem de template aprovado, então o fluxo pode mudar
// sem passar pela fila de aprovação da Meta.
import type { HybridRoute } from "./hybrid.ts";
import {
  hybridSendList,
  hybridSendMedia,
  hybridSendMenu,
  hybridSendText,
} from "./hybrid.ts";
import { sendMeta } from "./hub.ts";
import { toVoiceOgg } from "./audio.ts";
import {
  type Flow,
  type FlowStep,
  primeiroStep,
  resolveNext,
  stepById,
  stepsUntilWait,
} from "./flow.ts";

type Json = Record<string, unknown>;

/** Onde o fluxo parou para este contato. Persistido pelo chamador. */
export type FlowPosition = {
  /** step em que está aguardando resposta; null = fluxo terminou */
  stepId: string | null;
  /** quando entrou em espera — base para o timeout */
  waitingSince?: string;
  done?: boolean;
};

export type FlowChannel = {
  /** rota não-oficial; null força tudo pelo oficial */
  route: HybridRoute | null;
  /** token do canal oficial (fallback) */
  token?: string;
  /** phone_number_id do canal oficial (fallback) */
  phoneNumberId?: string;
};

export type RunResult = {
  enviados: number;
  falhas: number;
  position: FlowPosition;
  /** step de `wait` a agendar, se o fluxo parou numa pausa por tempo */
  aguardarMinutos?: number;
};

/**
 * Chamado depois de cada peça que SAIU, para o chamador registrar a mensagem.
 *
 * Existe porque o fluxo envia direto pela rota híbrida, sem passar por `/send-outbound`, e o
 * webhook do uazapi descarta o eco de mensagem enviada pela API (`wasSentByApi`). Resultado
 * medido em 20/08: das ~10 peças de um fluxo, o banco guardava 1 — o atendente via a resposta
 * do lead sem a pergunta que a gerou, como se ele falasse sozinho.
 *
 * Fica como callback, e não como escrita aqui dentro, para este módulo continuar sem banco e
 * testável com um canal falso — mesma divisão que separa `flow.ts` (decide) de `flow-runner`
 * (envia).
 */
export type OnStepSent = (step: FlowStep) => Promise<void>;

/**
 * Envia um step. Devolve true se saiu por qualquer rota.
 *
 * Um step que falha nas duas rotas não interrompe o fluxo: interromper deixaria o lead
 * pendurado no meio da conversa sem nenhuma mensagem seguinte. Segue e conta a falha.
 */
async function enviarStep(
  ch: FlowChannel,
  to: string,
  step: FlowStep,
): Promise<boolean> {
  if (ch.route) {
    let r = null;
    if (step.kind === "text" && step.text) {
      r = await hybridSendText(ch.route, to, step.text);
    } else if (step.kind === "media" && step.media?.url) {
      let url = step.media.url;
      // áudio precisa virar OGG/opus pra sair como bolha de voz e não como arquivo
      if (step.media.type === "audio") {
        const ogg = await toVoiceOgg(url);
        if (ogg) url = ogg;
      }
      r = await hybridSendMedia(ch.route, to, url, step.media.type, {
        caption: step.media.type !== "audio" ? step.text : undefined,
        fileName: step.media.fileName,
        isVoice: step.media.type === "audio",
      });
    } else if (step.kind === "buttons" && step.buttons?.length) {
      r = await hybridSendMenu(
        ch.route,
        to,
        step.text ?? "",
        step.buttons,
        step.imageUrl,
      );
    } else if (step.kind === "list" && step.sections?.length) {
      r = await hybridSendList(
        ch.route,
        to,
        step.text ?? "",
        step.sections,
        "Ver opções",
      );
    }
    if (r?.ok) return true;
  }

  if (!ch.token || !ch.phoneNumberId) return false;
  const path = `${ch.phoneNumberId}/messages`;
  let body: Json | null = null;

  if (step.kind === "text" && step.text) {
    body = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: step.text },
    };
  } else if (step.kind === "media" && step.media?.url) {
    const media: Json = { link: step.media.url };
    if (step.media.type !== "audio" && step.text) media.caption = step.text;
    if (step.media.fileName) media.filename = step.media.fileName;
    body = {
      messaging_product: "whatsapp",
      to,
      type: step.media.type,
      [step.media.type]: media,
    };
  } else if (step.kind === "buttons" && step.buttons?.length) {
    // Fora da janela a Meta recusa interativo e só aceita template — o fallback aqui vale
    // quando a janela está aberta (o lead respondeu há pouco), que é o caso comum no meio
    // de um fluxo.
    body = {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: step.text ?? "" },
        action: {
          buttons: step.buttons.slice(0, 3).map((b) => ({
            type: "reply",
            reply: { id: b.id, title: b.title.slice(0, 20) },
          })),
        },
      },
    };
  } else if (step.kind === "list" && step.sections?.length) {
    body = {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: step.text ?? "" },
        action: {
          button: "Ver opções",
          sections: step.sections.map((s) => ({
            title: s.title.slice(0, 24),
            rows: s.rows.slice(0, 10).map((r) => ({
              id: r.id,
              title: r.title.slice(0, 24),
              description: r.description?.slice(0, 72),
            })),
          })),
        },
      },
    };
  }
  if (!body) return false;
  const r = await sendMeta(ch.token, path, body);
  if (!r.ok) {
    console.error(
      `flow: step ${step.id} falhou nas duas rotas:`,
      JSON.stringify((r.data as Json)?.error ?? r.data).slice(0, 200),
    );
  }
  return r.ok;
}

/**
 * Roda o fluxo a partir de onde parou até precisar esperar de novo.
 *
 * `fromStepId` nulo começa do início. Devolve a nova posição para o chamador persistir —
 * este módulo não escreve no banco de propósito, para poder ser testado com um canal falso.
 */
export async function runFlow(
  flow: Flow,
  ch: FlowChannel,
  to: string,
  fromStepId: string | null,
  now = Date.now(),
  onSent?: OnStepSent,
): Promise<RunResult> {
  const inicio = fromStepId ? stepById(flow, fromStepId) : primeiroStep(flow);
  if (!inicio) {
    return { enviados: 0, falhas: 0, position: { stepId: null, done: true } };
  }

  const { enviar, pararEm, fim } = stepsUntilWait(flow, inicio.id);
  let enviados = 0, falhas = 0;
  for (const step of enviar) {
    // Ritmo entre as peças. Sem isso o bloco inteiro sai colado e o lead recebe imagem,
    // áudio e pergunta no mesmo segundo — parece robô e some com a chance de ele ler cada
    // uma. O primeiro step não espera: quem acabou de ser abordado não fica olhando tela
    // vazia.
    if (step.delaySeg && step !== enviar[0]) {
      await new Promise((r) => setTimeout(r, step.delaySeg! * 1000));
    }
    if (await enviarStep(ch, to, step)) {
      enviados++;
      // Registrar não pode derrubar o fluxo: a mensagem já chegou ao lead, e abortar aqui
      // deixaria a conversa pela metade por causa de um problema de bookkeeping.
      if (onSent) {
        try {
          await onSent(step);
        } catch (e) {
          // Mensagem real do erro, não o objeto: em 20/08 o canal vinha sem
          // `chatwoot_inbox_identifier` (o SELECT trazia só 3 colunas), `ingestInbound`
          // lançava, e a falha sumiu num log ilegível — o fluxo seguia parecendo saudável
          // enquanto nada era gravado.
          const msg = e instanceof Error ? e.message : JSON.stringify(e);
          console.error(`flow: NAO registrou step ${step.id}: ${msg}`);
        }
      }
    } else falhas++;
  }

  if (pararEm?.kind === "wait") {
    return {
      enviados,
      falhas,
      aguardarMinutos: pararEm.minutes ?? 0,
      position: {
        stepId: pararEm.id,
        waitingSince: new Date(now).toISOString(),
      },
    };
  }
  if (fim || !pararEm) {
    return { enviados, falhas, position: { stepId: null, done: true } };
  }
  return {
    enviados,
    falhas,
    position: {
      stepId: pararEm.id,
      waitingSince: new Date(now).toISOString(),
    },
  };
}

/**
 * Continua o fluxo depois que o lead respondeu.
 *
 * `replyId` é o id do botão/linha clicada; texto livre entra como null e segue por
 * `fallbackNext`.
 */
export async function advanceFlow(
  flow: Flow,
  ch: FlowChannel,
  to: string,
  currentStepId: string,
  replyId: string | null,
  now = Date.now(),
  onSent?: OnStepSent,
): Promise<RunResult> {
  const atual = stepById(flow, currentStepId);
  if (!atual) {
    return { enviados: 0, falhas: 0, position: { stepId: null, done: true } };
  }
  const proximo = resolveNext(atual, replyId);
  if (!proximo) {
    return { enviados: 0, falhas: 0, position: { stepId: null, done: true } };
  }
  return await runFlow(flow, ch, to, proximo, now, onSent);
}

/**
 * Passou do tempo de espera deste step?
 *
 * Sem isso o fluxo fica pendurado para sempre em quem não responde — e quem não responde é
 * a maioria: o funil mede 19% a 79% de resposta por fase.
 */
export function esperaVencida(
  step: FlowStep,
  waitingSince: string | undefined,
  now = Date.now(),
): boolean {
  if (!step.timeoutMin || !waitingSince) return false;
  const desde = Date.parse(waitingSince);
  if (!Number.isFinite(desde)) return false;
  return now - desde >= step.timeoutMin * 60_000;
}
