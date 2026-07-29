import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canRouteClick,
  catalogTextClaimKey,
  clickDomain,
  directInstanceCandidates,
} from "../shared/journey-router.ts";

Deno.test("ids do catalogo nunca pertencem ao Mega Sorgo", () => {
  for (
    const id of [
      "grp_graos",
      "cat_milho",
      "prod_MILHO-001",
      "acao_MILHO-001_preco",
      "pg_prod_milho_more_1",
      "quali_obj_graos",
    ]
  ) {
    assertEquals(clickDomain(id), "catalogo");
    assertEquals(canRouteClick("mega_sorgo", id), false);
  }
});

Deno.test("ids do Mega Sorgo nunca pertencem ao catalogo", () => {
  for (
    const id of [
      "menu_preco",
      "preco_area_maior",
      "tam_4kg",
      "pag_pix",
      "plantio_semente",
      "nutricao_bromatologia",
    ]
  ) {
    assertEquals(clickDomain(id), "mega_sorgo");
    assertEquals(canRouteClick("catalogo", id), false);
  }
});

Deno.test("id desconhecido nao e atribuido a uma jornada", () => {
  assertEquals(clickDomain("acao_desconhecida"), "catalogo");
  assertEquals(clickDomain("outro"), null);
  assertEquals(canRouteClick("catalogo", "outro"), true);
  assertEquals(canRouteClick("mega_sorgo", "outro"), true);
});

Deno.test("canal uazapi nativo prioriza nome da instancia antes do UUID externo", () => {
  assertEquals(
    directInstanceCandidates(
      "6836",
      "c48b43ec-83c2-46d8-bb38-d00e2fb9115f",
    ),
    ["6836", "c48b43ec-83c2-46d8-bb38-d00e2fb9115f"],
  );
  assertEquals(directInstanceCandidates("6836", "6836"), ["6836"]);
});

Deno.test("reentrega do mesmo texto de catalogo usa a mesma trava", () => {
  const input = {
    channelId: "canal-6836",
    from: "5511999999999",
    metaMessageId: "META-123",
    sentAt: "2026-07-29T19:08:52.093Z",
    content: "Vou te passar os valores",
  };
  assertEquals(catalogTextClaimKey(input), catalogTextClaimKey(input));
  assertEquals(
    catalogTextClaimKey({ ...input, metaMessageId: "META-124" }) ===
      catalogTextClaimKey(input),
    false,
  );
});
