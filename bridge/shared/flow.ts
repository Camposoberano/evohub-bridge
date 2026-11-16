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
  | "cta"
  | "condition"
  | "transfer"
  | "ai"
  | "action"
  | "api"
  | "input"
  | "goto"
  | "template"
  | "wait"
  | "end";

/**
 * kind=input — pergunta aberta: manda `text`, ESPERA a resposta livre do lead e GRAVA o que
 * ele digitou numa variável (`input.var`), que os próximos steps interpolam via `{{var}}`. É o
 * que o `ai` NÃO faz (aquele classifica e descarta o texto). Captura é efeito impuro (grava no
 * contato) — o runner puro só manda a pergunta e para; quem grava é o chamador (flow-inbound).
 * `tipo:"numero"` limpa a resposta pra dígitos. Sempre segue por `next`/`fallbackNext` (não
 * ramifica); com `timeoutMin`+`onTimeout` pra não prender quem não responde.
 */
export type FlowInput = {
  /** nome da variável onde guardar a resposta (ex.: "nome_completo", "cidade") */
  var: string;
  tipo?: "texto" | "numero";
};

/**
 * kind=action — nó de lógica que mexe no contato/conversa sem mandar mensagem e segue adiante.
 * Aplica/remove etiquetas e pode atualizar o nome do contato. Quem executa é o runner via
 * callback (precisa de banco/Chatwoot) — `flow.ts` continua puro.
 */
export type FlowAction = {
  addLabels?: string[];
  removeLabels?: string[];
  setNome?: string;
};

/**
 * kind=api — chamada HTTP a um destino PRÉ-APROVADO (allowlist por env `FLOW_API_ALLOWLIST`).
 * Fire-and-forget: manda os dados do contato pro n8n/CRM e segue; não captura resposta (o
 * estado não persiste variáveis entre passos). Headers podem referenciar segredo por
 * `{{env.NOME}}`, resolvido na hora do envio — segredo nunca fica no JSON do fluxo.
 */
export type FlowApi = {
  method?: "GET" | "POST";
  url: string;
  headers?: Record<string, string>;
  /** corpo (POST) — texto com `{{var}}` do contato interpolado; default = JSON dos vars */
  bodyTemplate?: string;
  timeoutMs?: number;
};

/** Regra de um nó de condição. Avaliada contra as variáveis do contato (nome, telefone, …). */
export type FlowCond = {
  field: string;
  op: "igual" | "diferente" | "contem" | "existe" | "vazio";
  value?: string;
};

/**
 * Abridor oficial de janela fria. Lista fria no WhatsApp oficial tem a janela de 24h
 * fechada: a Meta recusa texto/mídia/botão interativo e SÓ aceita um template aprovado
 * (ver flow-runner). Este step manda esse template (com os botões quick-reply que já estão
 * aprovados nele) e ESPERA o clique, igual a um `buttons`. O header de imagem é preenchido
 * no envio por `headerMedia`. Só sai pelo canal oficial — nunca pela uazapi.
 */
export type FlowTemplate = {
  /** nome do template aprovado na Meta (por WABA) */
  name: string;
  /** código do idioma, ex.: "pt_BR" */
  language?: string;
  /** header de mídia preenchido no envio (a imagem que faz o lead lembrar da marca) */
  headerMedia?: { type: "image" | "video" | "document"; url: string };
};

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
  /** kind=template — abridor oficial de janela fria (ver FlowTemplate) */
  template?: FlowTemplate;
  /** etiquetas aplicadas à conversa depois que a saída for aceita pelo provedor */
  labels?: string[];
  /**
   * Ao enviar este step, registra pedido de humano: pausa o funil SEM prazo, levanta o
   * alerta e atribui ao Cícero. É o mesmo handoff do funil ramificado (shared/pedido-humano),
   * mas disparado de dentro do fluxo — a resposta da campanha passa por `continueFlowOnReply`,
   * não por `handleMenuClick`, então sem isto o lead que pede cotação ficaria só com etiqueta.
   * `handoffContexto` entra no evento `pediu_humano` (ex.: { area_hectares: 2 }).
   */
  pedirHumano?: boolean;
  handoffContexto?: Record<string, unknown>;
  /** kind=buttons — o WhatsApp aceita no máximo 3 */
  buttons?: FlowButton[];
  /** imagem no topo do cartão de botões */
  imageUrl?: string;
  /** Lista de imagens rotativas; cada contato mantém a mesma escolha em todas as tentativas. */
  imageUrls?: string[];
  /** kind=list — no máximo 10 linhas por seção */
  sections?: FlowSection[];
  /** kind=cta — botão que abre um link (interactive cta_url no oficial; texto+link na uazapi) */
  ctaText?: string;
  ctaUrl?: string;
  /** kind=condition — ramifica por `branches.sim` / `branches.nao` conforme a regra */
  cond?: FlowCond;
  /**
   * kind=ai — manda a pergunta (`text`), espera a resposta livre, e o Jev classifica numa das
   * `opcoes`. Ramifica por `branches[opcao.id]`; confiança abaixo de `minConfianca` (ou erro/sem
   * chave) → `branches.fallback` (tipicamente Transferir humano).
   */
  ai?: {
    instrucao?: string;
    opcoes?: { id: string; titulo?: string; descricao?: string }[];
    minConfianca?: number;
  };
  /** kind=action — etiquetas/campos a mexer no contato antes de seguir */
  contatoAcao?: FlowAction;
  /** kind=api — chamada HTTP a destino pré-aprovado antes de seguir */
  api?: FlowApi;
  /** kind=input — pergunta aberta: grava a resposta livre do lead em `input.var` */
  input?: FlowInput;
  /** kind=transfer — id do TIME do Chatwoot pra encaminhar a conversa (além do bot-off) */
  transferTeamId?: number;
  /**
   * kind=transfer — resumo pro consultor como NOTA PRIVADA no Chatwoot (só o time vê, não vai pro
   * lead) no momento da transferência. `true` = monta sozinho com os dados capturados no fluxo
   * (variáveis do contato) + as etiquetas do funil aplicadas. String = modelo com `{{var}}`
   * interpolado (ex.: "Nome: {{nome_completo}} · Cidade: {{cidade}}").
   * Assim o consultor assume a conversa já com os dados capturados na mão.
   */
  resumo?: boolean | string;
  /**
   * kind=transfer — resumo QUALIFICADO: antes de postar a nota, o Jev lê os dados capturados +
   * etiquetas e classifica a TEMPERATURA do lead (quente/morno/frio). A nota do consultor ganha
   * esse cabeçalho (ex.: "🔥 QUENTE") além dos dados. Jev é julgamento, não texto:
   * código monta a frase. Sem chave / baixa confiança → cai no resumo simples (nunca trava).
   * Superset de `resumo` — quando ligado, dispensa o `resumo` (a nota já traz os dados).
   */
  qualificarIA?: boolean;
  /** kind=goto — id do fluxo publicado para onde saltar (exige migration flow_ref) */
  gotoFlowId?: string;
  /** kind=wait — pausa por tempo, sem esperar resposta */
  minutes?: number;
  /**
   * Pausa ANTES de enviar este step, em segundos. Na rota uazapi vira o campo `delay`, que
   * mostra "digitando…" durante a espera — é o que faz a sequência parecer conversa em vez
   * de rajada. Sem isso as peças saem coladas e o lead recebe tudo de uma vez.
   *
   * Diferente de `kind: "wait"`: aquele encerra a execução e depende de agendamento externo
   * (hoje NÃO implementado — o fluxo para e ninguém retoma). Para segundos ou poucos
   * minutos dentro do mesmo bloco, é este campo que se usa.
   */
  delaySeg?: number;
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
  /** Quando true, uma falha no UAZAPI não cai silenciosamente no envio oficial da Meta. */
  uazapiOnly?: boolean;
};

/** Steps que param o fluxo aguardando o lead. `wait` pausa por tempo, não por resposta. */
export function esperaResposta(step: FlowStep): boolean {
  return step.kind === "buttons" || step.kind === "list" ||
    step.kind === "ai" || step.kind === "input" || step.kind === "template";
}

export function stepById(flow: Flow, id: string): FlowStep | undefined {
  return flow.steps.find((s) => s.id === id);
}

/**
 * Variáveis que ESTE fluxo captura (nós `input`), na ordem em que aparecem. É o allowlist do
 * resumo pro consultor: só o que o fluxo perguntou — nada do lixo de perfil (avatar, channel_id,
 * source_id…) que o sync grava em `contacts.attributes`.
 */
export function varsDeInput(flow: Flow): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const s of flow.steps) {
    const v = s.input?.var?.trim();
    if (v && !vistos.has(v)) { vistos.add(v); out.push(v); }
  }
  return out;
}

export function primeiroStep(flow: Flow): FlowStep | undefined {
  return flow.startId ? stepById(flow, flow.startId) : flow.steps[0];
}

function normReply(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Opções do step em ORDEM (botões, depois linhas das seções). É a mesma ordem que o menu
 * numerado em texto usa pra mostrar "1. … 2. …", pra o número que o lead digita casar certo.
 */
export function opcoesOrdenadas(step: FlowStep): { id: string; title: string }[] {
  const out: { id: string; title: string }[] = [];
  for (const b of step.buttons ?? []) out.push({ id: b.id, title: b.title ?? b.id });
  for (const sec of step.sections ?? []) {
    for (const row of sec.rows ?? []) out.push({ id: row.id, title: row.title ?? row.id });
  }
  return out;
}

/**
 * Casa a resposta do lead com uma opção do step — por ID ou por TÍTULO. Existe porque a Uazapi,
 * em algumas versões, devolve só o TÍTULO visível do botão/linha (não o id que mandamos). Sem
 * isto, clicar num botão de fluxo data-driven não casava nenhum ramo e a conversa parava.
 */
function optionIdByReply(step: FlowStep, reply: string): string | null {
  const r = normReply(reply);
  for (const b of step.buttons ?? []) {
    if (b.id === reply || normReply(b.title) === r) return b.id;
  }
  for (const sec of step.sections ?? []) {
    for (const row of sec.rows ?? []) {
      if (row.id === reply || normReply(row.title) === r) return row.id;
    }
  }
  // Menu numerado em texto (fallback do interativo): o lead responde "2" → 2ª opção.
  if (/^\d{1,2}$/.test(r)) {
    const ops = opcoesOrdenadas(step);
    const n = Number(r);
    if (n >= 1 && n <= ops.length) return ops[n - 1].id;
  }
  return null;
}

/** Opção (id) que a resposta casa — por id, título normalizado OU número de posição; null se nenhuma. */
export function matchOption(step: FlowStep, reply: string | null | undefined): string | null {
  return reply == null ? null : optionIdByReply(step, reply);
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
  if (replyId) {
    if (step.branches?.[replyId]) return step.branches[replyId];
    // a Uazapi pode devolver o título em vez do id — tenta casar por título
    const optId = optionIdByReply(step, replyId);
    if (optId && step.branches?.[optId]) return step.branches[optId];
  }
  if (replyId === null && step.fallbackNext) return step.fallbackNext;
  // clicou/digitou sem destino declarado: fallback antes de encerrar
  return step.fallbackNext ?? step.next ?? null;
}

/**
 * Avalia a regra de um nó de condição contra as variáveis do contato. Puro. Retorna o ramo
 * ("sim"/"nao") — quem segue por `branches[ramo]` é o runner. Comparação sem acento/caixa.
 */
export function avaliarCondicao(step: FlowStep, vars: Record<string, string>): "sim" | "nao" {
  const c = step.cond;
  if (!c?.field) return "nao";
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  const v = (vars[c.field.toLowerCase()] ?? "").trim();
  const alvo = c.value ?? "";
  let ok = false;
  switch (c.op) {
    case "existe": ok = v !== ""; break;
    case "vazio": ok = v === ""; break;
    case "igual": ok = norm(v) === norm(alvo); break;
    case "diferente": ok = norm(v) !== norm(alvo); break;
    case "contem": ok = alvo !== "" && norm(v).includes(norm(alvo)); break;
  }
  return ok ? "sim" : "nao";
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
    // Nós de lógica que não enviam mensagem: param aqui e o runner age (avalia/executa) e
    // depois segue. Condição ramifica; Ação mexe no contato; Chamada API chama HTTP; Ir-para
    // salta pra outro fluxo. Nenhum deles empilha peça em `enviar`.
    if (
      atual.kind === "condition" || atual.kind === "action" ||
      atual.kind === "api" || atual.kind === "goto"
    ) return { enviar, pararEm: atual, fim: false };
    // Transferir humano: manda a mensagem de handoff (se houver), aplica a etiqueta bot-off
    // (via step.labels no onSent) e ENCERRA o fluxo — o atendente assume, o bot cala.
    if (atual.kind === "transfer") { enviar.push(atual); return { enviar, pararEm: atual, fim: true }; }

    enviar.push(atual);
    if (esperaResposta(atual)) return { enviar, pararEm: atual, fim: false };

    const proximo = atual.next ?? proximoNaOrdem(flow, atual.id);
    atual = proximo ? stepById(flow, proximo) : undefined;
  }
  return { enviar, pararEm: null, fim: true };
}

/**
 * Steps que só se alcança por escolha: destino de `branches`, `fallbackNext` ou `onTimeout`.
 * Cada um começa um RAMO.
 */
function alvosDeRamificacao(flow: Flow): Set<string> {
  const alvos = new Set<string>();
  for (const s of flow.steps) {
    for (const d of Object.values(s.branches ?? {})) alvos.add(d);
    if (s.fallbackNext) alvos.add(s.fallbackNext);
    if (s.onTimeout) alvos.add(s.onTimeout);
  }
  return alvos;
}

/**
 * Sem `next` declarado, segue a ordem da lista — é o que o editor produz ao empilhar
 * mensagens numa sequência.
 *
 * MAS para antes de um step que é destino de ramificação: aquele é o começo de outro
 * caminho, e só se chega lá escolhendo. Sem essa regra os ramos vazam um no outro — num
 * fluxo `[oi, p, ok, ops, lembrete]`, quem clicasse "Sim" receberia `ok`, depois `ops` (a
 * resposta do "Não") e ainda o `lembrete` do timeout. Aconteceu no primeiro teste real:
 * três mensagens contraditórias de uma vez.
 */
function proximoNaOrdem(flow: Flow, id: string): string | null {
  const i = flow.steps.findIndex((s) => s.id === id);
  if (i < 0 || i + 1 >= flow.steps.length) return null;
  const proximo = flow.steps[i + 1];
  if (alvosDeRamificacao(flow).has(proximo.id)) return null;
  return proximo.id;
}

/**
 * Próximo step depois de `step` quando ele não ramifica: `next` explícito ou a ordem da lista.
 * Usado pelos nós sem mensagem (wait/action/api) para o runner saber por onde seguir.
 */
export function proximoDe(flow: Flow, step: FlowStep): string | null {
  return step.next ?? proximoNaOrdem(flow, step.id);
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
      // a Meta recusa títulos de botão repetidos no mesmo cartão
      const titulos = (s.buttons ?? []).map((b) => (b.title ?? "").trim().toLowerCase());
      if (new Set(titulos).size !== titulos.length) {
        problemas.push({ stepId: s.id, problema: "títulos de botão repetidos — a Meta exige títulos únicos" });
      }
      // corpo da mensagem interativa: 1024 no WhatsApp
      if ((s.text?.length ?? 0) > 1024) {
        problemas.push({ stepId: s.id, problema: `texto com ${s.text!.length} caracteres; o limite do WhatsApp é 1024` });
      }
    }
    if (s.kind === "list") {
      const secs = s.sections ?? [];
      // WhatsApp: até 10 seções e NO MÁXIMO 10 linhas somando TODAS as seções (não 10 por seção).
      if (secs.length > 10) {
        problemas.push({ stepId: s.id, problema: `${secs.length} seções; o WhatsApp aceita 10` });
      }
      if (!s.text?.trim()) {
        problemas.push({ stepId: s.id, problema: "lista sem mensagem — escreva o texto antes de publicar" });
      }
      if (secs.some((sec) => !sec.title?.trim())) {
        problemas.push({ stepId: s.id, problema: "lista com seção sem título" });
      }
      const rows = secs.flatMap((sec) => sec.rows ?? []);
      if (rows.some((row) => !row.title?.trim())) {
        problemas.push({ stepId: s.id, problema: "lista com item sem título" });
      }
      if (new Set(rows.map((row) => row.id)).size !== rows.length) {
        problemas.push({ stepId: s.id, problema: "lista com IDs de item repetidos" });
      }
      const totalLinhas = secs.reduce((n, sec) => n + (sec.rows?.length ?? 0), 0);
      if (totalLinhas === 0) {
        problemas.push({ stepId: s.id, problema: "lista sem nenhuma linha" });
      }
      if (totalLinhas > 10) {
        problemas.push({ stepId: s.id, problema: `${totalLinhas} linhas no total; o WhatsApp aceita 10 somando todas as seções` });
      }
      if ((s.text?.length ?? 0) > 1024) {
        problemas.push({ stepId: s.id, problema: `texto com ${s.text!.length} caracteres; o limite do WhatsApp é 1024` });
      }
    }
    if (s.kind === "media" && !s.media?.url) {
      problemas.push({ stepId: s.id, problema: "media sem url" });
    }
    if (s.kind === "condition") {
      if (!s.cond?.field) problemas.push({ stepId: s.id, problema: "condição sem campo" });
      if (s.cond && (s.cond.op === "igual" || s.cond.op === "diferente" || s.cond.op === "contem") && !s.cond.value?.trim()) {
        problemas.push({ stepId: s.id, problema: "condição sem valor para comparar" });
      }
      if (!s.branches?.sim && !s.branches?.nao) {
        problemas.push({ stepId: s.id, problema: "condição sem saída sim/não ligada" });
      }
    }
    if (s.kind === "ai") {
      if (!s.text?.trim()) problemas.push({ stepId: s.id, problema: "agente IA sem a pergunta (texto)" });
      const ops = s.ai?.opcoes ?? [];
      if (ops.length < 2) problemas.push({ stepId: s.id, problema: "agente IA precisa de ao menos 2 opções" });
      for (const o of ops) {
        if (!o.id) problemas.push({ stepId: s.id, problema: "opção do agente IA sem id" });
        else if (!s.branches?.[o.id]) problemas.push({ stepId: s.id, problema: `opção "${o.titulo ?? o.id}" sem ramo ligado` });
      }
      if (!s.branches?.fallback) problemas.push({ stepId: s.id, problema: "agente IA sem saída de fallback (baixa confiança) ligada" });
    }
    if (s.kind === "action") {
      const a = s.contatoAcao;
      const temAlgo = (a?.addLabels?.length ?? 0) > 0 || (a?.removeLabels?.length ?? 0) > 0 || !!a?.setNome?.trim();
      if (!temAlgo) problemas.push({ stepId: s.id, problema: "ação de contato sem nada a fazer (etiqueta ou nome)" });
    }
    if (s.kind === "input") {
      if (!s.text?.trim()) problemas.push({ stepId: s.id, problema: "pergunta aberta sem a mensagem (texto)" });
      if (!s.input?.var?.trim()) problemas.push({ stepId: s.id, problema: "pergunta aberta sem a variável onde guardar a resposta" });
      else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s.input.var.trim())) {
        problemas.push({ stepId: s.id, problema: `variável "${s.input.var}" inválida — use letras, números e _ (sem espaço/acento)` });
      }
      // precisa de saída: segue por next ou fallbackNext (não ramifica por resposta)
      if (!s.next && !s.fallbackNext) problemas.push({ stepId: s.id, problema: "pergunta aberta sem próximo passo (next)" });
    }
    if (s.kind === "api") {
      const u = s.api?.url?.trim() ?? "";
      if (!u) problemas.push({ stepId: s.id, problema: "chamada API sem URL" });
      else if (!/^https?:\/\//i.test(u)) problemas.push({ stepId: s.id, problema: "URL da chamada API deve começar com http:// ou https://" });
    }
    if (s.kind === "goto") {
      if (!s.gotoFlowId?.trim()) problemas.push({ stepId: s.id, problema: "ir-para-fluxo sem fluxo de destino" });
    }
    if (s.kind === "cta") {
      if (!s.text?.trim()) problemas.push({ stepId: s.id, problema: "botão de link sem mensagem" });
      if (!s.ctaText?.trim()) problemas.push({ stepId: s.id, problema: "botão de link sem texto do botão" });
      if (!s.ctaUrl?.trim()) problemas.push({ stepId: s.id, problema: "botão de link sem URL" });
      else if (!/^https?:\/\//i.test(s.ctaUrl.trim())) {
        problemas.push({ stepId: s.id, problema: "URL do botão deve começar com http:// ou https://" });
      }
    }
    if (s.kind === "template") {
      if (!s.template?.name) {
        problemas.push({ stepId: s.id, problema: "template sem name" });
      }
      // A resposta a um template quick-reply chega como `type:"button"`, que o webhook
      // entrega sem id de botão (replyId null) -> o avanço só acha caminho por fallbackNext.
      // Sem ele, quem clica fica preso depois de abrir a janela, que é o pior dos mundos:
      // pagou o template e não entregou o que prometeu.
      if (!s.fallbackNext && !Object.keys(s.branches ?? {}).length) {
        problemas.push({
          stepId: s.id,
          problema: "template sem fallbackNext/branches — o clique não teria pra onde ir",
        });
      }
    }
    if (s.kind === "text" && !s.text?.trim()) {
      problemas.push({ stepId: s.id, problema: "texto vazio" });
    }
    if (s.kind === "text" && (s.text?.length ?? 0) > 4096) {
      problemas.push({ stepId: s.id, problema: `texto com ${s.text!.length} caracteres; o limite do WhatsApp é 4096` });
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
      // goto sai do fluxo (como end): não continua a cadeia aqui.
      if (
        esperaResposta(atual) || atual.kind === "wait" ||
        atual.kind === "end" || atual.kind === "goto"
      ) {
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

// ── Variáveis / personalização ──────────────────────────────────────────────
//
// Textos do fluxo podem conter `{{chave}}` (ex.: `{{nome}}`, `{{primeiro_nome}}`). No envio,
// cada chave é trocada pelo valor do contato. Chave desconhecida vira "" (string vazia) — nunca
// sai `{{x}}` cru pro lead. Puro e serializável, como o resto deste módulo; quem fornece o mapa
// de valores é o chamador (runner/pump), a partir do contato.

const VAR_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Troca `{{chave}}` pelos valores de `vars` (case-insensitive na chave). Desconhecida → "". */
export function interpolate(text: string | undefined, vars: Record<string, string>): string {
  if (!text) return text ?? "";
  if (!text.includes("{{")) return text;
  const lower: Record<string, string> = {};
  for (const k of Object.keys(vars)) lower[k.toLowerCase()] = vars[k];
  return text.replace(VAR_RE, (_m, chave: string) => lower[chave.toLowerCase()] ?? "");
}

/** Chaves `{{...}}` usadas em todos os textos do fluxo — para o editor listar/avisar. */
export function varsUsadas(flow: Flow): string[] {
  const achadas = new Set<string>();
  const scan = (t?: string) => {
    if (!t) return;
    for (const m of t.matchAll(VAR_RE)) achadas.add(m[1].toLowerCase());
  };
  for (const s of flow.steps) {
    scan(s.text);
    for (const b of s.buttons ?? []) scan(b.title);
    for (const sec of s.sections ?? []) {
      scan(sec.title);
      for (const r of sec.rows ?? []) { scan(r.title); scan(r.description); }
    }
  }
  return [...achadas];
}

/**
 * Devolve uma CÓPIA do step com os textos interpolados pelos valores do contato. Ids, branches,
 * next etc. ficam intactos (ramificação é por id de botão/linha, não por texto). Usado no envio.
 */
export function renderStep(step: FlowStep, vars: Record<string, string>): FlowStep {
  if (!vars || !Object.keys(vars).length) return step;
  const s: FlowStep = { ...step };
  if (s.text !== undefined) s.text = interpolate(s.text, vars);
  if (s.ctaText !== undefined) s.ctaText = interpolate(s.ctaText, vars);
  if (s.buttons) s.buttons = s.buttons.map((b) => ({ ...b, title: interpolate(b.title, vars) }));
  if (s.sections) {
    s.sections = s.sections.map((sec) => ({
      ...sec,
      title: interpolate(sec.title, vars),
      rows: sec.rows.map((r) => ({
        ...r,
        title: interpolate(r.title, vars),
        description: r.description !== undefined ? interpolate(r.description, vars) : r.description,
      })),
    }));
  }
  return s;
}
