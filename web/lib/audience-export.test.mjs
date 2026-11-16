import { test } from "node:test";
import assert from "node:assert/strict";
import { exportAudienceCsv } from "./audience-export.mjs";
import { parseAudienceCsv } from "./audience-csv.mjs";

test("exporta todas as colunas e resultados, preservando acentos e linhas", () => {
  const csv = exportAudienceCsv([
    { phone: "5588999990000", name: "João; Silva", attributes: { escola: "São José" },
      verification: { status: "confirmed", reason: null, checked_at: "2026-10-30T12:00:00Z" } },
    { phone: "5588999990001", name: "Ana", attributes: { escola: "A" },
      verification: { status: "unconfirmed", reason: "consulta indisponível", checked_at: "2026-10-30T12:01:00Z" } },
  ], [{ title: "Escola", key: "escola" }]);
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.match(csv, /"verificacao_whatsapp";"motivo_verificacao"/);
  const parsed = parseAudienceCsv(csv);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].name, "João; Silva");
  assert.equal(parsed.rows[0].attributes.Escola, "São José");
  assert.equal(parsed.rows[1].attributes.verificacao_whatsapp, "unconfirmed");
});

test("protege telefone longo e célula que poderia virar fórmula", () => {
  const csv = exportAudienceCsv([{ phone: "5588999990000", name: "=1+1", attributes: {} }], []);
  assert.match(csv, /"'5588999990000"/);
  assert.match(csv, /"'=1\+1"/);
});
