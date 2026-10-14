// flow-inbound — a resposta do lead continua o fluxo de onde parou.
//
// Chamado pelos DOIS webhooks: fluxo que saiu pela rota híbrida recebe a resposta pelo
// uazapi, o que saiu pelo oficial recebe pelo hub. Enquanto isso viveu só no webhook
// oficial, campanha híbrida ficava muda depois que o lead respondia.
import type { DbClient } from "./supabase.ts";
import { readCampaigns } from "./campaigns.ts";
import { dentroDaJanela, PACE_PADRAO } from "./campaign-pace.ts";
import { EMBRAPA_5895_CAMPAIGN_ID, shouldDeferEmbrapaPdf } from "./embrapa-offer-reply.ts";
import { isBotMutedForContact } from "./bot-mute.ts";
import { getHybridRoute } from "./hybrid.ts";
import {
  advanceFlow,
  esperaVencida,
  type FlowChannel,
  runFlow,
} from "./flow-runner.ts";
import { stepById } from "./flow.ts";
import { resolveEmbrapaOfferReply } from "./embrapa-offer-reply.ts";
import { gravadorDeFluxo } from "./flow-record.ts";
import {
  cancelDeferredFlow,
  claimDeferredFlow,
  claimFlowStep,
  deferFlowStep,
  findDeferredFlowForContact,
  findDeferredFlows,
  findExpiredWaits,
  findWaitingFlow,
  saveFlowPosition,
  setClaimedFlowStatus,
} from "./flow-state.ts";
import {
  type Bloqueio,
  bloqueioPorContato,
  motivoDoBloqueio,
} from "./gate-comercial.ts";

type Json = Record<string, unknown>;

/**
 * Tira o contato do fluxo de vez porque a venda fechou ou o cliente disse que não compra.
 *
 * Marca `done` em vez de deixar `waiting`: deixado esperando, a etapa vence de novo na
 * rodada seguinte e o bloqueio vira um laço que consulta o banco a cada 2 minutos para
 * sempre. O evento é o que deixa isso visível — bloqueio silencioso é indistinguível de
 * campanha vazia.
 */
async function encerrarFluxoPorDesfecho(
  db: DbClient,
  p: { campaign_id: string; contact_key: string; conversation_id?: string | null },
  canal: Json,
  bloqueio: Bloqueio,
): Promise<void> {
  const motivo = motivoDoBloqueio(bloqueio);
  await saveFlowPosition(db, p.campaign_id, p.contact_key, {
    stepId: null,
    done: true,
  }, { conversationId: p.conversation_id ?? null, channelId: String(canal.id) });
  console.log(
    "flow-timeout: etapa bloqueada",
    p.campaign_id,
    p.contact_key.slice(-4),
    motivo,
  );
  try {
    const { error } = await db.from("events").insert({
      source: "campanha",
      event_type: "envio_bloqueado_etiqueta",
      channel_id: canal.id ?? null,
      payload: {
        campanha: p.campaign_id,
        conversation_id: p.conversation_id ?? null,
        motivo,
        origem: "flow-timeout",
      },
    });
    if (error) throw error;
  } catch (e) {
    console.error("flow-timeout: evento de bloqueio falhou", e);
  }
}

/**
 * Monta as duas rotas de saída do canal: a não-oficial (preferida) e a oficial (rede).
 * Uma pode faltar — o runner lida com isso.
 */
export async function flowChannelFor(
  db: DbClient,
  channel: Json,
): Promise<FlowChannel> {
  const { data: secret } = await db.from("channel_secrets")
    .select("channel_token").eq("channel_id", channel.id).maybeSingle();
  const phoneNumberId = channel.phone_number_id as string | undefined;
  const route = await getHybridRoute(
    String(channel.id),
    phoneNumberId ?? "",
    (channel.phone_number as string) ?? "",
  );
  return {
    route,
    token: secret?.channel_token as string | undefined,
    phoneNumberId,
  };
}

/**
 * Segue os fluxos cuja espera venceu.
 *
 * Sem isto o fluxo fica pendurado para sempre em quem não responde — e quem não responde é
 * a maioria: o funil mede de 19% a 79% de resposta por fase. O step declara `timeoutMin` e
 * `onTimeout`; `validateFlow` recusa um sem o outro, justamente para não existir espera sem
 * saída.
 *
 * Varre por tempo mínimo (o menor `timeoutMin` que faz sentido operacional) e depois aplica
 * a régua exata de cada step — cada pergunta pode ter o seu.
 */
export async function pumpFlowTimeouts(
  db: DbClient,
  minutosMin = 5,
  now = Date.now(),
): Promise<{ avaliados: number; seguiram: number; bloqueados: number }> {
  const resultado = { avaliados: 0, seguiram: 0, bloqueados: 0 };
  const pendentes = await findExpiredWaits(db, minutosMin, 200, now);
  if (!pendentes.length) return resultado;

  const state = await readCampaigns();
  for (const p of pendentes) {
    if (!p.step_id) continue;
    resultado.avaliados++;
    const camp = state.campaigns.find((c) => c.id === p.campaign_id);
    if (!camp?.flow) continue;
    const step = stepById(camp.flow, p.step_id);
    if (!step) continue;
    if (!esperaVencida(step, p.waiting_since ?? undefined, now)) continue;
    if (!step.onTimeout) continue;

    const { data: canal } = await db.from("channels")
      .select(
        "id,type,name,phone_number,phone_number_id,chatwoot_inbox_id,chatwoot_inbox_identifier",
      )
      .eq("id", p.channel_id).maybeSingle();
    if (!canal) continue;

    // Quem já comprou ou disse que não compra sai da cadeia AQUI também. Este laço era o
    // único disparador sem nenhuma trava comercial: em 13/09 mandou "Meu amigo, não quero
    // incomodar…" para 8 conversas etiquetadas `wa:não compra`, uma delas horas depois da
    // etiqueta. Erro na consulta segura a etapa em vez de soltar: não saber se o cliente
    // comprou é motivo para não mandar.
    let bloqueio: Bloqueio | null = null;
    try {
      bloqueio = await bloqueioPorContato(db, String(canal.id), p.contact_key);
    } catch (e) {
      resultado.bloqueados++;
      console.error(
        "flow-timeout: não deu para conferir etiqueta, etapa segurada:",
        p.contact_key.slice(-4),
        e,
      );
      continue;
    }
    if (bloqueio) {
      resultado.bloqueados++;
      await encerrarFluxoPorDesfecho(db, p, canal as Json, bloqueio);
      continue;
    }

    try {
      const ch = await flowChannelFor(db, canal as Json);
      // segue direto pro destino do timeout, sem passar por resolveNext: o lead não
      // respondeu, então não há resposta para ramificar
      const r = await runFlow(
        camp.flow,
        ch,
        p.contact_key,
        step.onTimeout,
        now,
        gravadorDeFluxo(db, canal as Json, p.contact_key),
      );
      await saveFlowPosition(db, camp.id, p.contact_key, r.position, {
        conversationId: p.conversation_id,
        channelId: String(canal.id),
      });
      resultado.seguiram++;
      console.log(
        "flow-timeout:",
        camp.id,
        p.contact_key.slice(-4),
        `${p.step_id} -> ${step.onTimeout}`,
      );
    } catch (e) {
      console.error("flow-timeout erro:", p.contact_key.slice(-4), e);
    }
  }
  return resultado;
}

/**
 * Continua o fluxo se este contato estiver esperando em algum.
 *
 * Devolve `true` quando consumiu a mensagem — o webhook deve parar aí e não rodar as
 * respostas automáticas de intenção. O lead que está no meio de um fluxo respondeu à
 * pergunta do fluxo; disparar a tabela de preço por cima seria duas mensagens ao mesmo
 * tempo, vindas de lógicas diferentes.
 *
 * `replyId` é o id do botão/linha clicada, ou null para texto livre (que segue por
 * `fallbackNext` — quem digita não pode ficar preso esperando um clique).
 */
export async function continueFlowOnReply(
  db: DbClient,
  channel: Json,
  from: string,
  replyId: string | null,
  text?: string | null,
): Promise<boolean> {
  let estado;
  try {
    estado = await findWaitingFlow(db, from);
  } catch (e) {
    console.error("flow-inbound: consulta de estado falhou:", e);
    return false;
  }
  if (!estado?.step_id) {
    // Um segundo "Quero" não abre outro envio. Uma recusa posterior cancela o PDF
    // ainda aguardando a janela, antes da reserva exclusiva pelo worker.
    const deferred = await findDeferredFlowForContact(db, from);
    if (deferred?.campaign_id !== EMBRAPA_5895_CAMPAIGN_ID || !deferred.step_id) return false;
    const choice = resolveEmbrapaOfferReply({
      campaignId: deferred.campaign_id,
      stepId: deferred.step_id,
      replyId,
      text,
    });
    if (choice === "nao") {
      await cancelDeferredFlow(db, deferred.campaign_id, from, deferred.step_id);
      return true;
    }
    return choice === "quero";
  }

  const state = await readCampaigns();
  const camp = state.campaigns.find((c) => c.id === estado.campaign_id);
  if (!camp?.flow) {
    // campanha sumiu ou não é de fluxo: encerra o estado para o contato não ficar preso
    await saveFlowPosition(db, estado.campaign_id, from, {
      stepId: null,
      done: true,
    });
    return false;
  }

  const embrapaReply = resolveEmbrapaOfferReply({
    campaignId: camp.id,
    stepId: estado.step_id,
    replyId,
    text,
  });
  if (embrapaReply === null) {
    // Pergunta, dúvida ou texto não inequívoco: preserva a espera e não libera PDF.
    return false;
  }
  const branchReplyId = embrapaReply === undefined ? replyId : embrapaReply;

  // Reserva o passo antes de enviar qualquer coisa. Gravar o estado antes não bastava:
  // evitava o clique repetido com segundos de intervalo, mas não dois eventos simultâneos —
  // ambos liam `waiting` antes de qualquer um gravar, e o ramo saía duas vezes (visto no
  // log: o mesmo `necessidade -> isca` processado em duplicata).
  //
  // Aqui quem decide é o banco: o UPDATE exige `status='waiting'`, então só uma resposta
  // casa a condição. A que perder recebe zero linhas e sai sem enviar nada.
  const passo = estado.step_id;
  if (!await claimFlowStep(db, estado.campaign_id, from, passo)) {
    console.log(
      "flow: passo já reservado por outra resposta,",
      from.slice(-4),
      passo,
    );
    return true; // consome a mensagem: o fluxo está sendo tratado pela outra
  }

  const extra = {
    conversationId: estado.conversation_id,
    channelId: String(channel.id),
  };
  try {
    if (camp.id === EMBRAPA_5895_CAMPAIGN_ID && branchReplyId === "quero") {
      const [blocked, muted] = await Promise.all([
        bloqueioPorContato(db, String(channel.id), from),
        isBotMutedForContact(db, String(channel.id), from),
      ]);
      if (blocked || muted) {
        await saveFlowPosition(db, camp.id, from, { stepId: null, done: true }, extra);
        console.log("flow: PDF Embrapa bloqueado", from.slice(-4), blocked ?? "bot-off");
        return true;
      }
    }
    if (shouldDeferEmbrapaPdf({
      campaignId: camp.id, stepId: passo, branchReplyId,
      pace: camp.pace, now: Date.now(),
    })) {
      await deferFlowStep(db, camp.id, from, passo, String(channel.id));
      console.log("flow: PDF Embrapa aguardando janela", from.slice(-4));
      return true;
    }
    const ch = await flowChannelFor(db, channel);
    // A consulta de rota pode atravessar as 20h; a última checagem vem antes do envio.
    if (shouldDeferEmbrapaPdf({
      campaignId: camp.id, stepId: passo, branchReplyId,
      pace: camp.pace, now: Date.now(),
    })) {
      await deferFlowStep(db, camp.id, from, passo, String(channel.id));
      return true;
    }
    const r = await advanceFlow(
      camp.flow,
      ch,
      from,
      passo,
      branchReplyId,
      Date.now(),
      gravadorDeFluxo(db, channel, from),
    );
    await saveFlowPosition(db, camp.id, from, r.position, extra);
    console.log(
      "flow:",
      camp.id,
      from.slice(-4),
      `${passo} -> ${r.position.stepId ?? "fim"}`,
      `enviados=${r.enviados} falhas=${r.falhas}`,
    );
  } catch (e) {
    // Sem isto o estado ficaria em `processing` para sempre: nem o webhook (que busca
    // `waiting`) nem o loop de timeout voltariam nele, e o lead ficaria mudo no meio da
    // conversa. Devolve para a espera, onde a próxima resposta ou o timeout o alcançam.
    console.error("flow: falhou ao avançar, devolvendo à espera:", e);
    await saveFlowPosition(db, camp.id, from, {
      stepId: passo,
      waitingSince: estado.waiting_since ?? new Date().toISOString(),
    }, extra);
    throw e;
  }
  return true;
}

/** Retoma pedidos de PDF feitos fora das 08h–20h, sem repetir envios após falha incerta. */
export async function pumpDeferredEmbrapaPdf(
  db: DbClient,
  now = Date.now(),
): Promise<{ pending: number; sent: number; blocked: number; failed: number }> {
  const result = { pending: 0, sent: 0, blocked: 0, failed: 0 };
  const state = await readCampaigns();
  const camp = state.campaigns.find((c) => c.id === EMBRAPA_5895_CAMPAIGN_ID);
  if (!camp?.flow) return result;
  const cfg = { ...PACE_PADRAO, ...(camp.pace ?? {}) };
  if (!dentroDaJanela(cfg, now)) return result;
  // Um pedido por minuto; uma manhã com várias respostas noturnas não vira rajada.
  const pending = await findDeferredFlows(db, camp.id, 1);
  result.pending = pending.length;
  for (const p of pending) {
    if (!p.step_id) continue;
    if (!dentroDaJanela(cfg, Date.now())) break;
    if (!await claimDeferredFlow(db, camp.id, p.contact_key, p.step_id)) continue;
    let sending = false;
    try {
      if (!p.channel_id) {
        await setClaimedFlowStatus(db, camp.id, p.contact_key, p.step_id, "failed");
        result.failed++;
        continue;
      }
      const { data: canal, error } = await db.from("channels")
        .select("id,type,name,phone_number,phone_number_id,chatwoot_inbox_id,chatwoot_inbox_identifier")
        .eq("id", p.channel_id).maybeSingle();
      if (error) throw error;
      if (!canal) {
        await setClaimedFlowStatus(db, camp.id, p.contact_key, p.step_id, "failed");
        result.failed++;
        continue;
      }
      const [blocked, muted] = await Promise.all([
        bloqueioPorContato(db, String(canal.id), p.contact_key),
        isBotMutedForContact(db, String(canal.id), p.contact_key),
      ]);
      if (blocked || muted) {
        await setClaimedFlowStatus(db, camp.id, p.contact_key, p.step_id, "done");
        result.blocked++;
        continue;
      }
      const ch = await flowChannelFor(db, canal as Json);
      if (!dentroDaJanela(cfg, Date.now())) {
        await setClaimedFlowStatus(db, camp.id, p.contact_key, p.step_id, "deferred");
        break;
      }
      sending = true;
      const r = await advanceFlow(
        camp.flow, ch, p.contact_key, p.step_id, "quero", Date.now(),
        gravadorDeFluxo(db, canal as Json, p.contact_key),
      );
      if (r.enviados === 0 || r.falhas > 0) {
        await setClaimedFlowStatus(db, camp.id, p.contact_key, p.step_id, "failed");
        result.failed++;
        console.error("flow: PDF Embrapa falhou; revisão manual necessária", p.contact_key.slice(-4));
        continue;
      }
      await saveFlowPosition(db, camp.id, p.contact_key, r.position, {
        conversationId: p.conversation_id,
        channelId: String(canal.id),
      });
      result.sent++;
    } catch (error) {
      // Após iniciar o envio, o resultado pode ser incerto: não há retry automático.
      await setClaimedFlowStatus(
        db, camp.id, p.contact_key, p.step_id, sending ? "failed" : "deferred",
      );
      result.failed++;
      console.error("flow: PDF Embrapa adiado/falhou", p.contact_key.slice(-4), error);
    }
  }
  return result;
}
