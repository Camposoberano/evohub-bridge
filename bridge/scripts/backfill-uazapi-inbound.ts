// backfill-uazapi-inbound — recupera à mão mensagens de ENTRADA que estão na uazapi mas não
// na tabela `messages`.
//
// Contexto: 29/08/2026 (claim de dedup que não voltava no erro) e 11/09/2026 (6836 caído:
// o que chegou no aparelho entrou na uazapi por sincronização de histórico, sem webhook).
// Desde 11/09 o loop `uazapi-catchup` faz isto sozinho a cada 15 minutos; o script fica para
// janelas maiores ou para conferir.
//
// Usa o mesmo módulo do loop (shared/catchup-uazapi.ts): grava pelo `ingestInbound` direto,
// sem automação, e só em canal ATIVO.
//
// Rodar (a partir de bridge/):
//   deno run --allow-net --allow-env --env-file=../.env scripts/backfill-uazapi-inbound.ts
//   ...mesma linha com --apply para gravar de verdade. Sem --apply é simulação.
//   --horas=48 amplia a janela (padrão 24).
import { admin } from "../shared/supabase.ts";
import { recuperarEntradaUazapi } from "../shared/catchup-uazapi.ts";

const APPLY = Deno.args.includes("--apply");
const HORAS = Number(
  Deno.args.find((a) => a.startsWith("--horas="))?.split("=")[1] ?? "24",
);
const agora = Date.now();

console.log(
  `backfill uazapi — janela de ${HORAS}h — ${
    APPLY ? "APLICANDO" : "SIMULAÇÃO (use --apply para gravar)"
  }`,
);

const resultados = await recuperarEntradaUazapi(admin(), {
  apply: APPLY,
  agora,
  janelaFixa: { desde: agora - HORAS * 60 * 60 * 1000, ate: agora },
});

for (const r of resultados) {
  console.log(
    `· ${r.instancia} (${r.canal}): ${r.candidatas} de cliente na janela · ` +
      `${APPLY ? "recuperadas" : "a recuperar"} ${r.recuperadas} · puladas ${r.puladas} · ` +
      `falhas ${r.falhas}${r.truncado ? " · LISTA TRUNCADA, janela maior que o limite" : ""}`,
  );
  for (const a of r.amostras ?? []) console.log(`   [simulado] ${a}`);
}
console.log("\nresumo:", JSON.stringify(resultados.map(({ amostras: _, ...r }) => r)));
if (!APPLY) console.log("nada foi gravado — rode de novo com --apply");
