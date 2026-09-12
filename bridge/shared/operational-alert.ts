// operational-alert — tira o alerta de dentro do banco e entrega em alguém.
//
// O monitor já detectava: em 29/08 ele registrou `channel_disconnected` (crítico) e
// `failed_messages_history_24h` enquanto o token do Instagram estava expirado havia 28h e
// 73 mensagens de cliente tinham sumido. Só que o alerta terminava como linha em `events`,
// que ninguém lê — o incidente só apareceu quando o cliente reclamou.
//
// Entrega por WhatsApp, usando um canal que já existe. Rota híbrida (uazapi) quando dá,
// porque alerta não precisa custar mensagem oficial.
import { optionalEnv } from "./env.ts";
import type { DbClient } from "./supabase.ts";
import { claimDeliveryWithTtl } from "./supabase.ts";
import { getHybridRoute, hybridSendText, isHybridRecipient } from "./hybrid.ts";
import { sendMeta } from "./hub.ts";

type Json = Record<string, unknown>;

export type OperationalIssue = {
  key: string;
  severity: string;
  count: number;
  detail?: string;
};

// Só o que exige AÇÃO HUMANA AGORA sai do banco. As pendências crônicas (contato sem avatar,
// lead sem nome, atribuição de anúncio) continuam registradas como evento e ficam fora da
// entrega — misturá-las enterraria o alerta que importa, que foi o que aconteceu em 29/08:
// 5 avisos de rotina por rodada e 1 crítico no meio.
const ENTREGAVEIS = new Set([
  "channel_disconnected",
  "social_token_invalid",
  "channel_silent",
  "inbound_lost",
  // Número conectado na uazapi sem canal cadastrado: cliente escrevendo, bridge descartando.
  // Exige ação humana imediata (cadastrar o canal) e o conserto é de minutos.
  "canal_nao_cadastrado",
  "failed_messages_15m",
  "overdue_funnel_queue",
  // Instância uazapi fora do ar com o canal `active` no banco: a uazapi aceita o envio e
  // nada sai. Em 10/09 o 6836 caiu no meio de um disparo e quem percebeu foi o dono.
  "uazapi_instance_disconnected",
  // Arquivo do funil sumido do storage: a peça sai sem imagem e só repondo o arquivo resolve.
  "midia_indisponivel",
  // Mensagem de cliente que só apareceu na varredura (não veio pelo webhook): entrou sem
  // automação e está esperando atendente. Em 11/09 eram 24, uma delas de compra fechando.
  "inbound_recovered",
]);

const TITULOS: Record<string, string> = {
  inbound_recovered: "Mensagem de cliente recuperada fora do webhook (responder no Chatwoot)",
  uazapi_instance_disconnected: "Número WhatsApp desconectado na uazapi (reconectar o QR)",
  midia_indisponivel: "Mídia do funil sumiu do storage (peça saindo sem imagem)",
  channel_disconnected: "Canal desconectado",
  social_token_invalid: "Token de canal social inválido",
  channel_silent: "Canal ativo parou de receber mensagem",
  inbound_lost: "Mensagem de cliente perdida na ingestão",
  canal_nao_cadastrado: "Número recebendo sem canal cadastrado",
  failed_messages_15m: "Falhas de envio agora",
  overdue_funnel_queue: "Fila do funil atrasada",
};

// Instância uazapi caída enquanto o canal segue `active` no banco.
//
// Em 10/09 o 6836 desconectou no meio de um disparo: `channels.status` continuou `active`,
// a uazapi aceitou os envios e nada saiu. O monitor olhava só o banco; quem percebeu foi o
// dono. A verdade sobre a conexão está em `/instance/all`, então é lá que se pergunta.
//
// Canal e instância se ligam pelos dois jeitos que o envio já usa:
// - uazapi puro (0595, 11910, Mato Grosso): `external_id` = nome da instância, sem
//   `phone_number_id` — a mesma regra do `isUazapiOnly` no chatwoot-webhook;
// - híbrido (5895, 6836): canal oficial cujo número é o `owner` de uma instância. Se o
//   `owner` vier vazio, vale a instância com o mesmo nome do canal.
export type InstanciaUazapi = { name: string; number: string | null; status: string };

// Igualdade, nunca substring: "disconnected" contém "connected".
export function instanciaConectada(status: string | null | undefined): boolean {
  return /^(connected|open)$/i.test(String(status ?? "").trim());
}

export function avaliarInstanciasUazapi(
  canais: Json[],
  instancias: InstanciaUazapi[],
): string[] {
  // lista vazia é a uazapi que não respondeu direito (401, corpo inesperado), não "todas
  // as instâncias sumiram" — alarmar aqui dispararia um falso alerta para cada canal
  if (instancias.length === 0) return [];
  const digitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");
  const caidas: string[] = [];
  for (const canal of canais) {
    if (canal.type !== "whatsapp") continue;
    if (canal.status !== "active" && canal.status !== "connected") continue;
    const nome = String(canal.name ?? "");
    const externo = String(canal.external_id ?? "").trim();

    if (externo && !canal.phone_number_id) {
      const inst = instancias.find((i) => i.name === externo);
      if (!inst) caidas.push(`${nome}: instância ${externo} não existe na uazapi`);
      else if (!instanciaConectada(inst.status)) {
        caidas.push(`${nome}: instância ${inst.name} ${inst.status}`);
      }
      continue;
    }

    const alvo = digitos(canal.phone_number);
    let espelhos = alvo.length >= 10
      ? instancias.filter((i) => digitos(i.number) === alvo)
      : [];
    if (espelhos.length === 0) espelhos = instancias.filter((i) => i.name === nome);
    // canal oficial sem espelho uazapi não depende dela
    if (espelhos.length === 0) continue;
    if (espelhos.some((i) => instanciaConectada(i.status))) continue;
    caidas.push(
      `${nome}: instância ${espelhos.map((i) => i.name).join("/")} ${espelhos[0].status}`,
    );
  }
  return caidas;
}

// Silêncio de canal: quando ele é incidente e quando é rotina.
//
// A primeira versão usava um limiar fixo (12h) e alarmou o Instagram num sábado. A segunda
// usou a MÉDIA diária dos 7 dias — e alarmou o 6836, que recebe em rajada de campanha:
// 47 entradas num dia, 0 no outro, 38 no seguinte. Média não descreve rajada, e o próprio
// canal já tinha passado 24h calado na mesma semana sem nada de errado.
//
// Agora o canal é comparado consigo mesmo: se ele já ficou N horas calado nos últimos 7
// dias sem que houvesse problema, N horas não é sintoma. Só o silêncio claramente maior que
// o próprio hábito conta.
//
// E há um segundo critério, que é o que separa "quebrou" de "está parado": só alarma se NÓS
// estivermos falando. Silêncio dos dois lados é operação parada — a campanha do 6836 está
// pausada desde 26/08, então ninguém responde porque ninguém foi chamado. Entrada que morre
// ENQUANTO continuamos enviando, essa sim é suspeita.
export type AvaliacaoDeSilencio = {
  anormal: boolean;
  silencioAtualH: number;
  maiorSilencioHabitualH: number;
  motivo: string;
};

export function avaliarSilencio(
  entradasMs: number[],
  saidasMs: number[],
  agora: number,
  pisoHoras = 3,
): AvaliacaoDeSilencio {
  const H = 60 * 60 * 1000;
  const entradas = [...entradasMs].sort((a, b) => a - b);
  if (entradas.length < 2) {
    return {
      anormal: false,
      silencioAtualH: 0,
      maiorSilencioHabitualH: 0,
      motivo: "histórico insuficiente",
    };
  }
  let maiorGap = 0;
  for (let i = 1; i < entradas.length; i++) {
    maiorGap = Math.max(maiorGap, entradas[i] - entradas[i - 1]);
  }
  const ultima = entradas[entradas.length - 1];
  const silencioAtual = agora - ultima;
  // 1,5x o maior silêncio já observado, com piso: variação normal não dispara
  const limite = Math.max(pisoHoras * H, maiorGap * 1.5);
  const h = (ms: number) => Math.round(ms / H * 10) / 10;

  if (silencioAtual <= limite) {
    return {
      anormal: false,
      silencioAtualH: h(silencioAtual),
      maiorSilencioHabitualH: h(maiorGap),
      motivo: "dentro do hábito do canal",
    };
  }
  // continuamos enviando e não volta nada? aí é suspeito. Silêncio dos dois lados é
  // operação parada, não canal quebrado.
  const enviamosDepois = saidasMs.some((t) => t > ultima);
  if (!enviamosDepois) {
    return {
      anormal: false,
      silencioAtualH: h(silencioAtual),
      maiorSilencioHabitualH: h(maiorGap),
      motivo: "sem envio nosso no período — operação parada, não canal quebrado",
    };
  }
  return {
    anormal: true,
    silencioAtualH: h(silencioAtual),
    maiorSilencioHabitualH: h(maiorGap),
    motivo: "silêncio acima do hábito, com envio nosso acontecendo",
  };
}

export function alertasParaEntregar(
  issues: OperationalIssue[],
): OperationalIssue[] {
  return issues.filter((i) =>
    i.severity === "critical" && ENTREGAVEIS.has(i.key) && i.count > 0
  );
}

export function formatarAlerta(issues: OperationalIssue[], agora: Date): string {
  const linhas = issues.map((i) => {
    const titulo = TITULOS[i.key] ?? i.key;
    return `• *${titulo}*: ${i.count}${i.detail ? ` — ${i.detail}` : ""}`;
  });
  const hora = agora.toISOString().slice(11, 16);
  return [
    `🚨 *EVO Hub — alerta operacional* (${hora} UTC)`,
    "",
    ...linhas,
    "",
    "Detalhe em /operational-health no painel.",
  ].join("\n");
}

// Destino e canal são configuráveis: sem ALERT_WHATSAPP_TO a entrega é desligada e o
// comportamento antigo (só evento no banco) continua valendo.
export async function entregarAlertas(
  db: DbClient,
  issues: OperationalIssue[],
  agora: Date,
): Promise<{ enviado: boolean; motivo?: string }> {
  const entregaveis = alertasParaEntregar(issues);
  if (entregaveis.length === 0) return { enviado: false, motivo: "sem-critico" };

  const destino = (optionalEnv("ALERT_WHATSAPP_TO") ?? "").replace(/\D/g, "");
  if (!destino) return { enviado: false, motivo: "ALERT_WHATSAPP_TO ausente" };

  // Um alerta por hora no máximo: o monitor roda a cada 15min e repetir o mesmo texto
  // quatro vezes por hora vira ruído que o time aprende a ignorar.
  const chave = `alerta-op-${entregaveis.map((i) => i.key).sort().join("+")}`;
  if (!await claimDeliveryWithTtl(db, chave, "operational-alert", 60 * 60_000, agora)) {
    return { enviado: false, motivo: "ja-avisado-nesta-hora" };
  }

  const nomeCanal = optionalEnv("ALERT_CHANNEL_NAME") ?? "5895";
  const { data: canal } = await db.from("channels")
    .select("id,name,phone_number,phone_number_id")
    .eq("name", nomeCanal).eq("type", "whatsapp").maybeSingle();
  if (!canal?.phone_number_id) {
    return { enviado: false, motivo: `canal ${nomeCanal} sem phone_number_id` };
  }

  const texto = formatarAlerta(entregaveis, agora);
  const rota = isHybridRecipient(destino)
    ? await getHybridRoute(
      canal.id as string,
      canal.phone_number_id as string,
      canal.phone_number as string,
    )
    : null;

  let ok = false;
  if (rota) {
    const r = await hybridSendText(rota, destino, texto);
    ok = Boolean(r?.ok);
  }
  if (!ok) {
    // Sem rota híbrida (ou ela falhou) o alerta vale a mensagem oficial: perder o aviso
    // custa mais caro que a mensagem.
    const r = await sendMeta(
      (await db.from("channel_secrets").select("channel_token")
        .eq("channel_id", canal.id).maybeSingle()).data?.channel_token as string,
      `${canal.phone_number_id}/messages`,
      {
        messaging_product: "whatsapp",
        to: destino,
        type: "text",
        text: { body: texto },
      },
    );
    ok = r.ok;
    if (!ok) {
      console.error(
        "operational-alert: envio falhou",
        r.status,
        JSON.stringify(r.data).slice(0, 200),
      );
    }
  }

  await db.from("events").insert({
    source: "operational-monitor",
    event_type: ok ? "alert_delivered" : "alert_delivery_failed",
    payload: { keys: entregaveis.map((i) => i.key), destino_sufixo: destino.slice(-4) },
  }).then(() => {}, () => {});

  return { enviado: ok, motivo: ok ? undefined : "envio-falhou" };
}

export type { Json };
