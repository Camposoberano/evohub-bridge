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
// Os textos dos botões foram escolhidos para casar com shared/intent.ts (PRECO_RE,
// VIDEO_RE, PLANTIO_RE) — mudar o texto do template no Meta quebra o roteamento.
import { sendMetaMessage } from "./hub.ts";

type Json = Record<string, unknown>;
type DbClient = {
  from: (table: string) => {
    // deno-lint-ignore no-explicit-any
    select: (columns: string) => any;
  };
};

/** variação da recuperação → template aprovado no WhatsApp Business. */
export const RECOVERY_TEMPLATES: Record<number, string> = {
  1: "boa_vindas", // "ME CHAMO CICERO SOBREIRA..." [Lembro sim][Me lembre][não me interesso]
  2: "retomada_conversa", // "faz alguns dias que conversamos" [Ver preço][Ver vídeos][Falar com Cícero]
  3: "convite_videos", // "gravamos vídeos na lavoura" [Quero ver os vídeos][Ver preço][Não tenho interesse]
  4: "tirar_duvida", // "ficou alguma dúvida" [Como plantar][Ver preço][Não tenho interesse]
};

export const RECOVERY_TEMPLATE_LANG = "pt_BR";

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
  const template = RECOVERY_TEMPLATES[variation];
  if (!template) {
    return {
      ok: false,
      template: "",
      error: `variação ${variation} sem template`,
    };
  }
  const phoneNumberId = channel.phone_number_id as string | undefined;
  if (!phoneNumberId) {
    return {
      ok: false,
      template,
      error: "canal sem phone_number_id (não-oficial)",
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
