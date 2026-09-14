# Recuperação sem nota repetida Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evitar que a cadeia automática de recuperação repita notas privadas quando uma entrega histórica já estiver marcada em `deliveries` e o evento analítico tiver expirado.

**Architecture:** `dispatchRecovery` distinguirá envio novo, reconciliação de entrega histórica e falha. A cadeia automática chamará o dispatcher em modo silencioso e tratará a reconciliação como atualização de estado, não como mensagem nova. O evento `recovery_sent` será restaurado somente a partir da trava persistente já existente.

**Tech Stack:** Deno, TypeScript, Supabase/PostgREST, Chatwoot API, Deno test.

**Spec:** `docs/superpowers/specs/2026-09-14-recuperacao-nota-repetida-design.md`

## Global Constraints

- A trava em `deliveries` é a fonte de verdade para idempotência de recuperação.
- Execução automática não pode publicar nota privada para entrega histórica já marcada.
- Reconciliação não envia conteúdo ao cliente nem consome o teto de novos envios do cron.
- Falha ao gravar o evento reconciliado não pode ser tratada como sucesso.
- Não apagar mensagens nem entregas existentes.

---

### Task 1: Cobrir a entrega histórica sem evento com teste de unidade

**Files:**
- Modify: `bridge/tests/recovery-chain-blocked.test.ts`
- Modify: `bridge/tests/recovery-chain.test.ts`

**Interfaces:**
- Consumes: `pumpRecoveryChain(db, dispatch, now, maxPorRodada)`.
- Produces: teste que exige que o dispatcher sinalize reconciliação e que a rodada subsequente não volte a considerar a mesma variação pendente.

- [ ] **Step 1: Escrever o teste que reproduz a conversa 1342**

Adicione um banco falso com uma sequência concluída, entrada recente que torna a variação 1 devida, nenhuma linha `recovery_sent` e uma entrega histórica representada pela resposta reconciliada do dispatcher. Faça o dispatcher registrar as chamadas e devolver `{ state: "reconciled" }` na primeira rodada.

- [ ] **Step 2: Rodar o teste para confirmar a falha**

Run: `deno test --allow-all --node-modules-dir=none bridge/tests/recovery-chain-blocked.test.ts`

Expected: FAIL porque `RecoveryDispatcher` ainda aceita somente `Promise<boolean>` e a cadeia ainda conta qualquer `response.ok` como envio.

- [ ] **Step 3: Escrever o teste de preservação do limite**

No mesmo arquivo, simule duas conversas: a primeira devolve `{ state: "reconciled" }`, a segunda devolve `{ state: "sent" }`, com `maxPorRodada = 1`. Exija que a segunda ainda seja enviada, provando que a reconciliação não consome a vaga de envio real.

- [ ] **Step 4: Rodar os testes para confirmar as duas falhas esperadas**

Run: `deno test --allow-all --node-modules-dir=none bridge/tests/recovery-chain-blocked.test.ts`

Expected: FAIL apenas nos dois casos novos, antes da alteração de produção.

### Task 2: Diferenciar envio, reconciliação e falha na cadeia

**Files:**
- Modify: `bridge/shared/recovery-chain.ts`
- Test: `bridge/tests/recovery-chain-blocked.test.ts`

**Interfaces:**
- Consumes: o dispatcher de recuperação e sua decisão por conversa/variação.
- Produces: `RecoveryDispatchResult = { state: "sent" | "reconciled" | "failed" }` e `RecoveryDispatcher = (...) => Promise<RecoveryDispatchResult>`.

- [ ] **Step 1: Alterar o contrato do dispatcher**

Substitua o retorno booleano por `RecoveryDispatchResult`. Mantenha o resultado agregado `sent` apenas para `state === "sent"`; inclua `reconciled` no agregado retornado pela cadeia para observabilidade.

- [ ] **Step 2: Atualizar o laço de despacho**

Após `const outcome = await dispatch(...)`, incremente `result.sent` somente em `outcome.state === "sent"`, `result.reconciled` em `outcome.state === "reconciled"` e `result.failed` em `outcome.state === "failed"`. Não use `break` após reconciliação; o teto considera somente novos envios.

- [ ] **Step 3: Rodar os testes focados**

Run: `deno test --allow-all --node-modules-dir=none bridge/tests/recovery-chain.test.ts bridge/tests/recovery-chain-blocked.test.ts`

Expected: PASS, incluindo o cenário da entrega histórica.

### Task 3: Reconciliar a trava histórica sem criar nota automática

**Files:**
- Modify: `bridge/handlers/funil-control.ts`
- Modify: `bridge/server.ts`
- Create: `bridge/tests/recovery-delivery-reconciliation.test.ts`

**Interfaces:**
- Consumes: `dispatchRecovery(db, conv, cwConvId, variation, acct, options?)`.
- Produces: `RecoveryDispatchResult` e um evento `recovery_sent` com `reconciled_from_delivery: true` quando o claim existente vier da cadeia automática.

- [ ] **Step 1: Escrever o teste do caminho automático**

Crie teste para um claim preexistente. Injete banco falso que capture `events.insert` e uma função de nota que falha se for chamada. Exija `{ state: "reconciled" }`, um único evento `recovery_sent` com `conversation_id`, `chatwoot_conversation_id`, `variation` e `reconciled_from_delivery: true`, e zero chamadas de envio/note.

- [ ] **Step 2: Escrever o teste do caminho manual**

Com o mesmo claim preexistente, chame `dispatchRecovery` sem a opção automática. Exija `{ state: "reconciled" }` e uma única nota `Recuperação N não repetida`, preservando a informação útil para a macro manual.

- [ ] **Step 3: Executar os testes para confirmar a falha inicial**

Run: `deno test --allow-all --node-modules-dir=none bridge/tests/recovery-delivery-reconciliation.test.ts`

Expected: FAIL porque o código atual cria a nota para qualquer chamador e não regrava `recovery_sent`.

- [ ] **Step 4: Implementar a opção e a reconciliação**

Adicione uma opção `automatic?: boolean` a `dispatchRecovery`. No caminho em que `claimDelivery` retorna falso, quando `automatic` for verdadeiro, insira `events` com `source: "recovery"`, `event_type: "recovery_sent"`, os identificadores existentes e `reconciled_from_delivery: true`. Se houver erro na inserção, devolva `{ state: "failed" }`. Não chame `nota`. Para a chamada manual, mantenha a nota existente e devolva `{ state: "reconciled" }`.

- [ ] **Step 5: Adaptar o chamador em `bridge/server.ts`**

No callback de `runRecoveryChain`, passe `{ automatic: true }` para `dispatchRecovery` e devolva diretamente o `RecoveryDispatchResult`, em vez de reduzir a resposta para `response.ok`.

- [ ] **Step 6: Rodar os testes focados**

Run: `deno test --allow-all --node-modules-dir=none bridge/tests/recovery-delivery-reconciliation.test.ts bridge/tests/recovery-chain.test.ts bridge/tests/recovery-chain-blocked.test.ts`

Expected: PASS.

### Task 4: Verificar a integração e registrar a entrega

**Files:**
- Modify: `bridge/handlers/funil-control.ts`
- Modify: `bridge/shared/recovery-chain.ts`
- Modify: `bridge/server.ts`
- Modify: `bridge/tests/recovery-chain-blocked.test.ts`
- Create: `bridge/tests/recovery-delivery-reconciliation.test.ts`

**Interfaces:**
- Consumes: implementação das tarefas 1–3.
- Produces: correção validada para deploy, sem mudança de dados históricos.

- [ ] **Step 1: Verificar tipos**

Run: `deno check bridge/server.ts`

Expected: PASS sem incompatibilidade entre o retorno do dispatcher e o callback do cron.

- [ ] **Step 2: Executar toda a suíte**

Run: `deno test --allow-all --node-modules-dir=none bridge/tests`

Expected: PASS com todos os testes existentes e novos.

- [ ] **Step 3: Revisar o diff**

Run: `git diff --check && git diff -- bridge/handlers/funil-control.ts bridge/shared/recovery-chain.ts bridge/server.ts bridge/tests/recovery-chain-blocked.test.ts bridge/tests/recovery-delivery-reconciliation.test.ts`

Expected: nenhum erro de whitespace; nenhuma alteração em regra de disparo real, dados de cliente ou Chatwoot fora do caso de duplicata histórica.

- [ ] **Step 4: Commitar a correção**

Run: `git add bridge/handlers/funil-control.ts bridge/shared/recovery-chain.ts bridge/server.ts bridge/tests/recovery-chain-blocked.test.ts bridge/tests/recovery-delivery-reconciliation.test.ts && git commit -m "fix: reconciliar recuperação histórica sem nota repetida"`

Expected: commit único com a implementação e os testes.
