// Iscas digitais (lead magnets): registro reutilizável + dedup diário + oferta no fim do
// funil (imagem + Sim/Não). O clique só é roteado nos dois webhooks (hub e uazapi) se o id
// começa com "menu_" — por isso há um teste travando esse invariante.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ISCAS, iscasAtivas, matchIsca } from "../shared/iscas.ts";
import { claimDailyTag, releaseDailyIntent } from "../shared/intent-dedup.ts";
import {
  normalizeHybridButtonReply,
  normalizeHybridMenuClick,
} from "../shared/hybrid-menu.ts";
import { FASES } from "../handlers/funil-enroll.ts";

Deno.test("matchIsca separa Sim, Não e ignora desconhecido", () => {
  assertEquals(matchIsca("menu_isca_silagem")?.acao, "sim");
  assertEquals(matchIsca("menu_isca_nao_silagem")?.acao, "nao");
  assertEquals(matchIsca("menu_isca_silagem")?.isca.id, "silagem");
  assertEquals(matchIsca("menu_preco"), undefined);
  assertEquals(matchIsca("qualquer"), undefined);
});

Deno.test("botões Sim e Não começam com menu_ (invariante de roteamento)", () => {
  for (const i of iscasAtivas()) {
    assertEquals(i.botaoSim.startsWith("menu_"), true, `${i.id}: botaoSim`);
    assertEquals(i.botaoNao.startsWith("menu_"), true, `${i.id}: botaoNao`);
  }
});

Deno.test("no uazapi o título do botão volta pro id (Sim e Não)", () => {
  // A resposta de botão na uazapi chega como o TÍTULO; hybrid-menu mapeia de volta pro id.
  // Sem isso o "Quero o material" não roteia e o PDF nunca sai no canal do funil (6836).
  for (const i of iscasAtivas()) {
    assertEquals(normalizeHybridButtonReply(i.tituloSim), i.botaoSim, `${i.id} Sim`);
    assertEquals(normalizeHybridButtonReply(i.tituloNao), i.botaoNao, `${i.id} Não`);
    assertEquals(normalizeHybridMenuClick(i.tituloSim), i.botaoSim, `${i.id} Sim menu`);
    assertEquals(normalizeHybridMenuClick(i.tituloNao), i.botaoNao, `${i.id} Não menu`);
  }
});

Deno.test("cada isca tem capa, PDF, etiqueta e recusa", () => {
  for (const i of ISCAS) {
    assertEquals(i.capaSlot.length > 0, true);
    assertEquals(i.slot.length > 0, true);
    assertEquals(i.filename.length > 0, true);
    assertEquals(i.etiqueta.length > 0, true);
    assertEquals(i.recusaMsg.length > 0, true);
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
  assertEquals(a.key, b.key);
  await releaseDailyIntent(db, a.key);
});

Deno.test("fase 5 oferta a isca (interativo com capa + Sim/Não) antes do fechamento", () => {
  const fase5 = FASES[FASES.length - 1]();
  // deno-lint-ignore no-explicit-any
  const interativos = fase5.filter((p: any) => p.kind === "interactive");
  for (const i of iscasAtivas()) {
    const oferta = interativos.find((p) =>
      // deno-lint-ignore no-explicit-any
      ((p as any).buttons ?? []).some((b: { id: string }) => b.id === i.botaoSim)
    );
    assertEquals(Boolean(oferta), true, `isca ${i.id} não é ofertada na fase 5`);
    // deno-lint-ignore no-explicit-any
    const p = oferta as any;
    assertEquals(p.headerSlot, i.capaSlot, "oferta sem a capa como header");
    assertEquals(p.mediaDay, 0, "capa é do catálogo (day 0)");
    assertEquals(
      p.buttons.some((b: { id: string }) => b.id === i.botaoNao),
      true,
      "oferta sem botão Não",
    );
    // a oferta vem antes do fechamento (lista), que é a última peça
    const fechamento = fase5.reduce((a, b) => (b.offset > a.offset ? b : a));
    assertEquals(fechamento.kind, "list");
    assertEquals(p.offset < fechamento.offset, true, "oferta não vem antes do fechamento");
  }
});
