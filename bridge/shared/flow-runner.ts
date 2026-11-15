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
import { optionalEnv } from "./env.ts";
import { extractProviderSendId } from "./uazapi-provider-id.ts";
import {
  avaliarCondicao,
  type Flow,
  type FlowStep,
  opcoesOrdenadas,
  primeiroStep,
  proximoDe,
  renderStep,
  resolveNext,
  stepById,
  stepsUntilWait,
} from "./flow.ts";

// Interativo (botões/lista) da Uazapi/Baileys não renderiza em parte dos aparelhos. Com
// UAZAPI_INTERACTIVE_AS_TEXT=true, manda um menu NUMERADO em texto (chega em todo aparelho); o
// lead responde o número OU o nome e o resolveNext casa igual. Default off = comportamento nativo.
function interativoComoTexto(): boolean {
  return optionalEnv("UAZAPI_INTERACTIVE_AS_TEXT") === "true";
}
function menuTexto(step: FlowStep): string {
  const ops = opcoesOrdenadas(step);
  const linhas = ops.map((o, i) => `${i + 1}. ${o.title}`).join("\n");
  return `${step.text ?? ""}\n\n${linhas}\n\n_Responda com o número ou o nome da opção._`.trim();
}

type Json = Record<string, unknown>;

/**
 * Efeitos colaterais dos nós de lógica que o runner puro não pode fazer sozinho (banco, rede,
 * Chatwoot). Injetados pelo chamador, como `onSent`. Ausentes → o nó vira no-op e o fluxo
 * segue adiante (nunca trava por falta de efeito).
 */
export type FlowEfeitos = {
  /** kind=action — aplica/remove etiqueta e campos do contato */
  onAction?: (step: FlowStep) => Promise<void>;
  /** kind=api — dispara a chamada HTTP ao destino pré-aprovado */
  onApi?: (step: FlowStep) => Promise<void>;
  /** kind=transfer — encaminha pro time do Chatwoot e/ou posta o resumo do lead como nota privada */
  onTransfer?: (step: FlowStep) => Promise<void>;
};

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
  /** kind=goto — fluxo publicado para onde saltar; quem persiste o salto é o chamador */
  gotoFlowId?: string;
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
export type OnStepSent = (step: FlowStep, providerMessageId?: string) => Promise<void>;

/**
 * Envia um step. Devolve true se saiu por qualquer rota.
 *
 * Um step que falha nas duas rotas não interrompe o fluxo: interromper deixaria o lead
 * pendurado no meio da conversa sem nenhuma mensagem seguinte. Segue e conta a falha.
 */
/**
 * Ajusta as seções da lista ao limite do WhatsApp: até 10 seções e NO MÁXIMO 10 linhas
 * somando TODAS as seções (não 10 por seção). Trunca títulos (24) e descrição (72). Sem
 * isso a Meta recusa a lista com erro de limite excedido (E15055).
 */
function capListSections(sections: FlowStep["sections"]): { title: string; rows: { id: string; title: string; description?: string }[] }[] {
  let restante = 10;
  const out: { title: string; rows: { id: string; title: string; description?: string }[] }[] = [];
  for (const sec of (sections ?? []).slice(0, 10)) {
    if (restante <= 0) break;
    const rows = (sec.rows ?? []).slice(0, restante).map((r) => ({
      id: r.id,
      title: (r.title ?? "").slice(0, 24),
      description: r.description?.slice(0, 72),
    }));
    restante -= rows.length;
    if (rows.length) out.push({ title: (sec.title ?? "").slice(0, 24), rows });
  }
  return out;
}

async function enviarStep(
  ch: FlowChannel,
  to: string,
  step: FlowStep,
  vars: Record<string, string> = {},
): Promise<{ ok: boolean; providerMessageId?: string }> {
  // Personaliza os textos ({{nome}} etc.) antes de enviar. Ids/branches ficam intactos.
  step = renderStep(step, vars);
  // Transfer sem texto: nada a enviar, mas "sucesso" pra o onSent aplicar a etiqueta bot-off.
  if (step.kind === "transfer" && !step.text?.trim()) return { ok: true };
  const listSections = step.kind === "list" ? capListSections(step.sections) : [];
  if (ch.route) {
    let r = null;
    if ((step.kind === "text" || step.kind === "transfer" || step.kind === "ai" || step.kind === "input") && step.text) {
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
      r = interativoComoTexto()
        ? await hybridSendText(ch.route, to, menuTexto(step))
        : await hybridSendMenu(ch.route, to, step.text ?? "", step.buttons, step.imageUrl);
    } else if (step.kind === "list" && listSections.length) {
      r = interativoComoTexto()
        ? await hybridSendText(ch.route, to, menuTexto(step))
        : await hybridSendList(ch.route, to, step.text ?? "", listSections, "Ver opções");
    } else if (step.kind === "cta" && step.ctaUrl) {
      // Uazapi não tem botão-de-link nativo: manda texto + link (o WhatsApp gera a prévia).
      const corpo = `${step.text ?? ""}\n\n${step.ctaUrl}`.trim();
      r = await hybridSendText(ch.route, to, corpo);
    }
    if (r?.ok) {
      const providerMessageId = extractProviderSendId(r.data);
      return { ok: true, ...(providerMessageId ? { providerMessageId } : {}) };
    }
  }

  if (!ch.token || !ch.phoneNumberId) return { ok: false };
  const path = `${ch.phoneNumberId}/messages`;
  let body: Json | null = null;

  if ((step.kind === "text" || step.kind === "transfer" || step.kind === "ai" || step.kind === "input") && step.text) {
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
  } else if (step.kind === "list" && listSections.length) {
    body = {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: step.text ?? "" },
        action: {
          button: "Ver opções",
          sections: listSections,
        },
      },
    };
  } else if (step.kind === "cta" && step.ctaUrl) {
    // Botão de link nativo da Meta (interactive cta_url).
    body = {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "cta_url",
        body: { text: step.text ?? "" },
        action: {
          name: "cta_url",
          parameters: { display_text: (step.ctaText ?? "Abrir").slice(0, 20), url: step.ctaUrl },
        },
      },
    };
  }
  if (!body) return { ok: false };
  const r = await sendMeta(ch.token, path, body);
  if (!r.ok) {
    console.error(
      `flow: step ${step.id} falhou nas duas rotas:`,
      JSON.stringify((r.data as Json)?.error ?? r.data).slice(0, 200),
    );
  }
  const providerMessageId = r.ok ? extractProviderSendId(r.data) : null;
  return { ok: r.ok, ...(providerMessageId ? { providerMessageId } : {}) };
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
  vars: Record<string, string> = {},
  efeitos: FlowEfeitos = {},
  _depth = 0,
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
    const sent = await enviarStep(ch, to, step, vars);
    if (sent.ok) {
      enviados++;
      // Registrar não pode derrubar o fluxo: a mensagem já chegou ao lead, e abortar aqui
      // deixaria a conversa pela metade por causa de um problema de bookkeeping.
      if (onSent) {
        try {
          await onSent(step, sent.providerMessageId);
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

  // Transferir humano: além de silenciar o bot (etiqueta bot-off via onSent), encaminha a conversa
  // pro time do Chatwoot (se tem time) e/ou posta o resumo do lead como nota privada (se tem resumo).
  // Efeito best-effort; não muda o fluxo (que encerra).
  if (pararEm?.kind === "transfer" && (pararEm.transferTeamId || pararEm.resumo || pararEm.qualificarIA) && efeitos.onTransfer) {
    try {
      await efeitos.onTransfer(pararEm);
    } catch (e) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e);
      console.error(`flow: onTransfer ${pararEm.id} falhou: ${msg}`);
    }
  }

  // Condição: avalia a regra e segue o ramo sim/não sem enviar nada. `_depth` evita loop de
  // condições encadeadas (A→B→A); o validateFlow recusa ciclos, isto é a segunda barreira.
  if (pararEm?.kind === "condition") {
    if (_depth > 20) return { enviados, falhas, position: { stepId: null, done: true } };
    const ramo = avaliarCondicao(pararEm, vars);
    const destino = pararEm.branches?.[ramo] ?? null;
    if (!destino) return { enviados, falhas, position: { stepId: null, done: true } };
    const r = await runFlow(flow, ch, to, destino, now, onSent, vars, efeitos, _depth + 1);
    return { enviados: enviados + r.enviados, falhas: falhas + r.falhas, position: r.position, aguardarMinutos: r.aguardarMinutos, gotoFlowId: r.gotoFlowId };
  }

  // Ação contato / Chamada API: executam o efeito colateral (banco/rede, via callback) e seguem
  // adiante sem enviar mensagem. O efeito nunca derruba o fluxo — falhou, loga e segue; o lead
  // não pode ficar preso por um webhook fora do ar. `_depth` corta encadeamento infinito.
  if (pararEm?.kind === "action" || pararEm?.kind === "api") {
    if (_depth > 20) return { enviados, falhas, position: { stepId: null, done: true } };
    try {
      if (pararEm.kind === "action" && efeitos.onAction) await efeitos.onAction(pararEm);
      if (pararEm.kind === "api" && efeitos.onApi) await efeitos.onApi(pararEm);
    } catch (e) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e);
      console.error(`flow: ${pararEm.kind} ${pararEm.id} falhou: ${msg}`);
    }
    const destino = proximoDe(flow, pararEm);
    if (!destino) return { enviados, falhas, position: { stepId: null, done: true } };
    const r = await runFlow(flow, ch, to, destino, now, onSent, vars, efeitos, _depth + 1);
    return { enviados: enviados + r.enviados, falhas: falhas + r.falhas, position: r.position, aguardarMinutos: r.aguardarMinutos, gotoFlowId: r.gotoFlowId };
  }

  // Ir para fluxo: encerra ESTE fluxo e devolve o alvo. Quem carrega o fluxo-alvo e persiste
  // qual fluxo o contato passou a seguir é o chamador (exige a coluna flow_ref — migration).
  if (pararEm?.kind === "goto") {
    // Encerra ESTE fluxo e devolve o alvo. Se o goto estiver ligado, o chamador (continuarGotos)
    // carrega o fluxo-alvo e segue; se desligado, para aqui. Quem loga o salto efetivo é o chamador.
    console.log(`flow-goto: nó ${pararEm.id} -> fluxo ${pararEm.gotoFlowId ?? "?"}`);
    return { enviados, falhas, position: { stepId: null, done: true }, gotoFlowId: pararEm.gotoFlowId };
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
  vars: Record<string, string> = {},
  efeitos: FlowEfeitos = {},
): Promise<RunResult> {
  const atual = stepById(flow, currentStepId);
  if (!atual) {
    return { enviados: 0, falhas: 0, position: { stepId: null, done: true } };
  }
  const proximo = resolveNext(atual, replyId);
  if (!proximo) {
    return { enviados: 0, falhas: 0, position: { stepId: null, done: true } };
  }
  return await runFlow(flow, ch, to, proximo, now, onSent, vars, efeitos);
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
