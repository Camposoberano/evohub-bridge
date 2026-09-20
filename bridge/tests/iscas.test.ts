// Iscas digitais (lead magnets): registro reutilizável + dedup diário + presença no fim do
// funil. O clique só é roteado nos dois webhooks (hub e uazapi) se o id começa com "menu_" —
// por isso há um teste travando esse invariante.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ISCAS, iscaPorBotao, iscasAtivas } from "../shared/iscas.ts";
import { claimDailyTag, releaseDailyIntent } from "../shared/intent-dedup.ts";
import { FASES } from "../handlers/funil-enroll.ts";

Deno.test("iscaPorBotao resolve conhecido e ignora desconhecido", () => {
  const silagem = iscaPorBotao("menu_isca_silagem");
  assertEquals(silagem?.id, "silagem");
  assertEquals(iscaPorBotao("menu_preco"), undefined);
  assertEquals(iscaPorBotao("qualquer"), undefined);
});

Deno.test("todo botão de isca começa com menu_ (invariante de roteamento)", () => {
  for (const i of iscasAtivas()) {
    assertEquals(
      i.botao.startsWith("menu_"),
      true,
      `isca ${i.id}: botão ${i.botao} não roteia sem prefixo menu_`,
    );
  }
});

Deno.test("cada isca tem slot, filename e etiqueta", () => {
  for (const i of ISCAS) {
    assertEquals(i.slot.length > 0, true);
    assertEquals(i.filename.length > 0, true);
    assertEquals(i.etiqueta.length > 0, true);
  }
});

Deno.test("claimDailyTag: primeira reivindica, segunda no mesmo dia é barrada", async () => {
  let n = 0;
  // deno-lint-ignore no-explicit-any
  const db: any = {
    from: () => ({
      insert: () =>
        Promise.resolve(n++ === 0 ? { error: null } : { error: { code: "23505" } }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  };
  const a = await claimDailyTag(db, "chan1", "5599@c.us", "menu_isca_silagem");
  assertEquals(a.claimed, true);
  const b = await claimDailyTag(db, "chan1", "5599@c.us", "menu_isca_silagem");
  assertEquals(b.claimed, false);
  assertEquals(a.key, b.key); // mesma chave = mesmo contato/dia
  await releaseDailyIntent(db, a.key); // não lança
});

Deno.test("fim da fase 5 oferece a isca (linha na lista de fechamento)", () => {
  const fase5 = FASES[FASES.length - 1]();
  const listas = fase5.filter((p) => p.kind === "list");
  assertEquals(listas.length >= 1, true);
  const ids = listas.flatMap((p) =>
    // deno-lint-ignore no-explicit-any
    ((p as any).sections as { rows: { id: string }[] }[]).flatMap((s) =>
      s.rows.map((r) => r.id)
    )
  );
  for (const i of iscasAtivas()) {
    assertEquals(ids.includes(i.botao), true, `isca ${i.id} não aparece na fase 5`);
  }
});
