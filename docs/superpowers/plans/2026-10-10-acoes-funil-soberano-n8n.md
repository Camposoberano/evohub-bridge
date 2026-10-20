# Ações do funil Soberano no n8n — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separar as 14 ações comerciais do WhatsApp Oficial 5895 em workflows n8n editáveis, mantendo o funil de 30/09 e um único envio confirmado.

**Architecture:** As macros continuam adicionando etiquetas no Chatwoot; o bridge valida e encaminha cada ação ao webhook n8n correspondente. O n8n define conteúdo e pede enfileiramento/controle ao bridge; uma única fila envia e confirma cada peça. A entrada automática de anúncios usa o mesmo workflow do funil completo.

**Tech Stack:** Deno/TypeScript no bridge, Supabase/PostgREST para estado, Chatwoot para macros, n8n MCP da instância `automacao.soberano.pro`, Uazapi/bridge para envio.

**Spec:** `docs/superpowers/specs/2026-10-10-acoes-funil-soberano-n8n-design.md` (commit `3192322` no checkout principal).

## Global Constraints

- Trabalhar a partir do checkout limpo `E:\Projetos_Novos\evohub\.worktrees\funil-anuncios-5895-cinco-momentos`, que contém `mega-sorgo-5895-20260930`; o checkout principal está em outro histórico e contém alterações não relacionadas.
- Usar exclusivamente o MCP `n8n-soberano` e `https://automacao.soberano.pro`. Não ler, editar ou ativar workflows da instância CECAPE.
- Não colocar API keys, bearer tokens ou segredos em arquivos, logs, respostas ou parâmetros fixos de nós n8n. Usar credenciais/variáveis de ambiente do n8n e do bridge.
- Manter 31 peças em cinco fases para `mega-sorgo-5895-20260930`; não ativar `mega-sorgo-5895-v2` nem `Funil Mega Sorgo - Apresentacao (cron)`.
- Nunca deixar dois consumidores ativos da mesma fila; entradas antigas já agendadas não devem reiniciar.
- Um registro `sent` exige resposta positiva do bridge; registro de envio não prova entrega ao aparelho.
- Testes e verificação são autorizados pelo pedido do usuário para verificar tudo e executar um disparo controlado.

## Mapa de arquivos e responsabilidades

| Arquivo | Responsabilidade |
| --- | --- |
| `bridge/shared/n8n-action-contract.ts` (novo) | Tipos, allowlist das 14 ações, versão e geração de chave idempotente. |
| `bridge/shared/n8n-action-router.ts` (novo) | Chamar o webhook n8n configurado para cada ação e validar aceitação; não enviar mensagens. |
| `bridge/handlers/funil-control.ts` | Encaminhar macro para n8n com fallback temporário e preservar transições antigas durante a migração. |
| `bridge/handlers/funil-enroll.ts` | Encaminhar novos leads de anúncio do 5895 ao mesmo workflow de funil completo. |
| `bridge/server.ts` | Consumir etiqueta somente após aceitação durável, mantendo erro recuperável. |
| `bridge/handlers/n8n-action-enqueue.ts` (novo) | Endpoint autenticado que valida e grava lotes de peças ordenadas, ou chama ação de controle, sem duplicar. |
| `bridge/shared/funnel-queue.ts` e `bridge/handlers/send-outbound.ts` | Emissão única, resultado confirmado, retentativa e estado observável. |
| `bridge/tests/n8n-action-contract.test.ts`, `bridge/tests/n8n-action-enqueue.test.ts`, `bridge/tests/funnel-queue-confirmation.test.ts` (novos) | Contrato, idempotência e falha de envio. |
| Workflows n8n `Soberano 5895 — ...` | Conteúdo e webhook de cada ação; nenhum deles envia diretamente ao WhatsApp. |

## Task 1: Inventário e contrato entre bridge e n8n

**Files:** Create `bridge/shared/n8n-action-contract.ts`; create `bridge/tests/n8n-action-contract.test.ts`; update `docs/superpowers/plans/2026-10-10-acoes-funil-soberano-n8n.md` somente para marcar passos.

**Interfaces:** Produces `type SoberanoAction`, `type ActionRequest`, `actionKey(request: ActionRequest): string` and `isSoberanoAction(value: string): value is SoberanoAction`.

- [ ] **Step 1:** No worktree de 5895, registrar IDs, status, triggers e nomes dos workflows atuais via `mcp__n8n_soberano__search_workflows`/`get_workflow_details`. Resumir sem imprimir segredos. Conferir os 31 itens de `bridge/handlers/funil-enroll.ts` com o histórico de 30/09.
- [ ] **Step 2:** Criar teste que aceita somente `funil`, `preco`, `video`, `plantio`, `nutricao`, `recuperacao-1..4`, `catalogo`, `catalogo-sair`, `pause`, `resume`, `stop` e produz a mesma chave para duas tentativas do mesmo `request_id`.
- [ ] **Step 3:** Implementar contrato com `request_id`, `source: "macro" | "ad"`, `chatwoot_conversation_id`, `action`, `funnel_version`; exigir `RESTORED_5895_FUNNEL` para `funil` no 5895. A chave usa `request_id` persistente, não timestamp da tentativa.
- [ ] **Step 4:** Executar `deno test -A bridge/tests/n8n-action-contract.test.ts`; conferir que passa; commit apenas desses arquivos.

```ts
export type SoberanoAction =
  | "funil" | "preco" | "video" | "plantio" | "nutricao"
  | "recuperacao-1" | "recuperacao-2" | "recuperacao-3" | "recuperacao-4"
  | "catalogo" | "catalogo-sair" | "pause" | "resume" | "stop";
export type ActionRequest = {
  request_id: string;
  source: "macro" | "ad";
  chatwoot_conversation_id: number;
  action: SoberanoAction;
  funnel_version: string;
};
export const actionKey = (r: ActionRequest) =>
  `soberano-action:${r.chatwoot_conversation_id}:${r.action}:${r.request_id}`;
```

## Task 2: Endpoint de enfileiramento e controles

**Files:** Create `bridge/handlers/n8n-action-enqueue.ts`; create `bridge/tests/n8n-action-enqueue.test.ts`; modify `bridge/server.ts` to register route. Add a migration only if the existing `deliveries` uniqueness/TTL cannot safely represent request idempotency.

**Interfaces:** Consumes `ActionRequest`; accepts `{ request: ActionRequest, pieces: Array<{ day: number, type: string, payload: Record<string, unknown>, offset_seconds: number }> }`; returns `{ ok: true, accepted: number, duplicate: boolean }` after durable persistence. Control actions return `{ ok: true, state: "paused" | "running" | "cancelled" }` after bridge state transition.

- [ ] **Step 1:** Inspecionar `sales_sequences`, `scheduled_messages`, `deliveries`, `funil-control.ts` e as migrations atuais. Definir chave por peça como `actionKey(request) + ":" + index`; usar restrição única persistente ou transação equivalente para enfileiramento de lote.
- [ ] **Step 2:** Escrever teste para canal errado, versão errada, peça inválida, repetição do mesmo request e falha no meio do lote. Esperar zero duplicações e zero lote parcialmente confirmado.
- [ ] **Step 3:** Implementar `POST /n8n-action-enqueue`, autenticar com segredo separado do webhook público, validar a conversa/canal e chamar funções atuais de pausa/retomada/parada para ações de controle.
- [ ] **Step 4:** Executar `deno test -A bridge/tests/n8n-action-enqueue.test.ts`; conferir migrations/contrato; commit.

```ts
type QueuePiece = {
  day: number;
  type: string;
  payload: Record<string, unknown>;
  offset_seconds: number;
};
type EnqueueBody = { request: ActionRequest; pieces: QueuePiece[] };
type EnqueueAccepted = { ok: true; accepted: number; duplicate: boolean };
```

## Task 3: Confirmar o envio antes de marcar `sent`

**Files:** Modify `bridge/shared/funnel-queue.ts` and, if necessary, `bridge/handlers/send-outbound.ts`; create `bridge/tests/funnel-queue-confirmation.test.ts`; update only the active n8n workflow `Funil Mega Sorgo - Fila (cron 1min)` using `mcp__n8n_soberano__*`.

**Interfaces:** `confirmedOutbound(httpStatus: number, body: Record<string, unknown>): boolean` is true only for successful HTTP and explicit `body.ok === true` with no `blocked`, `awaiting_window` or `deferred_business_window`.

- [ ] **Step 1:** Testar respostas `{ ok: true }`, `{ ok: false }`, HTTP 500, timeout, janela fechada e resultado vazio. Cada resposta não confirmada deixa `scheduled_messages.status` diferente de `sent`.
- [ ] **Step 2:** Extrair e usar `confirmedOutbound`; manter pausa para janela, reagendamento por horário e registro de falha existentes. Investigar o claim atual para que timeout incerto não faça novo envio sem dedupe pelo `scheduled_message_id`.
- [ ] **Step 3:** Ler `get_sdk_reference` e detalhes da versão ativa do workflow n8n. Alterar seu ramo após `/send-outbound` para testar HTTP e `ok === true` antes do PATCH `sent`; resultados não confirmados vão ao ramo de falha/reagendamento, com `scheduled_message_id` preservado. Não criar outro cron consumidor.
- [ ] **Step 4:** Executar `deno test -A bridge/tests/funnel-queue-confirmation.test.ts`; usar execução controlada do n8n para confirmar que erro não gera `sent`; commit do código e registrar ID/versão do workflow no relatório de implantação sem segredos.

```ts
export function confirmedOutbound(status: number, body: Record<string, unknown>): boolean {
  return status >= 200 && status < 300 && body.ok === true &&
    body.blocked == null && body.awaiting_window !== true &&
    body.deferred_business_window !== true;
}
```

## Task 4: Roteamento de macro e anúncio

**Files:** Create `bridge/shared/n8n-action-router.ts`; modify `bridge/handlers/funil-control.ts`, `bridge/handlers/funil-enroll.ts`, `bridge/server.ts`; add focused tests to `bridge/tests/n8n-action-contract.test.ts` and `bridge/tests/funil-five-moments.test.ts`.

**Interfaces:** `dispatchSoberanoAction(request: ActionRequest): Promise<{ ok: true; accepted: boolean } | { ok: false; terminal: boolean; error: string }>`; feature flag per action in environment, default off until the corresponding workflow is validated.

- [ ] **Step 1:** Testar que macro e anúncio usam a mesma ação/versão e que repetição não agenda outra sequência; confirmar que preço não chama `autoPauseFunil` para a sequência restaurada e que a macro só perde a etiqueta após aceitação durável.
- [ ] **Step 2:** Implementar URL por ação em registro único de configuração, com credencial em variável de ambiente, timeout e resposta tipada. `request_id` da macro vem de um evento/etiqueta persistido; o da entrada automática vem do evento de anúncio, para sobreviver a reinício.
- [ ] **Step 3:** Adicionar roteamento condicionado ao 5895, mantendo comportamento existente nos demais canais. Para preço, inserir as peças no próximo intervalo comercial livre e preservar a posição do funil completo.
- [ ] **Step 4:** Executar os testes focados e verificar os dois caminhos com flag desligada/ligada; commit.

```ts
export type ActionDispatchResult =
  | { ok: true; accepted: boolean }
  | { ok: false; terminal: boolean; error: string };
export async function dispatchSoberanoAction(
  request: ActionRequest,
): Promise<ActionDispatchResult>;
```

## Task 5: Workflows de conteúdo e controle

**Files:** Create 14 workflows in `n8n-soberano`; export sanitized workflow definitions/IDs to `ops/n8n-soberano-5895-workflows.md` (new). Do not create workflows in the CECAPE instance.

**Interfaces:** Each webhook receives `ActionRequest`, responds only after `/n8n-action-enqueue` durably accepts, and returns `{ ok: true, accepted: number, duplicate: boolean }` or an explicit error.

- [ ] **Step 1:** Ler referência e práticas do MCP n8n. Criar workflow `Soberano 5895 — Funil completo 30-09` inativo, com 31 peças e cinco fases extraídas da versão restaurada. Comparar tipos, mídia, texto, botões, ordem e offsets, item por item.
- [ ] **Step 2:** Criar workflows inativos para `Preço`, `Vídeo`, `Plantio`, `Nutrição` e `Recuperação 1` a `Recuperação 4`, usando conteúdo atual aprovado, um webhook e uma chamada ao endpoint de enfileiramento por workflow.
- [ ] **Step 3:** Criar workflows inativos para `Abrir catálogo`, `Voltar ao Mega Sorgo`, `Pausar`, `Retomar` e `Parar`; eles solicitam transição ao bridge e registram resultado, sem enviar mídia diretamente.
- [ ] **Step 4:** Conferir todos os 14 IDs, ramos de erro, credenciais e respostas dos webhooks sem disparo real; exportar resumo sem tokens e commit do relatório.

O corpo enviado ao bridge segue `EnqueueBody` da Task 2. O workflow principal fornece exatamente 31 elementos em `pieces`; workflows de controle enviam a ação sem peças e recebem o estado persistido.

## Task 6: Troca gradual e prova de ponta a ponta

**Files:** Update `ops/n8n-soberano-5895-workflows.md` with rollout and observed IDs/status; update feature flags in deployment configuration through the existing release process; no new permanent sender.

**Interfaces:** A rollout ledger records action, old path, new workflow ID, activation time, sample conversation, count queued, count confirmed, and rollback switch.

- [ ] **Step 1:** Publicar bridge com flags desligadas. Ativar somente o workflow principal e sua flag após verificar que o cron corrigido é o único consumidor das peças restauradas. Confirmar que versões curtas e apresentação antiga continuam inativas.
- [ ] **Step 2:** Fazer disparo real controlado em conversa elegível do 5895; comparar peças visíveis no Chatwoot/WhatsApp, retorno do bridge e status `scheduled_messages`. Conferir anúncio e macro sem duplicação.
- [ ] **Step 3:** Ativar preço e confirmar que ocorre entre pausas sem interromper o funil. Ativar as outras ações uma a uma, verificando resultado e marcação da macro antes da próxima.
- [ ] **Step 4:** Simular falha do emissor em ambiente seguro, confirmar que nenhuma peça vira `sent` sem `ok:true` e que retentativa não duplica. Verificar filas anteriores e sequências em andamento.
- [ ] **Step 5:** Registrar evidência sem PII/tokens, estado final dos 14 workflows e caminho de rollback por flag. Desligar apenas caminhos antigos equivalentes. Commit do relatório de implantação.

## Revisão antes da execução

- Conferir que o checkout de execução contém o funil restaurado e que esta spec/plan estão disponíveis ali, por cherry-pick ou cópia versionada sem trazer alterações sujas do checkout principal.
- Conferir que `n8n-soberano` está conectado e que IDs de workflow correspondem à instância Soberano.
- Não publicar ou ativar workflows de envio antes de concluir a correção da fila e o contrato idempotente.
