import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildHybridListFallback,
  buildHybridListPayload,
  MAX_ROWS_PER_SECTION,
  paginateRows,
} from "../shared/hybrid-list.ts";

Deno.test("lista híbrida usa o formato de choices com seções e pipes do uazapi", () => {
  const payload = buildHybridListPayload(
    "5585999999999",
    "Catálogo de Produtos",
    [
      {
        title: "Braquiárias",
        rows: [
          { id: "prod_a", title: "BRS Piatã", description: "Formação de pastagem" },
          { id: "prod_b", title: "Marandu" },
        ],
      },
    ],
    "Ver Catálogo",
    "Preços sujeitos a alteração",
  );

  assertEquals(payload.type, "list");
  assertEquals(payload.choices, [
    "[Braquiárias]",
    "BRS Piatã|prod_a|Formação de pastagem",
    "Marandu|prod_b",
  ]);
  assertEquals(payload.listButton, "Ver Catálogo");
  assertEquals(payload.footerText, "Preços sujeitos a alteração");
});

Deno.test("lista híbrida escapa pipe e quebra de linha nas choices", () => {
  const payload = buildHybridListPayload(
    "5585999999999",
    "Texto",
    [{ title: "Seção|Ruim\nQuebrada", rows: [{ id: "x|y", title: "Item\nQuebrado" }] }],
    "Ver",
  );
  assertEquals(payload.choices, ["[Seção/Ruim Quebrada]", "Item Quebrado|x/y"]);
});

Deno.test("lista híbrida tem fallback textual acionável", () => {
  const text = buildHybridListFallback("Catálogo de Produtos", [
    { title: "Braquiárias", rows: [{ id: "prod_a", title: "BRS Piatã" }] },
  ]);
  assertEquals(
    text,
    "Catálogo de Produtos\n\n*Braquiárias*\n- BRS Piatã\n\nResponda com o nome da opção desejada.",
  );
});

Deno.test("paginação cabe tudo numa página só quando não excede o limite", () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, title: `Produto ${i}` }));
  const page0 = paginateRows(rows, 0, "pg_prod_x");
  assertEquals(page0.rows.length, 5);
  assertEquals(page0.hasMore, false);
});

Deno.test("paginação reserva uma linha para 'mais opções' quando excede o limite", () => {
  const rows = Array.from(
    { length: MAX_ROWS_PER_SECTION + 5 },
    (_, i) => ({ id: `p${i}`, title: `Produto ${i}` }),
  );
  const page0 = paginateRows(rows, 0, "pg_prod_x");
  assertEquals(page0.rows.length, MAX_ROWS_PER_SECTION);
  assertEquals(page0.hasMore, true);
  assertEquals(page0.rows.at(-1)?.id, "pg_prod_x_more_1");

  const page1 = paginateRows(rows, 1, "pg_prod_x");
  assertEquals(page1.hasMore, false);
});
