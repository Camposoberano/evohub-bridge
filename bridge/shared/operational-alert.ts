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
  "failed_messages_15m",
  "overdue_funnel_queue",
]);

const TITULOS: Record<string, string> = {
  channel_disconnected: "Canal desconectado",
  social_token_invalid: "Token de canal social inválido",
  channel_silent: "Canal ativo parou de receber mensagem",
  inbound_lost: "Mensagem de cliente perdida na ingestão",
  failed_messages_15m: "Falhas de envio agora",
  overdue_funnel_queue: "Fila do funil atrasada",
};

// Silêncio significa coisas diferentes conforme o volume do canal. O 5895 recebe ~100 por
// dia: 6h calado já é incidente. O Atendimento IG recebe 4 a 11 por dia e passar um sábado
// sem mensagem é rotina — foi exatamente o falso positivo que o limiar fixo de 12h produziu
// na primeira rodada. Daí o corte proporcional à média diária da última semana.
export function horasDeSilencioParaAlarmar(entradasNaSemana: number): number {
  const mediaDiaria = entradasNaSemana / 7;
  if (mediaDiaria >= 50) return 3;
  if (mediaDiaria >= 10) return 6;
  return 36;
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
