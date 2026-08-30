import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  alertasParaEntregar,
  formatarAlerta,
  avaliarSilencio,
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

// --- silêncio de canal ------------------------------------------------------------------
// O limiar por MÉDIA diária alarmou o 6836 em 30/08: 125 entradas em 7 dias, mas em rajada
// de campanha (47 num dia, 0 no outro, 38 no seguinte). Média não descreve rajada.

const H = 60 * 60 * 1000;
const agora = Date.parse("2026-08-30T20:14:00Z");
/** entradas do 6836 como realmente foram: picos e um dia inteiro em branco */
function entradasDo6836(): number[] {
  const dias: [string, number][] = [
    ["2026-08-24", 47], ["2026-08-25", 22], ["2026-08-26", 0],
    ["2026-08-27", 9], ["2026-08-28", 38], ["2026-08-29", 8],
  ];
  const out: number[] = [];
  for (const [dia, n] of dias) {
    for (let i = 0; i < n; i++) {
      out.push(Date.parse(`${dia}T12:00:00Z`) + i * 6 * 60_000);
    }
  }
  out.push(Date.parse("2026-08-30T11:43:00Z"));
  return out;
}

Deno.test("canal de campanha em rajada não alarma por 8h de silêncio", () => {
  // ninguém enviou depois da última entrada: a campanha está pausada
  const r = avaliarSilencio(entradasDo6836(), [], agora);
  assertEquals(r.anormal, false);
  assertEquals(r.silencioAtualH > 8, true, "de fato está 8h+ calado");
});

Deno.test("silêncio dentro do hábito do canal não alarma nem com envio nosso", () => {
  // o 6836 já passou ~24h sem entrada na semana; 8h está longe disso
  const saidaRecente = [Date.parse("2026-08-30T19:00:00Z")];
  const r = avaliarSilencio(entradasDo6836(), saidaRecente, agora);
  assertEquals(r.anormal, false);
  assertEquals(r.motivo, "dentro do hábito do canal");
});

Deno.test("canal de fluxo constante alarma rápido quando some", () => {
  // uma entrada a cada 30min por 3 dias: o hábito é meia hora
  const entradas: number[] = [];
  for (let t = agora - 3 * 24 * H; t < agora - 5 * H; t += 30 * 60_000) entradas.push(t);
  const r = avaliarSilencio(entradas, [agora - 1 * H], agora);
  assertEquals(r.anormal, true, "5h calado num canal de 30min é incidente");
  assertEquals(r.maiorSilencioHabitualH < 1, true);
});

Deno.test("silêncio dos dois lados é operação parada, não canal quebrado", () => {
  const entradas: number[] = [];
  for (let t = agora - 3 * 24 * H; t < agora - 20 * H; t += 30 * 60_000) entradas.push(t);
  const semEnvio = avaliarSilencio(entradas, [agora - 30 * H], agora);
  assertEquals(semEnvio.anormal, false);
  assertEquals(semEnvio.motivo.includes("operação parada"), true);
  // mesmo histórico, mas continuamos enviando -> aí sim é suspeito
  const comEnvio = avaliarSilencio(entradas, [agora - 2 * H], agora);
  assertEquals(comEnvio.anormal, true);
});

Deno.test("histórico curto demais não vira alarme", () => {
  assertEquals(avaliarSilencio([agora - 50 * H], [agora], agora).anormal, false);
  assertEquals(avaliarSilencio([], [], agora).anormal, false);
});

// 30/08, 21:23: o alerta acusou "5895 — 150.4h calado" num canal que tinha recebido 54
// minutos antes. Causa: o monitor pedia 3000 linhas em ordem ASCENDENTE e o canal tem 7.615
// por semana, então enxergava as 3.000 mais ANTIGAS. A avaliação estava certa; a entrada
// dela é que vinha truncada pelo lado errado.
Deno.test("lista em ordem decrescente é avaliada corretamente", () => {
  const entradasDesc: number[] = [];
  for (let i = 0; i < 200; i++) entradasDesc.push(agora - i * 20 * 60_000);
  // a mais recente é `agora`; em ordem decrescente ela vem PRIMEIRO
  const r = avaliarSilencio(entradasDesc, [agora - H], agora);
  assertEquals(r.anormal, false, "recebeu agora há pouco: não pode alarmar");
  assertEquals(r.silencioAtualH < 0.1, true);
});
