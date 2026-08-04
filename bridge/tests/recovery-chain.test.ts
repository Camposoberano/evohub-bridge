import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ABANDONO_MS,
  dueRecoveryVariation,
  isAbandonedFunnel,
  RECOVERY_CHAIN_DAYS,
  withinRecoveryHours,
} from "../shared/recovery-chain.ts";

const DIA = 24 * 60 * 60_000;
const FIM = Date.parse("2026-08-01T12:00:00Z"); // funil terminou aqui

function decidir(over: Partial<Parameters<typeof dueRecoveryVariation>[0]>) {
  return dueRecoveryVariation({
    now: FIM + DIA,
    funnelEndedAt: FIM,
    lastInboundAt: null,
    lastRecoveryAt: null,
    sentVariations: [],
    outcome: null,
    ...over,
  });
}

Deno.test("cadencia e 1-2-4-7 dias", () => {
  assertEquals([...RECOVERY_CHAIN_DAYS], [1, 2, 4, 7]);
});

// 61 leads em 04/08 estavam num funil pausado ha mais de 72h: o funil nao anda (o
// auto-resume exige resposta nas ultimas 6h) e a recuperacao nao os via, porque so olhava
// sequencia 'completed'. Ficavam invisiveis pros dois sistemas.
Deno.test("funil pausado alem da janela entra na recuperacao", () => {
  const agora = FIM + DIA * 5;
  assertEquals(isAbandonedFunnel("completed", agora, FIM), true);
  assertEquals(isAbandonedFunnel("paused", agora, FIM), true);
});

// Mas pausa recente e atendimento em andamento -- mandar template por cima atropela o
// atendente que acabou de assumir a conversa.
Deno.test("pausa recente NAO entra: e conversa em atendimento", () => {
  const agora = FIM + ABANDONO_MS - 60_000;
  assertEquals(isAbandonedFunnel("paused", agora, FIM), false);
  assertEquals(isAbandonedFunnel("paused", FIM + ABANDONO_MS, FIM), true);
});

Deno.test("funil rodando ou cancelado nunca entra", () => {
  const agora = FIM + DIA * 10;
  for (const s of ["running", "cancelled", ""]) {
    assertEquals(isAbandonedFunnel(s, agora, FIM), false, `status ${s}`);
  }
});

Deno.test("so vence depois do dia 1", () => {
  assertEquals(decidir({ now: FIM + DIA * 0.9 }), null);
  assertEquals(decidir({ now: FIM + DIA }), 1);
});

// O pior erro possível: continuar caçando quem já comprou.
Deno.test("venda fechada ou perdida encerra a cadeia", () => {
  for (const outcome of ["won", "lost"]) {
    assertEquals(decidir({ now: FIM + DIA * 7, outcome }), null);
  }
});

// conversations.outcome é NOT NULL com default 'open' — 393 das 420 conversas estão
// assim. Tratar 'open' como encerramento desliga a cadeia inteira, que foi o bug que
// deixou o follow-up silencioso sem rodar nenhuma vez em 135 funis concluídos.
Deno.test("'open' e o estado normal, nao encerramento", () => {
  assertEquals(decidir({ outcome: "open" }), 1);
  assertEquals(decidir({ outcome: null }), 1);
  assertEquals(decidir({ outcome: undefined }), 1);
});

// Quem respondeu não está sumido — está em conversa. Mandar recuperação por cima é ruído.
Deno.test("lead que respondeu depois do funil sai da cadeia", () => {
  assertEquals(decidir({ lastInboundAt: FIM + 60_000 }), null);
  // resposta ANTES do fim do funil é o comportamento normal, não interrompe
  assertEquals(decidir({ lastInboundAt: FIM - 60_000 }), 1);
});

Deno.test("segue a ordem das variacoes, uma por vez", () => {
  assertEquals(decidir({ now: FIM + DIA * 2, sentVariations: [1] }), 2);
  assertEquals(decidir({ now: FIM + DIA * 4, sentVariations: [1, 2] }), 3);
  assertEquals(decidir({ now: FIM + DIA * 7, sentVariations: [1, 2, 3] }), 4);
  assertEquals(
    decidir({ now: FIM + DIA * 30, sentVariations: [1, 2, 3, 4] }),
    null,
  );
});

// Conversa parada há 10 dias tem as 4 datas vencidas. Sem essa trava o lead levaria as
// quatro mensagens em rajada, uma por rodada do loop (5 min) — vira denúncia de spam.
Deno.test("nao pula direto pra ultima variacao numa conversa antiga", () => {
  assertEquals(decidir({ now: FIM + DIA * 10 }), 1);
  assertEquals(decidir({ now: FIM + DIA * 10, sentVariations: [1] }), 2);
});

Deno.test("respeita gap minimo entre duas recuperacoes", () => {
  const now = FIM + DIA * 10;
  assertEquals(
    decidir({
      now,
      sentVariations: [1],
      lastRecoveryAt: now - 2 * 60 * 60_000,
    }),
    null,
    "duas recuperacoes no mesmo dia",
  );
  assertEquals(
    decidir({ now, sentVariations: [1], lastRecoveryAt: now - DIA }),
    2,
  );
});

Deno.test("conversa parada ha mais de 30 dias vira lista fria, nao recuperacao", () => {
  assertEquals(decidir({ now: FIM + DIA * 40 }), null);
  assertEquals(decidir({ now: FIM - 60_000 }), null, "futuro nao dispara");
});

// Recuperação é mensagem fria depois de dias calado. 6h da manhã, que o funil permite,
// aqui incomoda. Janela 8h-20h BRT (UTC-3).
Deno.test("so dispara em horario civilizado", () => {
  const brt = (h: number) => Date.UTC(2026, 7, 1, h + 3, 0, 0);
  assertEquals(withinRecoveryHours(brt(7)), false);
  assertEquals(withinRecoveryHours(brt(8)), true);
  assertEquals(withinRecoveryHours(brt(19)), true);
  assertEquals(withinRecoveryHours(brt(20)), false);
  assertEquals(withinRecoveryHours(brt(23)), false);
});
