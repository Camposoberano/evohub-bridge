import { saudacaoDinamica } from "../handlers/funil-enroll.ts";

Deno.test("saudacao dinamica nunca inclui indice indefinido", () => {
  const timestamps = [
    0,
    2_147_483_648,
    1_784_697_675_000,
    9_999_999_999_999,
  ];

  for (const timestamp of timestamps) {
    const greeting = saudacaoDinamica(timestamp);
    if (!greeting.includes("Campo Soberano")) {
      throw new Error("saudacao sem identificacao do atendente");
    }
    if (/undefined/.test(greeting)) {
      throw new Error(`saudacao invalida para ${timestamp}: ${greeting}`);
    }
  }
});
