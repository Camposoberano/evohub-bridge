import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { criarGuardaDeLoop } from "../shared/loop-guard.ts";

// 15 dos 21 loops de server.ts rodavam sem guarda. O pior é o macro-command (15s): duas
// rodadas concorrentes chamam /funil-enroll com force:true, que apaga e recria a fila —
// o lead recebe o funil inteiro duas vezes.

Deno.test("segunda rodada é pulada enquanto a primeira não terminou", () => {
  const g = criarGuardaDeLoop("teste", 60_000, () => {});
  assertEquals(g.tentarEntrar(1_000), true);
  assertEquals(g.tentarEntrar(1_500), false);
  assertEquals(g.tentarEntrar(30_000), false);
  g.sair();
  assertEquals(g.tentarEntrar(31_000), true);
});

// A guarda ingênua (`let running` sem expiração), que os 6 loops já guardados usam, mata o
// loop para sempre se uma rodada nunca resolver. Aqui a trava expira.
Deno.test("trava presa expira e o loop volta a rodar", () => {
  const avisos: string[] = [];
  const g = criarGuardaDeLoop("teste", 60_000, (nome, ms) => {
    avisos.push(`${nome}:${ms}`);
  });
  assertEquals(g.tentarEntrar(0), true);
  // rodada travou e nunca chamou sair()
  assertEquals(g.tentarEntrar(59_000), false);
  assertEquals(avisos.length, 0);
  assertEquals(g.tentarEntrar(60_000), true, "no limite a trava é liberada");
  assertEquals(avisos, ["teste:60000"]);
});

Deno.test("sair() sempre libera, mesmo sem ter entrado", () => {
  const g = criarGuardaDeLoop("teste", 60_000, () => {});
  g.sair();
  assertEquals(g.emExecucaoDesde(), null);
  assertEquals(g.tentarEntrar(5), true);
  assertEquals(g.emExecucaoDesde(), 5);
});
