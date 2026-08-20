// campaign — motor de campanha gated (oficial). action:
//   status  -> lista campanhas + contagem por estado
//   start   -> dispara template oficial pra lista; cada número fica "awaiting"
// O "resume" (resposta -> sequência) é no hub-webhook. Auth: JWT do dashboard.
import { admin } from "../shared/supabase.ts";
import { env } from "../shared/env.ts";
import { sendMeta } from "../shared/hub.ts";
import {
  getDirectUazapiRoute,
  getHybridRoute,
  hybridSendMenu,
  isHybridRecipient,
} from "../shared/hybrid.ts";
import type { HybridMenuButton } from "../shared/hybrid-menu.ts";
import { checarProntidao } from "../shared/hybrid-extra.ts";
import { type Flow, validateFlow } from "../shared/flow.ts";
import { type FlowChannel, runFlow } from "../shared/flow-runner.ts";
import { gravadorDeFluxo } from "../shared/flow-record.ts";
import { saveFlowPosition } from "../shared/flow-state.ts";
import { PACE_PADRAO, type PaceConfig } from "../shared/campaign-pace.ts";
import {
  cancelarCampanha,
  enfileirar,
  pausarCampanha,
  resumoDaFila,
  retomarCampanha,
} from "../shared/campaign-queue.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type Campaign,
  numKey,
  readCampaigns,
  type Step,
  writeCampaigns,
} from "../shared/campaigns.ts";

type Json = Record<string, unknown>;

const SEND_CONCURRENCY = 5;
const SEND_TIMEOUT_MS = 25_000;
/**
 * Teto por chamada. `start` é síncrono — a resposta só volta quando o último envio termina —
 * então lista grande com ritmo humano não caberia no tempo de uma request. Mais importante:
 * mandar milhares de templates frios de uma vez é o jeito mais rápido de perder o número.
 * Lista maior deve ser fatiada em lotes, com o intervalo entre lotes decidido por quem
 * dispara, olhando a nota de qualidade entre um e outro.
 */
const MAX_POR_CHAMADA = 200;

type WaChannel = {
  id: string;
  name: string;
  phone_number_id: string;
  phone_number: string | null;
  display_name: string | null;
  status: string;
};

async function resolveWhatsAppChannel(
  channelId?: string,
): Promise<WaChannel | null> {
  const db = admin();
  const cols = "id,name,phone_number_id,phone_number,display_name,status";
  if (channelId) {
    const { data: ch } = await db.from("channels").select(cols)
      .eq("id", channelId).eq("type", "whatsapp").maybeSingle();
    return ch?.phone_number_id ? ch as WaChannel : null;
  }
  const { data: active } = await db.from("channels").select(cols)
    .eq("type", "whatsapp").eq("status", "active").not(
      "phone_number_id",
      "is",
      null,
    )
    .order("connected_at", { ascending: false }).limit(1).maybeSingle();
  if (active) return active as WaChannel;
  const { data: any } = await db.from("channels").select(cols)
    .eq("type", "whatsapp").not("phone_number_id", "is", null)
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  return any?.phone_number_id ? any as WaChannel : null;
}

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const uc = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: {
      headers: { Authorization: req.headers.get("Authorization") ?? "" },
    },
    auth: { persistSession: false },
  });
  if (!(await uc.auth.getUser()).data?.user) {
    return json({ error: "unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({})) as Json;
  const action = body.action as string;
  const state = await readCampaigns();

  if (action === "status") {
    const counts: Record<
      string,
      { awaiting: number; active: number; done: number }
    > = {};
    for (const t of Object.values(state.targets)) {
      counts[t.campaignId] = counts[t.campaignId] ??
        { awaiting: 0, active: 0, done: 0 };
      counts[t.campaignId][t.status]++;
    }
    const official = await resolveWhatsAppChannel();
    return json({
      campaigns: state.campaigns,
      counts,
      officialChannel: official,
    });
  }

  if (action === "start") {
    const numbers = [
      ...new Set(
        ((body.numbers ?? []) as string[]).map(numKey).filter((d) =>
          d.length >= 12
        ),
      ),
    ];
    const template = body.template as string;
    const language = (body.language as string) ?? "pt_BR";
    if (!template || numbers.length === 0) {
      return json({ error: "template e numbers obrigatórios" }, 400);
    }
    if (numbers.length > MAX_POR_CHAMADA) {
      return json({
        error:
          `${numbers.length} números numa chamada só; o teto é ${MAX_POR_CHAMADA}`,
        motivo:
          "start é síncrono e disparo frio precisa de ritmo — fatie em lotes e confira a nota de qualidade entre eles",
      }, 400);
    }

    const ch = await resolveWhatsAppChannel(
      body.channel_id as string | undefined,
    );
    if (!ch?.phone_number_id) {
      return json({
        error:
          "nenhum canal WhatsApp oficial ativo com phone_number_id — conecte em /conexoes",
      }, 404);
    }
    const { data: secret } = await admin().from("channel_secrets").select(
      "channel_token",
    ).eq("channel_id", ch.id).maybeSingle();
    const token = secret?.channel_token as string | undefined;
    if (!token) return json({ error: "canal sem token" }, 404);

    const camp: Campaign = {
      id: "camp_" + new Date().toISOString().replace(/\D/g, "").slice(0, 14),
      name: (body.name as string) ?? template,
      template,
      language,
      steps: (body.steps as Step[]) ?? [],
      delayMin: Number(body.delayMin ?? 1),
      delayMax: Number(body.delayMax ?? 3),
      createdAt: new Date().toISOString(),
    };
    state.campaigns.push(camp);

    // componentes do template: header de mídia (imagem/vídeo/documento) se informado.
    let components = (body.components as Json[]) ?? [];
    const hm = body.headerMedia as Json | undefined; // { format:"image"|"video"|"document", link }
    if (hm?.link && hm?.format) {
      const fmt = String(hm.format).toLowerCase();
      components = [{
        type: "header",
        parameters: [{ type: fmt, [fmt]: { link: hm.link } }],
      }, ...components];
    }

    const metaPath = `${ch.phone_number_id}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      type: "template",
      template: { name: template, language: { code: language }, components },
    };

    // Ritmo. delayMin/delayMax já existiam no tipo e eram aceitos no body, mas só o caminho
    // uazapi os usava (handlers/uazapi.ts) — no oficial a lista saía em rajada, 5 concorrentes
    // sem pausa nenhuma. Intervalo ALEATÓRIO entre os dois: cadência exata é assinatura de
    // robô, e é o padrão que a Meta pune antes mesmo de haver denúncia.
    //
    // Com delay, o envio vira sequencial: manter concorrência 5 faria o intervalo controlar
    // cada worker isoladamente e o ritmo real seria 5× o pedido — exatamente o engano que o
    // parâmetro deveria evitar.
    const comRitmo = camp.delayMin > 0 || camp.delayMax > 0;
    const concorrencia = comRitmo ? 1 : SEND_CONCURRENCY;
    const espera = () => {
      const min = Math.max(0, camp.delayMin) * 1000;
      const max = Math.max(min, camp.delayMax * 1000);
      return new Promise<void>((r) =>
        setTimeout(r, min + Math.random() * (max - min))
      );
    };

    let sent = 0, failed = 0;
    const errors: string[] = [];
    let primeiro = true;
    await mapPool(numbers, concorrencia, async (to) => {
      if (comRitmo && !primeiro) await espera();
      primeiro = false;
      const r = await sendMetaWithTimeout(token, metaPath, { ...payload, to });
      if (r.ok) {
        sent++;
        state.targets[to] = {
          campaignId: camp.id,
          status: "awaiting",
          step: 0,
          ts: new Date().toISOString(),
        };
      } else {
        failed++;
        if (errors.length < 3) {
          const detail = (r.data as Json)?.error ?? r.data;
          errors.push(
            r.timedOut ? "timeout" : JSON.stringify(detail).slice(0, 120),
          );
        }
      }
    });

    try {
      await writeCampaigns(state);
    } catch (e) {
      return json({
        error: String(e),
        campaign: camp.id,
        sent,
        failed,
        partial: true,
      }, 500);
    }
    return json({
      ok: true,
      campaign: camp.id,
      sent,
      failed,
      total: numbers.length,
      awaiting: sent,
      errors,
      ritmo: comRitmo
        ? `sequencial, ${camp.delayMin}-${camp.delayMax}s entre envios`
        : `${SEND_CONCURRENCY} em paralelo, sem intervalo (passe delayMin/delayMax para dar ritmo)`,
      channel: {
        id: ch.id,
        name: ch.name,
        phone_number: ch.phone_number,
        display_name: ch.display_name,
      },
    });
  }

  // Disparo INTERATIVO pela rota híbrida: imagem + texto + botões numa mensagem só, pelo
  // uazapi. Diferente do `start`, que manda template aprovado e é limitado ao que a Meta
  // deixa passar — aqui os botões são nativos e o conteúdo é livre.
  //
  // O template continua existindo como REDE: se a rota híbrida não estiver disponível ou o
  // envio falhar, cai no oficial. Sem `template` no body, número sem rota é só pulado —
  // melhor não falar do que falar por um caminho que o dono da conversa não escolheu.
  //
  // A resposta do lead volta pelo webhook do uazapi, que agora também chama resumeCampaign.
  if (action === "start-interativo") {
    const numbers = [
      ...new Set(
        ((body.numbers ?? []) as string[]).map(numKey).filter((d) =>
          d.length >= 12
        ),
      ),
    ];
    const text = String(body.text ?? "").trim();
    const buttons = (body.buttons ?? []) as HybridMenuButton[];
    if (!text || !numbers.length) {
      return json({ error: "text e numbers obrigatórios" }, 400);
    }
    if (numbers.length > MAX_POR_CHAMADA) {
      return json({
        error:
          `${numbers.length} números numa chamada só; o teto é ${MAX_POR_CHAMADA}`,
      }, 400);
    }

    const ch = await resolveWhatsAppChannel(
      body.channel_id as string | undefined,
    );
    if (!ch) return json({ error: "canal WhatsApp não encontrado" }, 404);

    // Instância explícita pula a exigência de coexistência (mesmo número no oficial e no
    // uazapi) — é como se dispara por um número que só existe do lado não-oficial.
    const instancia = body.instance as string | undefined;
    const route = instancia
      ? await getDirectUazapiRoute(ch.id, instancia)
      : await getHybridRoute(ch.id, ch.phone_number_id, ch.phone_number ?? "");

    const template = body.template as string | undefined;
    const language = (body.language as string) ?? "pt_BR";
    const imageUrl = body.imageUrl as string | undefined;
    if (!route && !template) {
      return json({
        error:
          "sem rota híbrida disponível e sem template de fallback — informe `instance` ou `template`",
      }, 404);
    }

    const { data: secret } = await admin().from("channel_secrets")
      .select("channel_token").eq("channel_id", ch.id).maybeSingle();
    const token = secret?.channel_token as string | undefined;

    const camp: Campaign = {
      id: "camp_" + new Date().toISOString().replace(/\D/g, "").slice(0, 14),
      name: (body.name as string) ?? "interativo",
      template: template ?? "(interativo)",
      language,
      steps: (body.steps as Step[]) ?? [],
      delayMin: Number(body.delayMin ?? 3),
      delayMax: Number(body.delayMax ?? 8),
      createdAt: new Date().toISOString(),
    };
    state.campaigns.push(camp);

    const espera = () => {
      const min = Math.max(0, camp.delayMin) * 1000;
      const max = Math.max(min, camp.delayMax * 1000);
      return new Promise<void>((r) =>
        setTimeout(r, min + Math.random() * (max - min))
      );
    };

    let porUazapi = 0, porTemplate = 0, failed = 0, pulados = 0;
    const errors: string[] = [];
    let primeiro = true;
    for (const to of numbers) {
      if (!primeiro) await espera();
      primeiro = false;

      let enviado = false;
      if (route && isHybridRecipient(to)) {
        const r = await hybridSendMenu(route, to, text, buttons, imageUrl);
        if (r?.ok) {
          porUazapi++;
          enviado = true;
        }
      }
      if (!enviado && template && token && ch.phone_number_id) {
        const r = await sendMetaWithTimeout(
          token,
          `${ch.phone_number_id}/messages`,
          {
            messaging_product: "whatsapp",
            to,
            type: "template",
            template: { name: template, language: { code: language } },
          },
        );
        if (r.ok) {
          porTemplate++;
          enviado = true;
        } else if (errors.length < 3) {
          errors.push(
            JSON.stringify((r.data as Json)?.error ?? r.data).slice(0, 120),
          );
        }
      }

      if (enviado) {
        state.targets[to] = {
          campaignId: camp.id,
          status: "awaiting",
          step: 0,
          ts: new Date().toISOString(),
        };
      } else if (!route && !template) pulados++;
      else failed++;
    }

    try {
      await writeCampaigns(state);
    } catch (e) {
      return json({
        error: String(e),
        campaign: camp.id,
        porUazapi,
        porTemplate,
        partial: true,
      }, 500);
    }
    return json({
      ok: true,
      campaign: camp.id,
      total: numbers.length,
      porUazapi,
      porTemplate,
      failed,
      pulados,
      errors,
      rota: route
        ? `uazapi (${route.instance})${template ? " com template de rede" : ""}`
        : "só template oficial — nenhuma rota híbrida disponível",
      ritmo: `${camp.delayMin}-${camp.delayMax}s entre envios`,
      channel: { id: ch.id, name: ch.name, phone_number: ch.phone_number },
    });
  }

  // Dispara um FLUXO conversacional: manda até a primeira pergunta e guarda onde parou.
  // A partir daí quem conduz é o motor — a resposta do lead chega no webhook, que continua
  // de onde ficou (shared/flow-inbound.ts).
  //
  // Diferente de `start` e `start-interativo`, que mandam uma mensagem e encerram.
  if (action === "start-fluxo") {
    const flow = body.flow as Flow | undefined;
    const numbers = [
      ...new Set(
        ((body.numbers ?? []) as string[]).map(numKey).filter((d) =>
          d.length >= 12
        ),
      ),
    ];
    if (!flow?.steps?.length || !numbers.length) {
      return json({ error: "flow e numbers obrigatórios" }, 400);
    }
    if (numbers.length > MAX_POR_CHAMADA) {
      return json({
        error:
          `${numbers.length} números; o teto por chamada é ${MAX_POR_CHAMADA}`,
      }, 400);
    }

    // Valida ANTES de falar com qualquer um: fluxo com ciclo sem pergunta mandaria mensagem
    // sem parar, e um destino órfão deixaria o lead num beco. Melhor recusar aqui do que
    // descobrir no meio da lista.
    const problemas = validateFlow(flow);
    if (problemas.length) {
      return json({ error: "fluxo inválido", problemas }, 400);
    }

    const ch = await resolveWhatsAppChannel(
      body.channel_id as string | undefined,
    );
    if (!ch) return json({ error: "canal WhatsApp não encontrado" }, 404);

    const instancia = body.instance as string | undefined;
    const route = instancia
      ? await getDirectUazapiRoute(ch.id, instancia)
      : await getHybridRoute(ch.id, ch.phone_number_id, ch.phone_number ?? "");

    // Instância desconectada ou conta sem permissão de iniciar conversa derrubaria o
    // disparo no meio, com parte da lista já queimada. Conferir custa duas chamadas.
    if (route) {
      const prontidao = await checarProntidao(route);
      if (!prontidao.pronta) {
        return json({
          error: "instância não está pronta para disparar",
          status: prontidao.status,
          motivo: prontidao.motivo,
          podeIniciarConversa: prontidao.podeIniciarConversa,
        }, 409);
      }
    }

    const { data: secret } = await admin().from("channel_secrets")
      .select("channel_token").eq("channel_id", ch.id).maybeSingle();
    const flowCh: FlowChannel = {
      route,
      token: secret?.channel_token as string | undefined,
      phoneNumberId: ch.phone_number_id,
    };
    if (!flowCh.route && !(flowCh.token && flowCh.phoneNumberId)) {
      return json(
        { error: "nenhuma rota de envio disponível para este canal" },
        404,
      );
    }

    const camp: Campaign = {
      id: "camp_" + new Date().toISOString().replace(/\D/g, "").slice(0, 14),
      name: (body.name as string) ?? "fluxo",
      template: "(fluxo)",
      language: (body.language as string) ?? "pt_BR",
      steps: [],
      flow,
      delayMin: Number(body.delayMin ?? 3),
      delayMax: Number(body.delayMax ?? 8),
      createdAt: new Date().toISOString(),
    };
    state.campaigns.push(camp);
    // Grava a campanha ANTES de disparar: se o lead responder rápido, o webhook precisa
    // achar o fluxo. Salvar depois abriria uma janela em que a resposta chega e não há
    // campanha para consultar.
    await writeCampaigns(state);

    const espera = () => {
      const min = Math.max(0, camp.delayMin) * 1000;
      const max = Math.max(min, camp.delayMax * 1000);
      return new Promise<void>((r) =>
        setTimeout(r, min + Math.random() * (max - min))
      );
    };

    let iniciados = 0, falhas = 0, emEspera = 0;
    let primeiro = true;
    for (const to of numbers) {
      if (!primeiro) await espera();
      primeiro = false;
      try {
        const r = await runFlow(
          flow,
          flowCh,
          to,
          null,
          Date.now(),
          gravadorDeFluxo(
            admin(),
            ch as unknown as Record<string, unknown>,
            to,
          ),
        );
        if (r.enviados > 0) iniciados++;
        else falhas++;
        if (r.position.stepId) emEspera++;
        await saveFlowPosition(admin(), camp.id, to, r.position, {
          channelId: ch.id,
        });
      } catch (e) {
        falhas++;
        console.error("start-fluxo:", to.slice(-4), String(e).slice(0, 150));
      }
    }

    return json({
      ok: true,
      campaign: camp.id,
      total: numbers.length,
      iniciados,
      falhas,
      aguardandoResposta: emEspera,
      rota: route ? `uazapi (${route.instance})` : "oficial (Meta)",
      ritmo: `${camp.delayMin}-${camp.delayMax}s entre contatos`,
      channel: { id: ch.id, name: ch.name, phone_number: ch.phone_number },
    });
  }

  // Enfileira em vez de disparar: o loop consome no ritmo da rampa (por padrão 50 no
  // primeiro dia, +15 por dia, teto 200, das 8h às 22h). É o caminho para lista grande —
  // `start-fluxo` é síncrono e não aguenta horas numa request.
  if (action === "agendar-fluxo") {
    const flow = body.flow as Flow | undefined;
    const numbers = ((body.numbers ?? []) as string[]).map(numKey)
      .filter((d) => d.length >= 12);
    if (!flow?.steps?.length || !numbers.length) {
      return json({ error: "flow e numbers obrigatórios" }, 400);
    }
    const problemas = validateFlow(flow);
    if (problemas.length) {
      return json({ error: "fluxo inválido", problemas }, 400);
    }

    const ch = await resolveWhatsAppChannel(
      body.channel_id as string | undefined,
    );
    if (!ch) return json({ error: "canal WhatsApp não encontrado" }, 404);

    const camp: Campaign = {
      id: "camp_" + new Date().toISOString().replace(/\D/g, "").slice(0, 14),
      name: (body.name as string) ?? "fluxo-agendado",
      template: "(fluxo)",
      language: (body.language as string) ?? "pt_BR",
      steps: [],
      flow,
      pace: (body.pace as Partial<PaceConfig>) ?? undefined,
      delayMin: 0,
      delayMax: 0,
      createdAt: new Date().toISOString(),
    };
    state.campaigns.push(camp);
    // Grava a campanha antes de enfileirar: o loop roda a cada minuto e precisa achar o
    // fluxo assim que o primeiro item aparecer na fila.
    await writeCampaigns(state);

    const enfileirados = await enfileirar(admin(), camp.id, numbers, ch.id);
    const cfg = { ...PACE_PADRAO, ...(camp.pace ?? {}) };
    return json({
      ok: true,
      campaign: camp.id,
      enfileirados,
      ritmo: {
        primeiro_dia: cfg.capInicial,
        incremento_diario: cfg.capIncremento,
        teto: cfg.capMaximo,
        janela: `${cfg.horaInicio}h-${cfg.horaFim}h BRT`,
      },
      channel: { id: ch.id, name: ch.name, phone_number: ch.phone_number },
      aviso:
        "começa a sair no próximo tick do loop (1min), se dentro da janela",
    });
  }

  // Controle da campanha agendada pelo painel. Só mexe em quem ainda NÃO recebeu — o que já
  // saiu não tem volta, e o número de enviados precisa continuar confiável.
  if (
    action === "pausar-campanha" || action === "retomar-campanha" ||
    action === "cancelar-campanha"
  ) {
    const campaignId = String(body.campaign ?? "").trim();
    if (!campaignId) return json({ error: "campaign obrigatório" }, 400);

    const afetados = action === "pausar-campanha"
      ? await pausarCampanha(admin(), campaignId)
      : action === "retomar-campanha"
      ? await retomarCampanha(admin(), campaignId)
      : await cancelarCampanha(admin(), campaignId);

    console.log(
      "campaign-queue:",
      action,
      campaignId,
      `${afetados} contato(s)`,
    );
    return json({
      ok: true,
      action,
      campaign: campaignId,
      afetados,
      ...await resumoDaFila(admin(), campaignId),
    });
  }

  // Acompanhar uma campanha agendada.
  if (action === "fila") {
    const campaignId = String(body.campaign ?? "").trim();
    if (!campaignId) return json({ error: "campaign obrigatório" }, 400);
    return json({
      campaign: campaignId,
      ...await resumoDaFila(admin(), campaignId),
    });
  }

  return json({ error: "ação desconhecida: " + action }, 400);
}

async function sendMetaWithTimeout(
  channelToken: string,
  path: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; data: unknown; timedOut?: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<
    { ok: false; status: 0; data: { error: string }; timedOut: true }
  >((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          ok: false,
          status: 0,
          data: { error: "timeout" },
          timedOut: true,
        }),
      SEND_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([sendMeta(channelToken, path, body), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (queue.length > 0) {
        const item = queue.shift()!;
        await fn(item);
      }
    },
  );
  await Promise.all(workers);
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
