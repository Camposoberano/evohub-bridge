import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  confereSegredoDaFamilia,
  segredoDaFamilia,
  tokenInformado,
} from "../shared/segredo-bridge.ts";

// Separação do segredo único: rotas de envio e de manutenção ganham senha própria, e a
// senha do Chatwoot vale como RESERVA até ser desligada com BRIDGE_SECRET_FALLBACK=false.

const VARS = [
  "CHATWOOT_WEBHOOK_SECRET",
  "CHATWOOT_WEBHOOK_SECRET_NOVO",
  "BRIDGE_SEND_SECRET",
  "BRIDGE_OPS_SECRET",
  "BRIDGE_SECRET_FALLBACK",
];

function comEnv(vars: Record<string, string>, fn: () => void) {
  for (const k of VARS) Deno.env.delete(k);
  for (const [k, v] of Object.entries(vars)) Deno.env.set(k, v);
  try {
    fn();
  } finally {
    for (const k of VARS) Deno.env.delete(k);
  }
}

function capturaAvisos(fn: () => void): string[] {
  const avisos: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => avisos.push(args.join(" "));
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return avisos;
}

Deno.test("sem senha própria configurada, nada muda: vale a do Chatwoot, sem aviso", () => {
  comEnv({ CHATWOOT_WEBHOOK_SECRET: "cw" }, () => {
    const avisos = capturaAvisos(() => {
      assertEquals(confereSegredoDaFamilia("cw", "envio", "t-a"), true);
      assertEquals(confereSegredoDaFamilia("outra", "envio", "t-a"), false);
    });
    assertEquals(avisos, []);
    assertEquals(segredoDaFamilia("envio"), "cw");
  });
});

Deno.test("com senha própria: ela vale, e a do Chatwoot vale como reserva com aviso", () => {
  comEnv({ CHATWOOT_WEBHOOK_SECRET: "cw", BRIDGE_SEND_SECRET: "envio-novo" }, () => {
    const avisos = capturaAvisos(() => {
      assertEquals(confereSegredoDaFamilia("envio-novo", "envio", "t-b"), true);
      assertEquals(confereSegredoDaFamilia("cw", "envio", "t-b", 1_000_000), true);
      // segundo uso logo depois não repete o aviso
      assertEquals(confereSegredoDaFamilia("cw", "envio", "t-b", 1_000_100), true);
      assertEquals(confereSegredoDaFamilia("errada", "envio", "t-b"), false);
    });
    assertEquals(avisos.length, 1);
    assertEquals(avisos[0].includes("t-b") && avisos[0].includes("BRIDGE_SEND_SECRET"), true);
    // o próprio bridge passa a usar a senha nova nas chamadas internas
    assertEquals(segredoDaFamilia("envio"), "envio-novo");
  });
});

Deno.test("senha de uma família não abre a outra", () => {
  comEnv({
    CHATWOOT_WEBHOOK_SECRET: "cw",
    BRIDGE_SEND_SECRET: "envio-novo",
    BRIDGE_OPS_SECRET: "ops-novo",
  }, () => {
    assertEquals(confereSegredoDaFamilia("ops-novo", "envio", "t-c"), false);
    assertEquals(confereSegredoDaFamilia("envio-novo", "manutencao", "t-c"), false);
    assertEquals(confereSegredoDaFamilia("ops-novo", "manutencao", "t-c"), true);
  });
});

Deno.test("BRIDGE_SECRET_FALLBACK=false corta a reserva do Chatwoot", () => {
  comEnv({
    CHATWOOT_WEBHOOK_SECRET: "cw",
    BRIDGE_SEND_SECRET: "envio-novo",
    BRIDGE_SECRET_FALLBACK: "false",
  }, () => {
    capturaAvisos(() => {
      assertEquals(confereSegredoDaFamilia("cw", "envio", "t-d"), false);
    });
    assertEquals(confereSegredoDaFamilia("envio-novo", "envio", "t-d"), true);
  });
});

Deno.test("token vazio nunca passa, mesmo sem senha configurada", () => {
  comEnv({}, () => {
    assertEquals(confereSegredoDaFamilia("", "envio", "t-e"), false);
    assertEquals(confereSegredoDaFamilia(undefined, "manutencao", "t-e"), false);
  });
});

Deno.test("a senha pode vir no cabeçalho x-bridge-token ou em ?token=", () => {
  assertEquals(
    tokenInformado(
      new Request("http://x/send-outbound?token=q", { headers: { "x-bridge-token": "h" } }),
    ),
    "h",
  );
  assertEquals(tokenInformado(new Request("http://x/send-outbound?token=q")), "q");
  assertEquals(tokenInformado(new Request("http://x/send-outbound")), "");
});
