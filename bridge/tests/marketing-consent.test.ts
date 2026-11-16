import {
  MARKETING_CONSENT_QUESTION,
  hasMarketingConsent,
  marketingConsentChoice,
  recordMarketingConsent,
} from "../shared/marketing-consent.ts";
import {
  normalizeHybridButtonReply,
  normalizeHybridMenuClick,
} from "../shared/hybrid-menu.ts";
import { isNegativeIntent } from "../shared/negative-intent.ts";

function assert(value: unknown, message: string) {
  if (!value) throw new Error(message);
}

Deno.test("botões de consentimento têm significado explícito nas duas rotas", () => {
  assert(MARKETING_CONSENT_QUESTION.includes("Campo Soberano"), "empresa ausente");
  assert(MARKETING_CONSENT_QUESTION.includes("depois desta conversa"), "mensagens futuras ausentes");
  assert(marketingConsentChoice("menu_marketing_sim") === "yes", "Sim não reconhecido");
  assert(marketingConsentChoice("menu_marketing_nao") === "no", "Não não reconhecido");
  assert(marketingConsentChoice("menu_isca_silagem") === null, "pedido de PDF virou aceite");
  assert(normalizeHybridMenuClick("Sim, quero receber") === "menu_marketing_sim", "Sim híbrido");
  assert(normalizeHybridButtonReply("Não, obrigado") === "menu_marketing_nao", "Não híbrido");
  assert(isNegativeIntent("PARAR"), "opt-out textual");
});

Deno.test("última resposta controla a elegibilidade futura", async () => {
  const rows: Array<{ payload: Record<string, unknown> }> = [];
  const query = {
    select: () => query,
    eq: () => query,
    contains: () => query,
    order: () => query,
    limit: () => query,
    maybeSingle: async () => ({ data: rows.at(-1) ?? null, error: null }),
  };
  const db = {
    from: (table: string) => {
      assert(table === "events", "tabela errada");
      return {
        insert: async (row: { payload: Record<string, unknown> }) => {
          rows.push(row);
          return { error: null };
        },
        ...query,
      };
    },
  } as unknown as Parameters<typeof hasMarketingConsent>[0];
  const input = { db, channelId: "canal", phone: "+5519999999999" };
  assert(!(await hasMarketingConsent(db, "canal", input.phone)), "sem aceite elegível");
  await recordMarketingConsent({ ...input, choice: "yes", inboundMessageId: "wamid.sim" });
  assert(await hasMarketingConsent(db, "canal", input.phone), "Sim não habilitou");
  assert(rows.at(-1)?.payload.inbound_message_id === "wamid.sim", "prova da resposta ausente");
  await recordMarketingConsent({ ...input, choice: "no", inboundMessageId: "wamid.nao" });
  assert(!(await hasMarketingConsent(db, "canal", input.phone)), "Não não revogou");
});
