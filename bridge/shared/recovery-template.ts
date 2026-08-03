// recovery-template — porta de entrada da recuperação quando a janela Meta está fechada.
//
// Problema real: 255 das 400 conversas estão fora da janela de 24h/72h. A macro de
// recuperação mandava texto livre, o gate bloqueava, o atendente desistia — daí a
// recuperação 1 ter 72 envios e a 4 apenas 1.
//
// Solução: fora da janela manda o TEMPLATE aprovado, que tem botões. O lead toca em um
// botão, isso conta como mensagem de entrada, a janela reabre e aí o conteúdo rico de
// recovery-content.ts pode ser enviado normalmente.
//
// ATENÇÃO — template é por WABA, não global. Cada canal oficial tem o seu `waba_id`
// (channels.waba_id) e um template só existe dentro da WABA onde foi aprovado. Mandar o
// nome de outra WABA devolve "(#132001) Template name does not exist in the translation".
// Foi exatamente o erro cometido em 03/08: os templates foram criados na WABA errada.
import { sendMetaMessage } from "./hub.ts";

type Json = Record<string, unknown>;
type DbClient = {
  from: (table: string) => {
    // deno-lint-ignore no-explicit-any
    select: (columns: string) => any;
  };
};

/**
 * variação da recuperação → template aprovado, POR WABA.
 * Conferir com: GET /{waba_id}/message_templates?fields=name,language,status
 */
const TEMPLATES_BY_WABA: Record<string, Record<number, string>> = {
  // canal "5895" — 743886211614541
  "743886211614541": {
    1: "bem_vindo", // "falamos anteriormente sobre o mega sorgo" [Lembro sim|Tenho duvidas|Qual preço]
    2: "mega_sorgo", // "quais dúvidas o senhor tem" [PREÇO|INFORMAÇÕES|TO TRANQUILO]
    3: "rece__o", // "ainda tem interesse nas sementes" [quero saber mais|ok]
    4: "customer_satisfaction_survey_13_1", // "ola amigo lembra de mim" [sim me lembro sim]
  },
  // canal "6836" — 100191609666845. Só tem um template aprovado; repete nas 4 variações.
  "100191609666845": {
    1: "boa_noite",
    2: "boa_noite",
    3: "boa_noite",
    4: "boa_noite",
  },
};

export const RECOVERY_TEMPLATE_LANG = "pt_BR";

/** Nomes submetidos em 03/08 na WABA 743886211614541, aguardando aprovação da Meta.
 *  Quando saírem APPROVED, substituir 2/3/4 acima — os botões destes casam com
 *  shared/intent.ts (PRECO_RE, VIDEO_RE, PLANTIO_RE), os atuais não. */
export const TEMPLATES_PENDENTES = [
  "retomada_conversa",
  "convite_videos",
  "tirar_duvida",
] as const;

export function templateFor(
  wabaId: string | null | undefined,
  variation: number,
): string | null {
  if (!wabaId) return null;
  return TEMPLATES_BY_WABA[String(wabaId)]?.[variation] ?? null;
}

export type TemplateSendResult = {
  ok: boolean;
  template: string;
  status?: number;
  error?: string;
};

/**
 * Dispara o template da variação para o contato. Só faz sentido em canal oficial
 * (`phone_number_id`); canal não-oficial não tem janela e nem template.
 */
export async function sendRecoveryTemplate(
  db: DbClient,
  channel: Json,
  to: string,
  variation: number,
): Promise<TemplateSendResult> {
  const phoneNumberId = channel.phone_number_id as string | undefined;
  if (!phoneNumberId) {
    return {
      ok: false,
      template: "",
      error: "canal sem phone_number_id (não-oficial)",
    };
  }

  const template = templateFor(
    channel.waba_id as string | undefined,
    variation,
  );
  if (!template) {
    return {
      ok: false,
      template: "",
      error:
        `sem template mapeado para waba=${channel.waba_id} variação=${variation}`,
    };
  }

  const { data: secret } = await db.from("channel_secrets")
    .select("channel_token").eq("channel_id", channel.id).maybeSingle();
  const channelToken = secret?.channel_token as string | undefined;
  if (!channelToken) return { ok: false, template, error: "canal sem token" };

  const res = await sendMetaMessage(channelToken, phoneNumberId, {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: template,
      language: { code: RECOVERY_TEMPLATE_LANG },
    },
  });

  if (!res.ok) {
    const data = res.data as Json | undefined;
    const err = (data?.error as Json | undefined)?.message ??
      `HTTP ${res.status}`;
    return {
      ok: false,
      template,
      status: res.status,
      error: String(err).slice(0, 200),
    };
  }
  return { ok: true, template, status: res.status };
}
