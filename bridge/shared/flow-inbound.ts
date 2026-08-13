// flow-inbound — a resposta do lead continua o fluxo de onde parou.
//
// Chamado pelos DOIS webhooks: fluxo que saiu pela rota híbrida recebe a resposta pelo
// uazapi, o que saiu pelo oficial recebe pelo hub. Enquanto isso viveu só no webhook
// oficial, campanha híbrida ficava muda depois que o lead respondia.
import type { DbClient } from "./supabase.ts";
import { readCampaigns } from "./campaigns.ts";
import { getHybridRoute } from "./hybrid.ts";
import {
  advanceFlow,
  esperaVencida,
  type FlowChannel,
  runFlow,
} from "./flow-runner.ts";
import { stepById } from "./flow.ts";
import {
  findExpiredWaits,
  findWaitingFlow,
  saveFlowPosition,
} from "./flow-state.ts";

type Json = Record<string, unknown>;

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
): Promise<{ avaliados: number; seguiram: number }> {
  const resultado = { avaliados: 0, seguiram: 0 };
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
      .select("id,phone_number,phone_number_id")
      .eq("id", p.channel_id).maybeSingle();
    if (!canal) continue;

    try {
      const ch = await flowChannelFor(db, canal as Json);
      // segue direto pro destino do timeout, sem passar por resolveNext: o lead não
      // respondeu, então não há resposta para ramificar
      const r = await runFlow(camp.flow, ch, p.contact_key, step.onTimeout, now);
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
): Promise<boolean> {
  let estado;
  try {
    estado = await findWaitingFlow(db, from);
  } catch (e) {
    console.error("flow-inbound: consulta de estado falhou:", e);
    return false;
  }
  if (!estado?.step_id) return false;

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

  const ch = await flowChannelFor(db, channel);
  const r = await advanceFlow(camp.flow, ch, from, estado.step_id, replyId);
  await saveFlowPosition(db, camp.id, from, r.position, {
    conversationId: estado.conversation_id,
    channelId: String(channel.id),
  });
  console.log(
    "flow:",
    camp.id,
    from.slice(-4),
    `${estado.step_id} -> ${r.position.stepId ?? "fim"}`,
    `enviados=${r.enviados} falhas=${r.falhas}`,
  );
  return true;
}
