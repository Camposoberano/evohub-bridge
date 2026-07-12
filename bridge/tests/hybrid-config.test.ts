import {
  configuredChannel,
  type HybridConfig,
} from "../shared/hybrid-config.ts";

Deno.test("hybrid config keeps channel overrides isolated", () => {
  const config: HybridConfig = {
    channels: {
      officialA: { enabled: false, updatedAt: "2026-07-12T00:00:00.000Z" },
      officialB: {
        enabled: true,
        instance: "5895",
        updatedAt: "2026-07-12T00:00:00.000Z",
      },
    },
  };

  if (configuredChannel(config, "officialA")?.enabled !== false) {
    throw new Error("officialA should be disabled");
  }
  if (configuredChannel(config, "officialB")?.instance !== "5895") {
    throw new Error("officialB should use 5895");
  }
  if (configuredChannel(config, "missing") !== null) {
    throw new Error("missing channel should use legacy policy");
  }
});
