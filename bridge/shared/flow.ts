// flow — núcleo do fluxo conversacional: manda, espera, ramifica pela resposta.
//
// O que existia era linear: `resumeCampaign` percorria `camp.steps` num for e mandava tudo
// de uma vez, sem esperar o lead falar. Serve para uma sequência de apresentação; não serve
// para conversa. Aqui o fluxo PARA num step de pergunta, guarda onde parou, e a resposta
// decide o próximo passo — que é a diferença entre disparar e conversar.
//
// Tudo aqui é puro e serializa em JSON, porque é isto que o editor visual vai produzir e
// o que fica salvo por campanha. Nada de envio, banco ou rede: quem envia é o flow-runner.

export type FlowButton = { id: string; title: string };
export type FlowSectionRow = { id: string; title: string; description?: string };
export type FlowSection = { title: string; rows: FlowSectionRow[] };

export type FlowStepKind =
  | "text"
  | "media"
  | "buttons"
  | "list"
  | "wait"
  | "end";

export type FlowStep = {
  id: string;
  kind: FlowStepKind;
  /** texto da mensagem (ou legenda, em `media`) */
  text?: string;
  /** kind=media */
  media?: {
    type: "image" | "video" | "audio" | "document";
    url: string;
    fileName?: string;
  };
  /** kind=buttons — o WhatsApp aceita no máximo 3 */
  buttons?: FlowButton[];
  /** imagem no topo do cartão de botões */
  imageUrl?: string;
  /** kind=list — no máximo 10 linhas por seção */
  sections?: FlowSection[];
  /** kind=wait — pausa por tempo, sem esperar resposta */
  minutes?: number;
  /** próximo step quando não há ramificação */
  next?: string;
  /** id do botão/linha clicada → step de destino */
  branches?: Record<string, string>;
  /** resposta que não casou com nenhum branch (texto livre, por exemplo) */
  fallbackNext?: string;
  /** desiste de esperar depois disso e segue por `onTimeout` */
  timeoutMin?: number;
  onTimeout?: string;
  /** kind=end — desfecho a gravar na conversa, se houver */
  outcome?: "won" | "lost";
};

export type Flow = {
  /** step por onde começa; default é o primeiro da lista */
  startId?: string;
  steps: FlowStep[];
};

/** Steps que param o fluxo aguardando o lead. `wait` pausa por tempo, não por resposta. */
export function esperaResposta(step: FlowStep): boolean {
  return step.kind === "buttons" || step.kind === "list";
}

export function stepById(flow: Flow, id: string): FlowStep | undefined {
  return flow.steps.find((s) => s.id === id);
}

export function primeiroStep(flow: Flow): FlowStep | undefined {
  return flow.startId ? stepById(flow, flow.startId) : flow.steps[0];
}

/**
 * Para onde ir depois de `step`, dada a resposta do lead.
 *
 * `replyId` é o id do botão ou da linha clicada. Texto livre chega como `null` e vai por
 * `fallbackNext` — quem digita em vez de clicar não pode ficar preso: era exatamente o
 * furo medido no funil, onde o cliente escrevia 22 vezes mais do que clicava e o bot só
 * ouvia clique.
 */
export function resolveNext(
  step: FlowStep,
  replyId: string | null,
): string | null {
  if (replyId && step.branches?.[replyId]) return step.branches[replyId];
  if (replyId === null && step.fallbackNext) return step.fallbackNext;
  // clicou num botão sem destino declarado: fallback antes de encerrar
  return step.fallbackNext ?? step.next ?? null;
}

/**
 * Steps a enviar AGORA, a partir de `fromId`, e onde o fluxo parou.
 *
 * Para em três situações: um step que espera resposta (já incluído na lista, porque a
 * pergunta precisa sair), um `wait` por tempo (não incluído — quem agenda é o runner), ou
 * o fim do fluxo.
 *
 * `guard` existe por segurança: fluxo montado no editor pode ter ciclo sem espera, e um
 * ciclo desses mandaria mensagem até a conta ser bloqueada. `validateFlow` recusa isso na
 * hora de salvar; este limite é a segunda barreira, para o caso de um fluxo antigo já
 * gravado.
 */
export function stepsUntilWait(
  flow: Flow,
  fromId: string,
): { enviar: FlowStep[]; pararEm: FlowStep | null; fim: boolean } {
  const enviar: FlowStep[] = [];
  const visitados = new Set<string>();
  let atual = stepById(flow, fromId);

  while (atual) {
    if (visitados.has(atual.id)) {
      // ciclo sem espera — para aqui em vez de repetir mensagem
      return { enviar, pararEm: null, fim: true };
    }
    visitados.add(atual.id);

    if (atual.kind === "end") return { enviar, pararEm: atual, fim: true };
    if (atual.kind === "wait") return { enviar, pararEm: atual, fim: false };

    enviar.push(atual);
    if (esperaResposta(atual)) return { enviar, pararEm: atual, fim: false };

    const proximo = atual.next ?? proximoNaOrdem(flow, atual.id);
    atual = proximo ? stepById(flow, proximo) : undefined;
  }
  return { enviar, pararEm: null, fim: true };
}

/** Sem `next` declarado, segue a ordem da lista — é o que o editor produz ao empilhar. */
function proximoNaOrdem(flow: Flow, id: string): string | null {
  const i = flow.steps.findIndex((s) => s.id === id);
  return i >= 0 && i + 1 < flow.steps.length ? flow.steps[i + 1].id : null;
}

export type FlowProblema = { stepId: string; problema: string };

/**
 * Recusa fluxo que quebraria em produção. Roda ao salvar, não ao enviar — o erro precisa
 * aparecer para quem está montando, não para o lead.
 *
 * O caso grave é o **ciclo sem espera**: A→B→A sem nenhuma pergunta no meio manda mensagem
 * até a conta cair. Os demais são erros de montagem que deixariam o lead num beco.
 */
export function validateFlow(flow: Flow): FlowProblema[] {
  const problemas: FlowProblema[] = [];
  const ids = new Set<string>();
  for (const s of flow.steps) {
    if (ids.has(s.id)) {
      problemas.push({ stepId: s.id, problema: "id repetido" });
    }
    ids.add(s.id);
  }
  if (!flow.steps.length) {
    return [{ stepId: "(fluxo)", problema: "fluxo sem nenhum step" }];
  }
  if (flow.startId && !ids.has(flow.startId)) {
    problemas.push({ stepId: flow.startId, problema: "startId não existe" });
  }

  for (const s of flow.steps) {
    const destinos = [
      s.next,
      s.fallbackNext,
      s.onTimeout,
      ...Object.values(s.branches ?? {}),
    ].filter(Boolean) as string[];
    for (const d of destinos) {
      if (!ids.has(d)) {
        problemas.push({ stepId: s.id, problema: `aponta para "${d}", que não existe` });
      }
    }
    if (s.kind === "buttons") {
      if (!s.buttons?.length) {
        problemas.push({ stepId: s.id, problema: "botões vazios" });
      }
      // limite do WhatsApp: 3 botões de resposta rápida
      if ((s.buttons?.length ?? 0) > 3) {
        problemas.push({
          stepId: s.id,
          problema: `${s.buttons?.length} botões; o WhatsApp aceita 3`,
        });
      }
    }
    if (s.kind === "list") {
      for (const sec of s.sections ?? []) {
        if (sec.rows.length > 10) {
          problemas.push({
            stepId: s.id,
            problema: `seção "${sec.title}" com ${sec.rows.length} linhas; o limite é 10`,
          });
        }
      }
    }
    if (s.kind === "media" && !s.media?.url) {
      problemas.push({ stepId: s.id, problema: "media sem url" });
    }
    if (s.kind === "text" && !s.text?.trim()) {
      problemas.push({ stepId: s.id, problema: "texto vazio" });
    }
    if (s.timeoutMin !== undefined && !s.onTimeout) {
      problemas.push({
        stepId: s.id,
        problema: "timeoutMin sem onTimeout — o lead ficaria esperando para sempre",
      });
    }
  }

  problemas.push(...ciclosSemEspera(flow));
  return problemas;
}

/**
 * Ciclo percorrível sem passar por pergunta ou pausa. É o defeito que manda mensagem em
 * rajada até a conta ser bloqueada, então é erro de salvar, não aviso.
 */
function ciclosSemEspera(flow: Flow): FlowProblema[] {
  const achados: FlowProblema[] = [];
  for (const inicio of flow.steps) {
    if (esperaResposta(inicio) || inicio.kind === "wait") continue;
    const visto = new Set<string>([inicio.id]);
    let atual: FlowStep | undefined = inicio;
    while (atual) {
      if (esperaResposta(atual) || atual.kind === "wait" || atual.kind === "end") {
        break;
      }
      const proximoId = atual.next ?? proximoNaOrdem(flow, atual.id);
      if (!proximoId) break;
      if (visto.has(proximoId)) {
        achados.push({
          stepId: inicio.id,
          problema:
            `ciclo sem pergunta nem pausa (volta em "${proximoId}") — mandaria mensagem sem parar`,
        });
        break;
      }
      visto.add(proximoId);
      atual = stepById(flow, proximoId);
    }
  }
  return achados;
}
