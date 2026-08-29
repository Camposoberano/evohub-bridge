import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  alertasParaEntregar,
  formatarAlerta,
  horasDeSilencioParaAlarmar,
} from "../shared/operational-alert.ts";
import { DESLIGAMENTO_INTENCIONAL } from "../handlers/operational-health.ts";

// 29/08: o monitor gravou `channel_disconnected` crítico junto com 5 avisos crônicos, e o
// conjunto ficou numa tabela que ninguém lê. Estes testes prendem as duas regras do conserto:
// só sai o que exige ação agora, e o texto tem que dizer o que fazer.

const ISSUES = [
  { key: "lead_missing_avatar_24h", severity: "warning", count: 33 },
  { key: "channel_disconnected", severity: "critical", count: 1 },
  { key: "ad_attribution_gap_24h", severity: "warning", count: 9 },
  {
    key: "social_token_invalid",
    severity: "critical",
    count: 1,
    detail: "sorgo brasileiro: HTTP 401",
  },
];

Deno.test("só o crítico acionável é entregue", () => {
  const saida = alertasParaEntregar(ISSUES).map((i) => i.key);
  assertEquals(saida, ["channel_disconnected", "social_token_invalid"]);
});

Deno.test("pendência crônica nunca é entregue, mesmo marcada como crítica", () => {
  const saida = alertasParaEntregar([
    { key: "lead_missing_identifier_24h", severity: "critical", count: 12 },
  ]);
  assertEquals(saida, []);
});

Deno.test("contagem zerada não vira alerta", () => {
  assertEquals(
    alertasParaEntregar([
      { key: "channel_disconnected", severity: "critical", count: 0 },
    ]),
    [],
  );
});

Deno.test("texto nomeia o problema e carrega o detalhe", () => {
  const texto = formatarAlerta(
    alertasParaEntregar(ISSUES),
    new Date("2026-08-29T19:53:00Z"),
  );
  assertEquals(texto.includes("19:53 UTC"), true);
  assertEquals(texto.includes("Canal desconectado*: 1"), true);
  assertEquals(
    texto.includes("Token de canal social inválido*: 1 — sorgo brasileiro: HTTP 401"),
    true,
  );
  assertEquals(texto.includes("lead_missing_avatar"), false);
});

// Primeira rodada em produção alarmou "Atendimento IG (25 em 7d, 0 em 12h)" num sábado —
// canal que recebe 4 a 11 por dia. Silêncio só é incidente em relação ao ritmo do canal.
Deno.test("limiar de silêncio acompanha o volume do canal", () => {
  assertEquals(horasDeSilencioParaAlarmar(700), 3); // ~100/dia: 3h calado é incidente
  assertEquals(horasDeSilencioParaAlarmar(70), 6); // ~10/dia
  assertEquals(horasDeSilencioParaAlarmar(25), 36); // ~3,5/dia: um sábado é normal
});

// "Atendimento FB" está inativo de propósito (duplicata do Mega Sorgo). Como crítico, mandaria
// alerta de hora em hora para sempre — o alerta novo morreria de ruído na primeira noite.
Deno.test("canal desligado com motivo declarado não é incidente", () => {
  assertEquals(
    DESLIGAMENTO_INTENCIONAL.test(
      "Duplicado -- canal 'Mega Sorgo Santa Elisa' (pagina 101431812463255) ja cobre esse atendimento",
    ),
    true,
  );
  assertEquals(
    DESLIGAMENTO_INTENCIONAL.test("canal preservado e suspenso pelo cliente"),
    true,
  );
  assertEquals(DESLIGAMENTO_INTENCIONAL.test("token expirado"), false);
  assertEquals(DESLIGAMENTO_INTENCIONAL.test(""), false);
});
