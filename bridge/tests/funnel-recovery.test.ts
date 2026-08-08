import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canAutoResume,
  rebasePausedSchedule,
  silentFollowupAt,
  stillBlocksCompletion,
} from "../shared/funnel-recovery.ts";

Deno.test("retomada preserva os intervalos restantes", () => {
  assertEquals(
    rebasePausedSchedule([
      "2026-07-18T10:00:00.000Z",
      "2026-07-18T10:02:00.000Z",
      "2026-07-18T11:00:00.000Z",
    ], Date.parse("2026-07-18T15:00:00.000Z")),
    [
      "2026-07-18T15:00:00.000Z",
      "2026-07-18T15:02:00.000Z",
      "2026-07-18T16:00:00.000Z",
    ],
  );
});

Deno.test("follow-up final conta dez horas úteis e pausa durante a noite", () => {
  const lastSentAt = Date.parse("2026-07-12T00:00:00.000Z"); // 21h BRT
  const now = lastSentAt;
  assertEquals(
    silentFollowupAt(lastSentAt, now),
    Date.parse("2026-07-12T18:00:00.000Z"), // 15h BRT do dia seguinte
  );
});

Deno.test("retoma apenas pausa automática recente e sem atividade", () => {
  const now = Date.parse("2026-07-18T18:00:00.000Z");
  assertEquals(
    canAutoResume({
      now,
      pauseAt: now - 100 * 60_000,
      lastActivityAt: now - 95 * 60_000,
      lastInboundAt: now - 2 * 60 * 60_000,
      pauseType: "auto_paused",
    }),
    true,
  );
  assertEquals(
    canAutoResume({
      now,
      pauseAt: now - 100 * 60_000,
      lastActivityAt: now - 95 * 60_000,
      lastInboundAt: now - 2 * 60 * 60_000,
      pauseType: "manual_paused",
    }),
    false,
  );
  assertEquals(
    canAutoResume({
      now,
      pauseAt: now - 8 * 60 * 60_000,
      lastActivityAt: now - 7 * 60 * 60_000,
      lastInboundAt: now - 7 * 60 * 60_000,
      pauseType: "auto_paused",
    }),
    false,
  );
});

// Não existe retry automático de scheduled_messages: funnel-queue marca 'failed' e segue.
// Enquanto 'failed' contava como pendente, a sequência nunca chegava a `completed` — e é a
// conclusão que agenda o follow-up e libera o lead pra recuperação. Em 08/08, 16 das 28
// sequências `running` estavam travadas assim, com falhas desde 15/07.
Deno.test("falha velha nao segura o funil; falha recente ainda segura", () => {
  const now = Date.parse("2026-08-08T18:00:00.000Z");
  const at = (ms: number) => new Date(now - ms).toISOString();

  assertEquals(stillBlocksCompletion({ status: "pending", send_at: at(0) }, now), true);
  assertEquals(stillBlocksCompletion({ status: "paused", send_at: at(0) }, now), true);
  assertEquals(stillBlocksCompletion({ status: "sent", sent_at: at(0) }, now), false);

  // dentro da carência: ainda pode ser retentado à mão, então segura
  assertEquals(
    stillBlocksCompletion({ status: "failed", send_at: at(23 * 60 * 60_000) }, now),
    true,
  );
  // passou de 24h sem retry: não volta sozinha, deixa o funil concluir
  assertEquals(
    stillBlocksCompletion({ status: "failed", send_at: at(25 * 60 * 60_000) }, now),
    false,
  );
  // caso real: falha de 15/07 travando a sequência há 24 dias
  assertEquals(
    stillBlocksCompletion({ status: "failed", send_at: "2026-07-15T20:13:55.993Z" }, now),
    false,
  );
  // sem data utilizável, prefere segurar a descartar em silêncio
  assertEquals(stillBlocksCompletion({ status: "failed" }, now), true);
});

// conversations.outcome é enum NOT NULL com default 'open' — 393 das 420 conversas estão
// nesse estado. A checagem antiga era `!input.outcome`, que dava falso pra todas e matou o
// auto-resume em silêncio (último auto_resumed: 01/08). 'open' é conversa viva.
Deno.test("outcome 'open' nao impede o auto-resume; won e lost impedem", () => {
  const now = Date.parse("2026-07-18T18:00:00.000Z");
  const base = {
    now,
    pauseAt: now - 100 * 60_000,
    lastActivityAt: now - 95 * 60_000,
    lastInboundAt: now - 2 * 60 * 60_000,
    pauseType: "auto_paused",
  };
  assertEquals(canAutoResume({ ...base, outcome: "open" }), true);
  assertEquals(canAutoResume({ ...base, outcome: null }), true);
  assertEquals(canAutoResume({ ...base, outcome: "won" }), false);
  assertEquals(canAutoResume({ ...base, outcome: "lost" }), false);
});
