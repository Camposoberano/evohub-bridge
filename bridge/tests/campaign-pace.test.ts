import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  capDoDia,
  dentroDaJanela,
  intervaloMs,
  PACE_PADRAO,
  podeEnviarAgora,
} from "../shared/campaign-pace.ts";

const DIA = 24 * 60 * 60_000;
const INICIO = Date.parse("2026-08-15T11:00:00.000Z"); // 8h BRT

// Plano definido pela operação: 50 no primeiro dia, +15 por dia, teto 200.
Deno.test("rampa sobe 15 por dia e para em 200", () => {
  assertEquals(capDoDia(PACE_PADRAO, INICIO, INICIO), 50);
  assertEquals(capDoDia(PACE_PADRAO, INICIO, INICIO + DIA), 65);
  assertEquals(capDoDia(PACE_PADRAO, INICIO, INICIO + 2 * DIA), 80);
  // 50 + 10*15 = 200 no décimo dia
  assertEquals(capDoDia(PACE_PADRAO, INICIO, INICIO + 10 * DIA), 200);
  // e não passa disso por mais que o tempo corra
  assertEquals(capDoDia(PACE_PADRAO, INICIO, INICIO + 60 * DIA), 200);
});

// Espalhar importa mais que o total: 200 em 14h passam despercebidas, 200 em 2h são rajada.
Deno.test("intervalo espalha o teto pela janela inteira", () => {
  // 14h / 50 contatos = 16,8 min
  assertEquals(Math.round(intervaloMs(PACE_PADRAO, 50) / 60_000), 17);
  // 14h / 200 = 4,2 min
  assertEquals(Math.round(intervaloMs(PACE_PADRAO, 200) / 60_000), 4);
});

Deno.test("janela e 8h-22h BRT", () => {
  const brt = (h: number) => Date.parse(`2026-08-15T${String(h + 3).padStart(2, "0")}:00:00.000Z`);
  assertEquals(dentroDaJanela(PACE_PADRAO, brt(7)), false);
  assertEquals(dentroDaJanela(PACE_PADRAO, brt(8)), true);
  assertEquals(dentroDaJanela(PACE_PADRAO, brt(21)), true);
  assertEquals(dentroDaJanela(PACE_PADRAO, brt(22)), false);
});

Deno.test("as tres travas, na ordem, e cada uma diz o porque", () => {
  const base = {
    cfg: PACE_PADRAO,
    inicioCampanha: INICIO,
    enviadosHoje: 0,
    ultimoEnvioAt: null,
    now: INICIO,
  };
  // primeiro contato do dia, dentro da janela: manda
  assertEquals(podeEnviarAgora(base), { enviar: true });

  // fora da janela vence tudo
  assertEquals(
    podeEnviarAgora({ ...base, now: Date.parse("2026-08-15T04:00:00.000Z") }),
    { enviar: false, motivo: "fora-da-janela" },
  );

  // teto do dia atingido
  assertEquals(
    podeEnviarAgora({ ...base, enviadosHoje: 50 }),
    { enviar: false, motivo: "teto-do-dia" },
  );

  // acabou de mandar: espera o intervalo
  assertEquals(
    podeEnviarAgora({ ...base, enviadosHoje: 1, ultimoEnvioAt: INICIO - 60_000 }),
    { enviar: false, motivo: "aguardando-intervalo" },
  );

  // passou o intervalo (17 min com teto 50): libera
  assertEquals(
    podeEnviarAgora({ ...base, enviadosHoje: 1, ultimoEnvioAt: INICIO - 18 * 60_000 }),
    { enviar: true },
  );
});

// O teto sobe com os dias, então o intervalo aperta junto — e o dia inteiro continua cabendo
// na janela. Se o intervalo não acompanhasse, o teto nunca seria alcançado.
Deno.test("teto maior encurta o intervalo, e o dia cabe na janela", () => {
  for (const cap of [50, 65, 110, 200]) {
    const total = intervaloMs(PACE_PADRAO, cap) * cap;
    const janela = 14 * 60 * 60_000;
    if (total > janela) {
      throw new Error(`cap ${cap}: ${total}ms nao cabe em ${janela}ms de janela`);
    }
  }
});

Deno.test("rampa até 6 de dezembro para às 19h de Fortaleza", () => {
  const start = Date.parse("2026-11-24T10:00:00Z");
  const cfg = {
    capInicial: 50, capIncremento: 0, capMaximo: 81,
    horaInicio: 7, horaFim: 19,
    dailyCaps: [50, 52, 54, 56, 58, 60, 63, 66, 69, 72, 75, 78, 81],
    endAt: "2026-12-06T22:00:00Z",
  };
  assertEquals(capDoDia(cfg, start, start), 50);
  assertEquals(capDoDia(cfg, start, start + 6 * DIA), 63);
  assertEquals(capDoDia(cfg, start, start + 12 * DIA), 81);
  assertEquals(capDoDia(cfg, start, Date.parse(cfg.endAt)), 0);
  assertEquals(dentroDaJanela(cfg, Date.parse(cfg.endAt) - 60_000), true);
  assertEquals(dentroDaJanela(cfg, Date.parse(cfg.endAt)), false);
  assertEquals(dentroDaJanela(cfg, Date.parse(cfg.endAt) + DIA - 12 * 60 * 60_000), false);
});
