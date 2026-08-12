import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ABANDONO_MS,
  dueRecoveryVariation,
  isAbandonedFunnel,
  RECOVERY_CHAIN_DAYS,
  shouldMarkLostBySilence,
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

// O relógio conta do último sinal do lead. Quem acabou de falar tem silêncio ~0 e não
// recebe nada; quem falou e sumiu entra normalmente, contando dali.
Deno.test("cadencia conta a partir da ultima mensagem do lead", () => {
  // respondeu agora: nada vence, mesmo com o funil terminado ha um dia
  assertEquals(decidir({ lastInboundAt: FIM + DIA - 60_000 }), null);
  // resposta anterior ao fim do funil nao muda nada: vale o fim do funil
  assertEquals(decidir({ lastInboundAt: FIM - 60_000 }), 1);
  // respondeu no dia do funil e sumiu: um dia depois DELE, vence a variacao 1
  assertEquals(
    decidir({ now: FIM + DIA * 2, lastInboundAt: FIM + DIA }),
    1,
  );
});

// O caso dos 61 abandonados: funil pausado porque o lead falou, e ele sumiu depois. Medir
// so pelo fim do funil descartava todos eles.
Deno.test("lead que falou e sumiu ha semanas entra na cadeia", () => {
  const falouEm = FIM + DIA; // pausou o funil aqui
  assertEquals(
    decidir({
      now: falouEm + DIA * 8,
      funnelEndedAt: FIM,
      lastInboundAt: falouEm,
    }),
    1,
  );
});

// Contar o silêncio a partir do lead abriu esta brecha: lead responde ontem, Cicero
// atende hoje, e a variacao 1 vence -- o template entraria no meio da conversa dele.
Deno.test("nao entra por cima de atendente que esta falando com o lead", () => {
  assertEquals(decidir({ now: FIM + DIA * 5, emAtendimento: true }), null);
  assertEquals(decidir({ now: FIM + DIA * 5, emAtendimento: false }), 1);
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

// Ninguém declara desistência: em 11/08, das 871 conversas 831 estavam 'open' e a busca por
// recusa explícita devolveu só dois falsos positivos ("Não quero atrapalhar" e um lead de
// *Pará de* Minas). O produtor some em vez de dizer não — então 'lost' precisa vir do
// silêncio, senão nunca vem.
const AGORA = Date.parse("2026-09-15T12:00:00Z");
const TODAS = [1, 2, 3, 4];

function silencio(dias: number) {
  return AGORA - dias * DIA;
}

Deno.test("encerra por silencio so depois das 4 variacoes e dos 30 dias", () => {
  assertEquals(
    shouldMarkLostBySilence({
      now: AGORA,
      ultimoSinal: silencio(31),
      sentVariations: TODAS,
      outcome: "open",
    }),
    true,
  );
});

Deno.test("cadeia incompleta nao encerra, por mais velha que seja", () => {
  // recebeu 2 de 4: a história está pela metade, encerrar seria desistir antes de tentar
  assertEquals(
    shouldMarkLostBySilence({
      now: AGORA,
      ultimoSinal: silencio(90),
      sentVariations: [1, 2],
      outcome: "open",
    }),
    false,
  );
  // repetição da mesma variação não conta como cadeia completa
  assertEquals(
    shouldMarkLostBySilence({
      now: AGORA,
      ultimoSinal: silencio(90),
      sentVariations: [1, 1, 1, 1],
      outcome: "open",
    }),
    false,
  );
});

Deno.test("dentro dos 30 dias nao encerra — ainda pode responder", () => {
  assertEquals(
    shouldMarkLostBySilence({
      now: AGORA,
      ultimoSinal: silencio(29),
      sentVariations: TODAS,
      outcome: "open",
    }),
    false,
  );
});

// A trava que mais importa: marcar cliente como perdido some com ele do relatório de vendas.
Deno.test("nao sobrescreve desfecho decidido por gente", () => {
  for (const outcome of ["won", "lost"]) {
    assertEquals(
      shouldMarkLostBySilence({
        now: AGORA,
        ultimoSinal: silencio(60),
        sentVariations: TODAS,
        outcome,
      }),
      false,
    );
  }
  // 'open' é o default da coluna e significa conversa viva — esse sim pode encerrar
  assertEquals(
    shouldMarkLostBySilence({
      now: AGORA,
      ultimoSinal: silencio(60),
      sentVariations: TODAS,
      outcome: "open",
    }),
    true,
  );
});
