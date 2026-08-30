// loop-guard — impede que uma rodada de loop periódico comece sobre a anterior.
//
// Dos 21 loops de server.ts, 15 rodavam sem guarda nenhuma (auditoria de 29/08). O caso
// mais perigoso é o macro-command, que roda a cada 15s: se uma rodada demora mais que
// isso, o tick seguinte ainda enxerga a etiqueta `cmd-iniciar-funil` (ela só é removida no
// fim) e chama /funil-enroll com force:true, que APAGA e recria a fila. Dois ticks
// concorrentes podem enfileirar o funil inteiro em duplicidade e o lead receber tudo duas
// vezes.
//
// A guarda que os outros 6 loops já usavam (`let running` + try/finally) resolve exceção,
// mas não travamento: se a rodada nunca resolver — fetch sem timeout, por exemplo — a
// trava fica presa e o loop morre em silêncio, o que é pior que a sobreposição. Por isso
// aqui a trava EXPIRA: passado o limite, o próximo tick assume que a anterior se perdeu,
// avisa no log e segue. Preferimos uma sobreposição excepcional a um loop morto.

export type GuardaDeLoop = {
  /** true = pode executar agora (e marca como em execução). false = pular este tick. */
  tentarEntrar(agora?: number): boolean;
  /** libera a trava ao fim da rodada. Sempre chamar em finally. */
  sair(): void;
  /** exposto para teste/diagnóstico: desde quando a rodada atual roda (null = livre) */
  emExecucaoDesde(): number | null;
};

export function criarGuardaDeLoop(
  nome: string,
  travaMaximaMs: number,
  aoLiberarPresa: (nome: string, presaHaMs: number) => void = (n, ms) =>
    console.warn(
      `${n}: rodada anterior presa há ${Math.round(ms / 1000)}s — liberando a trava`,
    ),
): GuardaDeLoop {
  // null (e não 0) como "livre": 0 é um instante válido, e usá-lo como sentinela fazia a
  // trava se ler como livre logo depois de ser tomada.
  let desde: number | null = null;
  return {
    tentarEntrar(agora = Date.now()) {
      if (desde !== null) {
        const presaHa = agora - desde;
        if (presaHa < travaMaximaMs) return false;
        aoLiberarPresa(nome, presaHa);
      }
      desde = agora;
      return true;
    },
    sair() {
      desde = null;
    },
    emExecucaoDesde() {
      return desde;
    },
  };
}

/**
 * Agenda um loop periódico já protegido. Substitui o par
 * `setTimeout(tick, x); setInterval(tick, y)` espalhado pelo server.ts.
 *
 * `travaMaximaMs` padrão = 5 intervalos, com piso de 10 min: folgado o bastante para uma
 * rodada lenta terminar em paz, curto o bastante para o loop não ficar morto por horas.
 */
export function agendarLoop(
  nome: string,
  tarefa: () => Promise<void>,
  opts: {
    intervaloMs: number;
    primeiraEmMs?: number;
    travaMaximaMs?: number;
  },
): void {
  const guarda = criarGuardaDeLoop(
    nome,
    opts.travaMaximaMs ?? Math.max(opts.intervaloMs * 5, 10 * 60_000),
  );
  const executar = async () => {
    if (!guarda.tentarEntrar()) return;
    try {
      await tarefa();
    } catch (e) {
      console.error(`${nome} erro:`, e);
    } finally {
      guarda.sair();
    }
  };
  if (opts.primeiraEmMs !== undefined) setTimeout(executar, opts.primeiraEmMs);
  setInterval(executar, opts.intervaloMs);
}
