import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ingestInbound } from "../shared/inbound.ts";

// 29/08: 73 mensagens de cliente sumiram em 24h porque o claim de dedup era tirado antes do
// trabalho e nunca devolvido quando o trabalho falhava (Chatwoot 502, mídia 404). A retentativa
// do webhook batia no claim, recebia "duplicate" e a mensagem morria. Estes testes prendem
// as duas metades do conserto: o claim volta no erro, e o claim NÃO volta na duplicata.

type Chamada = { tabela: string; op: string; valor?: unknown };

function dbFake(chamadas: Chamada[], claimOk = true) {
  return {
    from(tabela: string) {
      return {
        insert(_row: unknown) {
          chamadas.push({ tabela, op: "insert" });
          const res = claimOk
            ? { error: null }
            : { error: { code: "23505" } };
          return Object.assign(Promise.resolve(res), {
            select: () => ({ single: () => Promise.resolve(res) }),
            then: (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) =>
              Promise.resolve(res).then(f, r),
          });
        },
        delete() {
          return {
            eq(_col: string, valor: string) {
              chamadas.push({ tabela, op: "delete", valor });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

// envAcct() lê estas na primeira chamada ao Chatwoot; sem elas o teste falharia antes do fetch
Deno.env.set("CHATWOOT_URL", "https://chatwoot.invalid");
Deno.env.set("CHATWOOT_ACCOUNT_ID", "1");
Deno.env.set("CHATWOOT_API_ACCESS_TOKEN", "token-de-teste");

const CANAL = { id: "canal-1", type: "whatsapp", chatwoot_inbox_id: 46 };
const MSG = {
  from: "5519999990000",
  msgType: "audio",
  content: "",
  metaMessageId: "5519999715895:ABC123",
};

Deno.test("falha depois do claim devolve o claim para o retry do webhook", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("Chatwoot 502"))) as typeof fetch;
  const chamadas: Chamada[] = [];
  try {
    await ingestInbound(dbFake(chamadas) as never, CANAL, MSG);
    throw new Error("deveria ter propagado o erro");
  } catch (e) {
    assertEquals((e as Error).message.includes("Chatwoot 502"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const liberado = chamadas.find((c) =>
    c.tabela === "deliveries" && c.op === "delete"
  );
  assertEquals(liberado?.valor, "wa-canal-1-5519999715895:ABC123");
});

Deno.test("duplicata real NÃO devolve o claim", async () => {
  const chamadas: Chamada[] = [];
  const r = await ingestInbound(dbFake(chamadas, false) as never, CANAL, MSG);
  assertEquals(r, { inserted: false, reason: "duplicate" });
  assertEquals(
    chamadas.some((c) => c.tabela === "deliveries" && c.op === "delete"),
    false,
  );
});
