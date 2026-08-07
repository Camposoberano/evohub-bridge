import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { customerIdentityKey, ensureCustomer } from "../shared/customer.ts";

type Row = Record<string, unknown>;

// Banco de mentira: registra o que foi escrito em cada tabela e com quais opções.
function fakeDb() {
  const escrito: { tabela: string; row: Row; opts?: Row }[] = [];
  // deno-lint-ignore no-explicit-any
  const db: any = {
    from(tabela: string) {
      return {
        select() {
          return {
            eq() {
              return { maybeSingle: () => Promise.resolve({ data: null }) };
            },
          };
        },
        upsert(row: Row, opts?: Row) {
          escrito.push({ tabela, row, opts });
          if (tabela === "customers") {
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: { id: "cust-1", display_name: row.display_name },
                    error: null,
                  }),
              }),
            };
          }
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { db, escrito };
}

type Escrita = { tabela: string; row: Row; opts?: Row };
const prospeccao = (e: Escrita[]) => e.filter((x) => x.tabela === "clientes");

Deno.test("lead do WhatsApp aparece na prospeccao do painel", async () => {
  const { db, escrito } = fakeDb();
  await ensureCustomer(db, {
    channelId: "ch-1",
    externalId: "5519999715895",
    phone: "+5519999715895",
    name: "Jose Lima",
  });
  const linhas = prospeccao(escrito);
  assertEquals(linhas.length, 1, "nao espelhou em clientes");
  // clientes.phone é só dígitos; customers.canonical_phone vem com "+"
  assertEquals(linhas[0].row.phone, "5519999715895");
  assertEquals(linhas[0].row.customer_id, "cust-1");
  assertEquals(linhas[0].row.lead_name, "Jose Lima");
});

// Sem isso, o upsert sobrescreve as 9.172 linhas importadas: zera enrich_status='done'
// e apaga nome e avatar que o enriquecimento já tinha coletado.
Deno.test("nunca sobrescreve linha ja existente na lista importada", async () => {
  const { db, escrito } = fakeDb();
  await ensureCustomer(db, {
    channelId: "ch-1",
    externalId: "5519999715895",
    phone: "+5519999715895",
  });
  assertEquals(prospeccao(escrito)[0].opts?.ignoreDuplicates, true);
  assertEquals(prospeccao(escrito)[0].opts?.onConflict, "phone");
});

// on_whatsapp nulo é o gancho do loop de enriquecimento (shared/enrich.ts busca
// `is("on_whatsapp", null)`). Preencher aqui deixaria a linha órfã, sem nome nem avatar.
Deno.test("deixa on_whatsapp nulo pro enriquecimento assumir", async () => {
  const { db, escrito } = fakeDb();
  await ensureCustomer(db, {
    channelId: "ch-1",
    externalId: "5511988887777",
    phone: "+5511988887777",
  });
  assertEquals("on_whatsapp" in (prospeccao(escrito)[0].row), false);
});

// PSID do Facebook e LID do WhatsApp são numéricos e caem na faixa de 10-15 dígitos que a
// chave de identidade aceita. Em 07/08 havia 26 desses em customers. Não são telefone:
// entram na prospecção como lead que ninguém consegue ligar.
Deno.test("identificador interno nao vira lead na prospeccao", async () => {
  for (const id of ["111884116168821", "263719816831101", "1234567890"]) {
    const { db, escrito } = fakeDb();
    await ensureCustomer(db, { channelId: "ch-1", externalId: id });
    assertEquals(
      prospeccao(escrito).length,
      0,
      `${id} (${id.length} digitos) nao devia entrar`,
    );
  }
});

// Contato sem telefone nenhum (Messenger/Instagram) não tem o que espelhar.
Deno.test("contato sem telefone nao toca na prospeccao", async () => {
  const { db, escrito } = fakeDb();
  await ensureCustomer(db, { channelId: "ch-1", externalId: "psid_abc123" });
  assertEquals(
    customerIdentityKey("ch-1", "psid_abc123").normalizedPhone,
    null,
  );
  assertEquals(prospeccao(escrito).length, 0);
});

// Celular brasileiro tem 13 dígitos (55 + DDD + 9); fixo e números antigos têm 12.
Deno.test("aceita 12 e 13 digitos, que e o formato real da base", async () => {
  for (
    const [tel, deveEntrar] of [
      ["+556199466167", true], // 12
      ["+5561994661670", true], // 13
      ["+55619946616", false], // 11
    ] as [string, boolean][]
  ) {
    const { db, escrito } = fakeDb();
    await ensureCustomer(db, {
      channelId: "ch-1",
      externalId: tel.slice(1),
      phone: tel,
    });
    assertEquals(prospeccao(escrito).length > 0, deveEntrar, tel);
  }
});
