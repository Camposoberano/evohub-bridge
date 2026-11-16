// flow-inbound — a resposta do lead continua o fluxo de onde parou.
//
// Chamado pelos DOIS webhooks: fluxo que saiu pela rota híbrida recebe a resposta pelo
// uazapi, o que saiu pelo oficial recebe pelo hub. Enquanto isso viveu só no webhook
// oficial, campanha híbrida ficava muda depois que o lead respondia.
//
// Reconciliado com o hub CECAPE (Fase 2 do port): além de continuar o fluxo, agora monta as
// variáveis do contato ({{nome}}, {{var}} capturadas) e os efeitos dos nós de lógica
// (Ação/API/Transfer), roteia o nó IA (Jev) e o texto livre, captura perguntas abertas (input),
// e encadeia o nó "Ir para fluxo" (goto). Tudo gated por env, default-off.
import { claimDelivery, type DbClient } from "./supabase.ts";
import { readCampaigns } from "./campaigns.ts";
import { escolherListener } from "./keyword-listeners.ts";
import { dentroDaJanela, PACE_PADRAO } from "./campaign-pace.ts";
import { EMBRAPA_5895_CAMPAIGN_ID, resolveEmbrapaOfferReply, shouldDeferEmbrapaPdf } from "./embrapa-offer-reply.ts";
import { getHybridRoute } from "./hybrid.ts";
import {
  advanceFlow,
  esperaVencida,
  type FlowChannel,
  type FlowEfeitos,
  runFlow,
  type RunResult,
} from "./flow-runner.ts";
import { type Flow, type FlowStep, matchOption, opcoesOrdenadas, proximoDe, stepById, varsDeInput } from "./flow.ts";
import { optionalEnv } from "./env.ts";
import { classificarComJev } from "./jev.ts";
import { chamarApiExterna } from "./flow-api.ts";
import { aplicarAcaoContato, atribuirTimeConversa, postarResumoConsultor, postarResumoQualificado } from "./flow-acao.ts";
import { capturarVarContato, normalizarValor } from "./flow-capture.ts";
import {
  carregarFluxoPublicado,
  gotoHabilitado,
  MAX_GOTO_HOPS,
  parseFlowRef,
} from "./flow-goto.ts";
import { gravadorDeFluxo } from "./flow-record.ts";
import { isBotMutedForContact } from "./bot-mute.ts";
import {
  cancelDeferredFlow,
  claimDeferredFlow,
  claimFlowStep,
  deferFlowStep,
  findDeferredFlowForContact,
  findDeferredFlows,
  findExpiredWaits,
  findWaitingFlow,
  findWaitingFlowPorVariante,
  flowRefDoContato,
  saveFlowPosition,
  setClaimedFlowStatus,
} from "./flow-state.ts";
import {
  type Bloqueio,
  bloqueioPorContato,
  motivoDoBloqueio,
} from "./gate-comercial.ts";
import { registrarPedidoHumano } from "./pedido-humano.ts";
import { assignConversation } from "./chatwoot.ts";
import { accountForChannel } from "./accounts.ts";
import { descreveErro } from "./erros.ts";

type Json = Record<string, unknown>;

/**
 * Pedido de humano disparado de dentro do fluxo (step com `pedirHumano`): pausa sem prazo,
 * alerta e atribui ao Cícero — o mesmo handoff do funil ramificado, mas a resposta da
 * campanha não passa por `handleMenuClick`, então é aqui que ele se repete. Nunca lança: é o
 * caminho da resposta do cliente, e derrubá-lo deixaria o lead mudo.
 */
async function executarHandoff(
  db: DbClient,
  channel: Json,
  from: string,
  conversationId: string | null,
  origem: "whatsapp" | "uazapi",
  contexto: Record<string, unknown> | undefined,
  campaignId: string,
): Promise<void> {
  try {
    let chatwootConversationId: number | null = null;
    if (conversationId) {
      const { data: conv } = await db.from("conversations")
        .select("chatwoot_conversation_id").eq("id", conversationId).maybeSingle();
      const cw = (conv as Json | null)?.chatwoot_conversation_id;
      chatwootConversationId = cw != null ? Number(cw) : null;
    }
    const pedido = await registrarPedidoHumano(db, {
      conversationId,
      channelId: String(channel.id),
      chatwootConversationId,
      origem,
      contato: from,
      contexto: { origem_fluxo: "campanha", campanha: campaignId, ...(contexto ?? {}) },
    });
    const assignee = Number(optionalEnv("CHATWOOT_ASSIGNEE_ID") ?? "0");
    if (pedido.registrado && assignee > 0 && chatwootConversationId) {
      await assignConversation(
        chatwootConversationId,
        assignee,
        await accountForChannel(String(channel.id)),
      );
    }
  } catch (e) {
    console.error("flow: handoff (pedido-humano) falhou", descreveErro(e).slice(0, 160));
  }
}

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
 * Variáveis do contato para interpolar `{{...}}` nos textos do fluxo: nome/primeiro_nome/telefone
 * + o que os nós `input` capturaram (contacts.attributes). Com `campaignId`, inclui o snapshot de
 * variáveis da campanha (campaign_contact_variables, Fase 3) — sem ele, nunca toca essa tabela.
 */
export async function varsDoContato(
  db: DbClient,
  channelId: string,
  contactKey: string,
  campaignId?: string,
): Promise<Record<string, string>> {
  try {
    let snapshot: Record<string, string> = {};
    if (campaignId) {
      // Snapshot é opcional: se a migration 0030 não foi aplicada (tabela ausente) ou não há linha
      // pra este contato, degrada pra sem-snapshot em vez de derrubar o disparo.
      try {
        const { data: stored } = await db.from("campaign_contact_variables")
          .select("variable_values").eq("campaign_id", campaignId)
          .eq("contact_key", contactKey).maybeSingle();
        if (stored?.variable_values && typeof stored.variable_values === "object") {
          snapshot = stored.variable_values as Record<string, string>;
        }
      } catch { /* tabela ausente / erro de leitura: segue sem snapshot */ }
    }
    const { data } = await db.from("contacts")
      .select("name,attributes")
      .eq("channel_id", channelId)
      .eq("external_contact_id", contactKey)
      .maybeSingle();
    const nome = ((data?.name as string | undefined) ?? "").trim();
    // Variáveis capturadas por nós `input` (ex.: {{cidade}}) ficam em contacts.attributes — traz
    // de volta pra os próximos {{var}} interpolarem. Só valores escalares viram string; objeto/array
    // em attributes é ignorado (nunca sai cru pro lead).
    const attrs: Record<string, string> = {};
    const raw = (data?.attributes as Record<string, unknown> | undefined) ?? {};
    for (const [k, v] of Object.entries(raw)) {
      if (v === null || v === undefined) continue;
      if (typeof v === "object") continue;
      attrs[k] = String(v);
    }
    return {
      ...attrs,
      ...snapshot,
      nome: snapshot.nome || nome,
      primeiro_nome: snapshot.primeiro_nome || nome.split(/\s+/)[0] || "",
      telefone: String(contactKey).replace(/\D/g, ""),
    };
  } catch {
    return {};
  }
}

/**
 * Monta os efeitos colaterais dos nós de lógica (Ação contato, Chamada API, Transferir) para este
 * contato. O runner é puro e chama estes callbacks quando passa por um nó desses. Falha é
 * best-effort: nenhum efeito pode derrubar a conversa.
 */
export function efeitosDoFluxo(
  db: DbClient,
  channel: Json,
  to: string,
  vars: Record<string, string>,
  conversationId?: string | null,
  flow?: Flow,
): FlowEfeitos {
  // Allowlist do resumo: só os campos que ESTE fluxo captura (nós input). Sem o fluxo em mãos, o
  // resumo cai no filtro de lixo de perfil. Evita a nota do consultor virar dump de attributes.
  const camposResumo = flow ? varsDeInput(flow) : undefined;
  return {
    onAction: (step: FlowStep) =>
      aplicarAcaoContato(db, channel, to, conversationId, step.contatoAcao ?? {}, vars),
    onApi: async (step: FlowStep) => {
      if (!step.api) return;
      const r = await chamarApiExterna(step.api, vars);
      console.log(
        "flow-api-call:",
        to.slice(-4),
        step.id,
        step.api.method ?? "POST",
        r.ok ? r.status : `falha(${r.motivo ?? r.status})`,
      );
    },
    onTransfer: async (step: FlowStep) => {
      if (step.transferTeamId) {
        await atribuirTimeConversa(db, channel, to, conversationId, step.transferTeamId);
      }
      // qualificarIA é superset do resumo (traz os dados + a temperatura do Jev) → não posta os dois.
      if (step.qualificarIA) {
        await postarResumoQualificado(db, channel, to, conversationId, vars, camposResumo);
      } else if (step.resumo) {
        await postarResumoConsultor(db, channel, to, conversationId, step.resumo, vars, camposResumo);
      }
    },
  };
}

// ── Ir para fluxo (goto) ───────────────────────────────────────────────────────────────────
// Tudo abaixo é no-op quando FLOW_GOTO_ENABLED != true: o fluxo ativo é sempre o da campanha e
// o flow_ref nunca é lido nem gravado. Liga só depois da migration 0018.

/**
 * Qual fluxo o contato está seguindo AGORA: o alvo de um goto (se `flowRef` setado e goto ligado)
 * ou o da campanha. Se o alvo sumiu/despublicou, cai no da campanha.
 */
async function resolverFluxoAtivo(
  db: DbClient,
  campFlow: Flow,
  flowRef: string | null,
): Promise<Flow> {
  if (gotoHabilitado() && flowRef) {
    const { flowId, version } = parseFlowRef(flowRef);
    const alvo = await carregarFluxoPublicado(db, flowId, version);
    if (alvo) return alvo.flow;
  }
  return campFlow;
}

/**
 * Depois de um `runFlow`/`advanceFlow`: se parou num goto, carrega o fluxo-alvo publicado e
 * continua nele, encadeando até `MAX_GOTO_HOPS`. Devolve a posição final + o flow_ref ativo.
 * No-op (devolve o resultado cru) quando o goto está desligado.
 */
async function continuarGotos(
  db: DbClient,
  channel: Json,
  to: string,
  resultado: RunResult,
  now: number,
  vars: Record<string, string>,
  flowRefAtual: string | null,
): Promise<{ resultado: RunResult; flowRef: string | null }> {
  let flowRef = flowRefAtual;
  if (!gotoHabilitado()) return { resultado, flowRef: null };
  let r = resultado;
  let enviados = resultado.enviados;
  let falhas = resultado.falhas;
  let hops = 0;
  while (r.gotoFlowId && hops < MAX_GOTO_HOPS) {
    const alvo = await carregarFluxoPublicado(db, r.gotoFlowId);
    if (!alvo) {
      console.warn("flow-goto: destino sem versão publicada:", r.gotoFlowId);
      break;
    }
    flowRef = alvo.ref;
    const ch = await flowChannelFor(db, channel);
    const efeitos = efeitosDoFluxo(db, channel, to, vars, null, alvo.flow);
    r = await runFlow(alvo.flow, ch, to, null, now, gravadorDeFluxo(db, channel, to), vars, efeitos);
    enviados += r.enviados;
    falhas += r.falhas;
    console.log("flow-goto: SALTOU", to.slice(-4), `-> ${alvo.ref} (enviados neste salto=${r.enviados}, total=${enviados})`);
    hops++;
  }
  if (r.gotoFlowId && hops >= MAX_GOTO_HOPS) {
    console.warn("flow-goto: limite de saltos atingido, encerrando:", to.slice(-4));
  }
  return { resultado: { ...r, enviados, falhas }, flowRef };
}

/** flow_ref do contato, só quando o goto está ligado (senão null, sem tocar o banco). */
async function flowRefAtivo(db: DbClient, campaignId: string, contact: string): Promise<string | null> {
  return gotoHabilitado() ? await flowRefDoContato(db, campaignId, contact) : null;
}

/**
 * Disparo inicial de um fluxo (fromStepId = null) que já segue eventuais gotos. Para o
 * campaign-queue e o start-fluxo. Devolve o resultado + o `flowRef` a gravar (undefined quando
 * o goto está desligado → a coluna nem é tocada).
 */
export async function dispararComGoto(
  db: DbClient,
  channel: Json,
  flow: Flow,
  ch: FlowChannel,
  to: string,
  now: number,
  onSent: ReturnType<typeof gravadorDeFluxo>,
  vars: Record<string, string>,
  efeitos: FlowEfeitos,
): Promise<{ result: RunResult; flowRefSalvar: string | null | undefined }> {
  const r0 = await runFlow(flow, ch, to, null, now, onSent, vars, efeitos);
  const { resultado: r, flowRef } = await continuarGotos(db, channel, to, r0, now, vars, null);
  return { result: r, flowRefSalvar: flowRefParaSalvar(r, flowRef) };
}

/** `extra.flowRef` pro saveFlowPosition: grava a ref (ou null ao terminar) só com goto ligado. */
function flowRefParaSalvar(resultado: RunResult, flowRef: string | null): string | null | undefined {
  if (!gotoHabilitado()) return undefined; // coluna não é tocada antes da migration
  return resultado.position.done ? null : flowRef;
}

/** Manda SÓ o 1º toque (um texto) — sem iniciar o fluxo. Usado no modo gatilho (SendPulse). */
export async function dispararPrimeiroToque(
  db: DbClient,
  channel: Json,
  ch: FlowChannel,
  to: string,
  texto: string,
  vars: Record<string, string>,
  now: number,
): Promise<boolean> {
  const toque: Flow = { steps: [{ id: "_toque", kind: "text", text: texto || "Olá!" }] };
  const onSent = gravadorDeFluxo(db, channel, to);
  const efeitos = efeitosDoFluxo(db, channel, to, vars, null);
  const r = await runFlow(toque, ch, to, null, now, onSent, vars, efeitos);
  return r.enviados > 0;
}

/**
 * Congela as variáveis de cada contato do Público numa campanha (migration 0030). O pump lê de
 * volta via varsDoContato(campaignId) pra interpolar {{coluna}}/{{coluna_N}} no fluxo. Best-effort:
 * falha (ex.: tabela ausente) não derruba o disparo — a campanha só não personaliza por coluna.
 */
export async function snapshotVariaveisDoPublico(
  db: DbClient,
  campaignId: string,
  audienceId: string,
  contactKeys: string[],
): Promise<number> {
  if (!audienceId || !contactKeys.length) return 0;
  try {
    const { data: aud } = await db.from("audiences")
      .select("name,schema_version,column_schema").eq("id", audienceId).maybeSingle();
    if (!aud) return 0;
    const schema = ((aud.column_schema as Array<{ key: string; ordinal: number; active?: boolean; legacy_title?: string | null }>) ?? [])
      .filter((c) => c.active !== false);
    const keySet = new Set(contactKeys.map((k) => String(k).replace(/\D/g, "")));
    const { data: contatos } = await db.from("audience_contacts")
      .select("phone,name,attributes").eq("audience_id", audienceId);
    const rows: Record<string, unknown>[] = [];
    for (const c of (contatos ?? []) as Array<{ phone: string; name: string | null; attributes: Record<string, unknown> | null }>) {
      const key = String(c.phone).replace(/\D/g, "");
      if (!keySet.has(key)) continue;
      const attrs = c.attributes ?? {};
      const nome = String(c.name ?? "").trim();
      const vars: Record<string, string> = {
        nome, primeiro_nome: nome.split(/\s+/)[0] ?? "", telefone: key,
      };
      for (const col of schema) {
        const val = String(attrs[col.key] ?? attrs[col.legacy_title ?? ""] ?? "");
        vars[col.key] = val;
        vars[`coluna_${col.ordinal}`] = val;
      }
      rows.push({
        campaign_id: campaignId, contact_key: key, audience_id: audienceId,
        audience_name: String(aud.name ?? ""), schema_version: Number(aud.schema_version ?? 1),
        variable_values: vars,
      });
    }
    if (!rows.length) return 0;
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from("campaign_contact_variables")
        .upsert(rows.slice(i, i + 500), { onConflict: "campaign_id,contact_key" });
      if (error) throw error;
    }
    return rows.length;
  } catch (e) {
    console.warn("snapshot-vars: falhou (segue sem personalização):", String(e).slice(0, 140));
    return 0;
  }
}

export { casaPalavra, normalizarTexto } from "./keyword-listeners.ts";

/**
 * Lead mandou mensagem e ela bate numa palavra-chave → INICIA o fluxo da campanha listener.
 * Chamado no webhook DEPOIS de continueFlowOnReply falhar (não havia fluxo em andamento). Gated
 * por FLOW_KEYWORD_ENABLED — off = no-op sem tocar o banco. `msgId` dedupa reentrega do webhook.
 * Retorna true se iniciou/consumiu.
 */
export async function iniciarFluxoPorPalavra(
  db: DbClient,
  channel: Json,
  from: string,
  texto: string,
  msgId?: string,
): Promise<boolean> {
  if (optionalEnv("FLOW_KEYWORD_ENABLED") !== "true") return false;
  const state = await readCampaigns();
  const camp = escolherListener(state.campaigns as Array<{ id: string; channelId?: string; flow?: unknown; keywords?: string[] }>, String(channel.id ?? ""), texto);
  if (!camp?.flow) return false;

  // Dedupe da reentrega do webhook: só a 1ª entrega do mesmo evento inicia.
  const chave = `flow-keyword-${channel.id}-${msgId ?? from}-${camp.id}`;
  if (!await claimDelivery(db, chave, "flow-keyword")) return true; // já tratado por outra entrega

  const ch = await flowChannelFor(db, channel);
  if (!ch) return false;
  const vars = await varsDoContato(db, String(channel.id), from);
  const onSent = gravadorDeFluxo(db, channel, from);
  const efeitos = efeitosDoFluxo(db, channel, from, vars, null, camp.flow as Flow);
  const now = Date.now();
  const { result: r, flowRefSalvar } = await dispararComGoto(
    db, channel, camp.flow as Flow, ch, from, now, onSent, vars, efeitos,
  );
  await saveFlowPosition(db, camp.id, from, r.position, {
    channelId: String(channel.id),
    flowRef: flowRefSalvar,
  });
  console.log("flow-keyword:", camp.id, String(channel.id), from.slice(-4), `"${texto.slice(0, 30)}" iniciou, enviados=${r.enviados} parou=${r.position.stepId ?? "fim"}`);
  return r.enviados > 0;
}

/**
 * Segue os fluxos cuja espera venceu.
 *
 * Sem isto o fluxo fica pendurado para sempre em quem não responde — e quem não responde é
 * a maioria: o funil mede de 19% a 79% de resposta por fase. O step declara `timeoutMin` e
 * `onTimeout`; `validateFlow` recusa um sem o outro, justamente para não existir espera sem saída.
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
    // Fluxo ativo: o alvo de um goto (se houver) ou o da campanha. Off → sempre camp.flow.
    const flowRef0 = await flowRefAtivo(db, p.campaign_id, p.contact_key);
    const fluxo = await resolverFluxoAtivo(db, camp.flow, flowRef0);
    const step = stepById(fluxo, p.step_id);
    if (!step) continue;
    if (!esperaVencida(step, p.waiting_since ?? undefined, now)) continue;
    if (!step.onTimeout) continue;

    const { data: canal } = await db.from("channels")
      .select(
        "id,type,name,phone_number,phone_number_id,chatwoot_inbox_id,chatwoot_inbox_identifier",
      )
      .eq("id", p.channel_id).maybeSingle();
    if (!canal) continue;

    // Clique/condução pelo atendente cala o bot: não dispara o timeout por cima.
    if (await isBotMutedForContact(db, String(canal.id), p.contact_key)) {
      resultado.bloqueados++;
      continue;
    }

    // Quem já comprou ou disse que não compra sai da cadeia AQUI também. Erro na consulta segura
    // a etapa em vez de soltar: não saber se o cliente comprou é motivo para não mandar.
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
      const vars = await varsDoContato(db, String(canal.id), p.contact_key);
      const efeitos = efeitosDoFluxo(db, canal as Json, p.contact_key, vars, p.conversation_id, fluxo);
      // segue direto pro destino do timeout, sem passar por resolveNext: o lead não
      // respondeu, então não há resposta para ramificar
      const r0 = await runFlow(
        fluxo,
        ch,
        p.contact_key,
        step.onTimeout,
        now,
        gravadorDeFluxo(db, canal as Json, p.contact_key),
        vars,
        efeitos,
      );
      const { resultado: r, flowRef } = await continuarGotos(db, canal as Json, p.contact_key, r0, now, vars, flowRef0);
      await saveFlowPosition(db, camp.id, p.contact_key, r.position, {
        conversationId: p.conversation_id,
        channelId: String(canal.id),
        flowRef: flowRefParaSalvar(r, flowRef),
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
 * Retoma os fluxos parados num nó `wait` cuja pausa (em minutos) já venceu.
 *
 * Diferente do timeout (que espera o lead responder uma PERGUNTA e segue `onTimeout`): aqui o
 * fluxo chegou a um `wait` de propósito — "espera 2 dias e manda o lembrete" — e ninguém
 * reagendava, então o nó ficava parado para sempre. Este sweeper é o que faltava.
 */
export async function pumpFlowWaits(
  db: DbClient,
  now = Date.now(),
): Promise<{ avaliados: number; seguiram: number; bloqueados: number }> {
  const resultado = { avaliados: 0, seguiram: 0, bloqueados: 0 };
  // minutosMin=0 traz todas as linhas em espera; o vencimento real é por nó logo abaixo.
  const pendentes = await findExpiredWaits(db, 0, 200, now);
  if (!pendentes.length) return resultado;

  const state = await readCampaigns();
  for (const p of pendentes) {
    if (!p.step_id) continue;
    const camp = state.campaigns.find((c) => c.id === p.campaign_id);
    if (!camp?.flow) continue;
    const flowRef0 = await flowRefAtivo(db, p.campaign_id, p.contact_key);
    const fluxo = await resolverFluxoAtivo(db, camp.flow, flowRef0);
    const step = stepById(fluxo, p.step_id);
    if (!step || step.kind !== "wait") continue; // só nós de pausa por tempo
    const desde = p.waiting_since ? Date.parse(p.waiting_since) : NaN;
    if (!Number.isFinite(desde)) continue;
    const venceEm = desde + (step.minutes ?? 0) * 60_000;
    if (now < venceEm) continue; // ainda pausado
    resultado.avaliados++;

    const destino = proximoDe(fluxo, step);
    const canalRes = await db.from("channels")
      .select(
        "id,type,name,phone_number,phone_number_id,chatwoot_inbox_id,chatwoot_inbox_identifier,external_id",
      )
      .eq("id", p.channel_id).maybeSingle();
    const canal = canalRes.data;
    if (!canal) continue;

    // Reserva o passo: o webhook (lead respondeu durante a pausa) não pode processar junto.
    if (!await claimFlowStep(db, p.campaign_id, p.contact_key, p.step_id)) continue;

    // Mesma trava comercial do timeout: quem comprou/recusou não recebe a continuação.
    let bloqueio: Bloqueio | null = null;
    try {
      bloqueio = await bloqueioPorContato(db, String(canal.id), p.contact_key);
    } catch (e) {
      resultado.bloqueados++;
      console.error("flow-wait: etiqueta não conferida, segurado:", p.contact_key.slice(-4), e);
      await saveFlowPosition(db, p.campaign_id, p.contact_key, {
        stepId: p.step_id,
        waitingSince: p.waiting_since ?? new Date(now).toISOString(),
      }, { conversationId: p.conversation_id, channelId: String(canal.id) });
      continue;
    }
    if (bloqueio) {
      resultado.bloqueados++;
      await encerrarFluxoPorDesfecho(db, p, canal as Json, bloqueio);
      continue;
    }

    try {
      if (!destino) {
        // `wait` era o último passo: nada depois, encerra.
        await saveFlowPosition(db, p.campaign_id, p.contact_key, { stepId: null, done: true }, {
          conversationId: p.conversation_id,
          channelId: String(canal.id),
        });
        resultado.seguiram++;
        continue;
      }
      const ch = await flowChannelFor(db, canal as Json);
      const vars = await varsDoContato(db, String(canal.id), p.contact_key);
      const efeitos = efeitosDoFluxo(db, canal as Json, p.contact_key, vars, p.conversation_id, fluxo);
      const r0 = await runFlow(
        fluxo,
        ch,
        p.contact_key,
        destino,
        now,
        gravadorDeFluxo(db, canal as Json, p.contact_key),
        vars,
        efeitos,
      );
      const { resultado: r, flowRef } = await continuarGotos(db, canal as Json, p.contact_key, r0, now, vars, flowRef0);
      await saveFlowPosition(db, camp.id, p.contact_key, r.position, {
        conversationId: p.conversation_id,
        channelId: String(canal.id),
        flowRef: flowRefParaSalvar(r, flowRef),
      });
      resultado.seguiram++;
      console.log("flow-wait:", camp.id, p.contact_key.slice(-4), `${p.step_id} -> ${r.position.stepId ?? "fim"}`);
    } catch (e) {
      console.error("flow-wait erro, devolvendo à espera:", p.contact_key.slice(-4), e);
      await saveFlowPosition(db, p.campaign_id, p.contact_key, {
        stepId: p.step_id,
        waitingSince: p.waiting_since ?? new Date(now).toISOString(),
      }, { conversationId: p.conversation_id, channelId: String(canal.id) });
    }
  }
  return resultado;
}

/**
 * Continua o fluxo se este contato estiver esperando em algum.
 *
 * Devolve `true` quando consumiu a mensagem — o webhook deve parar aí e não rodar as
 * respostas automáticas de intenção. O lead que está no meio de um fluxo respondeu à
 * pergunta do fluxo; disparar a tabela de preço por cima seria duas mensagens ao mesmo tempo.
 *
 * `replyId` é o id do botão/linha clicada, ou null para texto livre (que segue por `fallbackNext`).
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
    // Passa o canal: só continua o fluxo que pertence a ESTE canal (a resposta chegou por ele).
    estado = await findWaitingFlow(db, from, String(channel.id));
    // 9º dígito (gated): a espera pode estar gravada com o 9 (13) e a resposta chegar sem (12) —
    // mesmo celular. Só casa quando é inequívoco. Ao casar, REESCREVE `from` para a chave do fluxo.
    if (!estado?.step_id && optionalEnv("FLOW_NINTH_DIGIT_MATCH") === "true") {
      const variante = await findWaitingFlowPorVariante(db, from, String(channel.id));
      if (variante?.step_id) {
        console.log("flow-9dig:", from.slice(-4), "->", String(variante.contact_key).slice(-4));
        estado = variante;
        from = variante.contact_key;
      }
    }
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

  // Um clique enquanto o atendente conduz a conversa não consome a posição do fluxo.
  if (await isBotMutedForContact(db, String(channel.id), from)) return true;

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

  // Resolução EMBRAPA/5895 (agro): decide se a resposta libera o PDF ou preserva a espera.
  // Pra outras campanhas, branchReplyId = replyId (passa reto).
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

  // Reserva o passo antes de enviar qualquer coisa: o UPDATE exige `status='waiting'`, então só
  // uma resposta casa a condição. A que perder recebe zero linhas e sai sem enviar nada.
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
    if (await isBotMutedForContact(db, String(channel.id), from)) {
      await saveFlowPosition(db, camp.id, from, {
        stepId: passo,
        waitingSince: estado.waiting_since ?? new Date().toISOString(),
      }, extra);
      return true;
    }
    const vars = await varsDoContato(db, String(channel.id), from, camp.id);
    // Fluxo ativo: se o contato saltou pra outro fluxo (goto), a resposta é resolvida contra o
    // fluxo-alvo. Off → sempre camp.flow.
    const flowRef0 = await flowRefAtivo(db, estado.campaign_id, from);
    const fluxo = await resolverFluxoAtivo(db, camp.flow, flowRef0);
    // Começa do branchReplyId (resolvido pela regra EMBRAPA; = replyId nas outras campanhas).
    let replyParaAvancar = branchReplyId;
    const passoStep = stepById(fluxo, passo);
    // Nó Agente IA: a resposta livre é classificada pelo Jev numa das opções. Confiança baixa
    // (ou erro/sem chave) → ramo `fallback` (tipicamente Transferir humano).
    if (passoStep?.kind === "ai") {
      const { choice, confidence } = await classificarComJev(String(replyId ?? ""), passoStep.ai ?? {});
      const min = passoStep.ai?.minConfianca ?? 0.6;
      replyParaAvancar = (choice && confidence >= min) ? choice : "fallback";
      console.log("flow-ai:", from.slice(-4), `"${String(replyId ?? "").slice(0, 40)}" -> ${choice ?? "—"}(${confidence.toFixed(2)}) => ${replyParaAvancar}`);
    }
    // Nó de botões/lista: o lead DIGITOU em vez de clicar. resolveNext já casa por id/título/número;
    // se NÃO casou e FLOW_FREETEXT_JEV_ENABLED=true, o Jev classifica o texto na opção mais provável.
    if (
      (passoStep?.kind === "buttons" || passoStep?.kind === "list") &&
      replyParaAvancar != null &&
      optionalEnv("FLOW_FREETEXT_JEV_ENABLED") === "true" &&
      !matchOption(passoStep, String(replyParaAvancar))
    ) {
      const opcoes = opcoesOrdenadas(passoStep).map((o) => ({ id: o.id, titulo: o.title }));
      if (opcoes.length) {
        const { choice, confidence } = await classificarComJev(
          String(replyParaAvancar),
          { opcoes, instrucao: "Qual destas opções o cliente escolheu na mensagem dele?" },
        );
        const min = Number(optionalEnv("FLOW_FREETEXT_JEV_MIN") ?? "0.6");
        if (choice && confidence >= min) {
          console.log("flow-freetext:", from.slice(-4), `"${String(replyParaAvancar).slice(0, 40)}" -> ${choice}(${confidence.toFixed(2)})`);
          replyParaAvancar = choice;
        }
      }
    }
    // Nó pergunta aberta (input): guarda a resposta livre na variável e grava no contato (durável).
    // Não ramifica — segue por fallbackNext/next.
    if (passoStep?.kind === "input" && passoStep.input?.var) {
      const valor = normalizarValor(String(replyId ?? ""), passoStep.input.tipo);
      vars[passoStep.input.var] = valor; // disponível já pros steps deste mesmo run
      await capturarVarContato(db, String(channel.id), from, passoStep.input, valor);
      replyParaAvancar = null; // texto livre → resolveNext usa fallbackNext ?? next
      console.log("flow-input:", from.slice(-4), `${passoStep.input.var}="${valor.slice(0, 40)}"`);
    }
    const agora = Date.now();
    const efeitos = efeitosDoFluxo(db, channel, from, vars, estado.conversation_id, fluxo);
    // Defer EMBRAPA/5895 (agro): a consulta de rota pode atravessar as 20h; última checagem antes do envio.
    if (shouldDeferEmbrapaPdf({
      campaignId: camp.id, stepId: passo, branchReplyId,
      pace: camp.pace, now: agora,
    })) {
      await deferFlowStep(db, camp.id, from, passo, String(channel.id));
      return true;
    }
    const r0 = await advanceFlow(
      fluxo,
      ch,
      from,
      passo,
      replyParaAvancar,
      agora,
      gravadorDeFluxo(db, channel, from),
      vars,
      efeitos,
    );
    const { resultado: r, flowRef } = await continuarGotos(db, channel, from, r0, agora, vars, flowRef0);
    await saveFlowPosition(db, camp.id, from, r.position, { ...extra, flowRef: flowRefParaSalvar(r, flowRef) });
    console.log(
      "flow:",
      camp.id,
      from.slice(-4),
      `${passo} -> ${r.position.stepId ?? "fim"}`,
      `enviados=${r.enviados} falhas=${r.falhas}`,
    );
    if (r.pedirHumano) {
      await executarHandoff(
        db,
        channel,
        from,
        estado.conversation_id,
        ch.route ? "uazapi" : "whatsapp",
        r.handoffContexto,
        camp.id,
      );
    }
  } catch (e) {
    // Sem isto o estado ficaria em `processing` para sempre. Devolve para a espera, onde a
    // próxima resposta ou o timeout o alcançam.
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
