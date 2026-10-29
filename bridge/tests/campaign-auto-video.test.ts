import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { autoVideoDue } from "../shared/campaign-auto-video.ts";
import type { Campaign } from "../shared/campaigns.ts";

const campaign = {
  id: "reativacao-5895-uz",
  createdAt: "2026-10-22T03:00:00Z",
  pace: { horaInicio: 8, horaFim: 18 },
  autoVideoAfterMin: 60,
} as Campaign;
const waitingSince = "2026-10-28T10:00:00Z";

Deno.test("vídeo sem resposta espera uma hora e respeita 8h–18h BRT", () => {
  assertEquals(
    autoVideoDue(campaign, waitingSince, Date.parse("2026-10-28T10:59:00Z")),
    false,
  );
  assertEquals(
    autoVideoDue(campaign, waitingSince, Date.parse("2026-10-28T11:00:00Z")),
    true,
  );
  assertEquals(
    autoVideoDue(campaign, waitingSince, Date.parse("2026-10-28T21:00:00Z")),
    false,
  );
});

Deno.test("campanha sem liberação configurada não envia vídeo automaticamente", () => {
  assertEquals(
    autoVideoDue(
      { ...campaign, autoVideoAfterMin: undefined },
      waitingSince,
      Date.parse("2026-10-28T12:00:00Z"),
    ),
    false,
  );
});
