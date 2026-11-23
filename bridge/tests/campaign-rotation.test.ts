import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type CampaignRotationSnapshot,
  chooseCampaignRotation,
} from "../shared/campaign-rotation.ts";

const createdAt = Date.parse("2026-10-21T04:39:10Z");
const pace = {
  capInicial: 25,
  capIncremento: 5,
  capMaximo: 100,
  horaInicio: 8,
  horaFim: 18,
};
const at = (hour: number, minute = 0) =>
  Date.parse(
    `2026-10-21T${String(hour + 3).padStart(2, "0")}:${
      String(minute).padStart(2, "0")
    }:00Z`,
  );

function snapshots(
  sent = [0, 0, 0, 0],
  last: Array<number | null> = [null, null, null, null],
): CampaignRotationSnapshot[] {
  return [
    "reativacao-5895-of",
    "reativacao-5895-uz",
    "reativacao-0595-uz",
    "reativacao-6836-uz",
  ]
    .map((campaignId, i) => ({
      campaignId,
      pending: 1000,
      sentToday: sent[i],
      lastSentAt: last[i],
      createdAt,
      pace,
    }));
}

Deno.test("quatro campanhas começam às 8h com um envio a cada seis minutos", () => {
  const first = chooseCampaignRotation(snapshots(), at(8));
  assertEquals(first?.number, "5895");
  assertEquals(first?.gapMs, 6 * 60_000);
  const oneSent = snapshots([1, 0, 0, 0], [at(8), null, null, null]);
  assertEquals(chooseCampaignRotation(oneSent, at(8, 5)), null);
  assertEquals(chooseCampaignRotation(oneSent, at(8, 6))?.number, "0595");
});

Deno.test("5895 respeita o teto próprio do oficial e dos botões", () => {
  const current = snapshots([50, 29, 25, 25]);
  current[0].pace = {
    ...pace,
    capInicial: 50,
    capIncremento: 0,
    capMaximo: 50,
  };
  current[1].pace = {
    ...pace,
    capInicial: 30,
    capIncremento: 0,
    capMaximo: 30,
  };
  assertEquals(
    chooseCampaignRotation(current, at(12))?.campaignId,
    "reativacao-5895-uz",
  );
  current[1].sentToday = 30;
  assertEquals(chooseCampaignRotation(current, at(12)), null);
  current[0].sentToday = 49;
  assertEquals(
    chooseCampaignRotation(current, at(12))?.campaignId,
    "reativacao-5895-of",
  );
});

Deno.test("0595 e 6836 atrasados recebem prioridade e intervalo menor hoje", () => {
  const delayed = snapshots([10, 5, 0, 0], [at(12), at(12, 5), null, null]);
  const decision = chooseCampaignRotation(delayed, at(12, 15));
  assertEquals(decision?.number, "0595");
  assertEquals((decision?.gapMs ?? 0) < 6 * 60_000, true);
});

Deno.test("fora de 08h a 18h nenhum número dispara", () => {
  assertEquals(chooseCampaignRotation(snapshots(), at(7, 59)), null);
  assertEquals(chooseCampaignRotation(snapshots(), at(18)), null);
});

Deno.test("nova campanha 5895 cresce até 6/12 e para antes de 7/12", () => {
  const start = Date.parse("2026-11-24T10:00:00Z");
  const row: CampaignRotationSnapshot = {
    campaignId: "mega-sorgo-5895-120d-2026-11-24",
    pending: 811,
    sentToday: 0,
    lastSentAt: null,
    createdAt: start,
    pace: {
      capInicial: 50, capIncremento: 0, capMaximo: 81, horaInicio: 7, horaFim: 19,
      dailyCaps: [50, 52, 54, 56, 58, 60, 63, 66, 69, 72, 75, 78, 81],
      endAt: "2026-12-06T22:00:00Z",
    },
  };
  assertEquals(chooseCampaignRotation([row], start - 60_000), null);
  assertEquals(chooseCampaignRotation([row], start)?.campaignId, row.campaignId);
  assertEquals(chooseCampaignRotation([{ ...row, sentToday: 50 }], start), null);
  assertEquals(chooseCampaignRotation([{ ...row, sentToday: 51 }], start + 86_400_000)?.cap, 52);
  assertEquals(chooseCampaignRotation([{ ...row, sentToday: 52 }], start + 86_400_000), null);
  assertEquals(chooseCampaignRotation([row], start + 12 * 86_400_000)?.cap, 81);
  assertEquals(chooseCampaignRotation([row], start + 13 * 86_400_000), null);
});
