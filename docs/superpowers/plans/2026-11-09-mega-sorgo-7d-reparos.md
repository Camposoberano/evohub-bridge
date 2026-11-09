# Mega Sorgo 7 dias — Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir os erros do ensaio de 08/11 e deixar a versão isolada pronta para outro agente testar sem mudar os anúncios.

**Architecture:** O catálogo continua com 34 peças e dez áudios. O bridge passa a escolher explicitamente entre agenda real e ensaio acelerado; o fluxo de PDF permanece no clique já existente, e um auditor read-only confere fila e recibos por execução.

**Tech Stack:** Deno/TypeScript, Supabase PostgREST self-host, n8n, testes `deno test`.

**Spec:** `docs/superpowers/specs/2026-11-09-mega-sorgo-7d-reparos-design.md`.

## Global Constraints

- Preservar 34 peças, dez áudios, áudio inicial e dia 4 sem peças.
- Vídeos oficiais somente depois de `video_7d_sim`; o PDF somente após `menu_isca_silagem`.
- Anúncios 5895/6836 continuam em `mega-sorgo-5895-20260930`.
- Não publicar nem implantar código, nem enviar mensagens reais, nesta etapa de preparação.
- Não reiniciar o bridge entre 08h e 20h BRT sem OK explícito.

---

### Task 1: Corrigir as três peças finais sem mudar o tamanho

**Files:** Modify `bridge/shared/mega-sorgo-7d-content.json`; modify `bridge/tests/mega-sorgo-7d-content.test.ts`.

**Interfaces:** Consumes `SEVEN_DAY_CONTENT`; produces o mesmo catálogo de 34 peças, com `d5_pdf` como texto de oferta e `d6_duvida`/`d7_ultima` sem marcador.

- [ ] **Step 1: Escrever o teste que falha.** Acrescentar ao teste do catálogo:

```ts
const byCode = new Map(SEVEN_DAY_CONTENT.map((piece) => [piece.code, piece]));
assertEquals(SEVEN_DAY_CONTENT.length, 34);
assertEquals(SEVEN_DAY_CONTENT.filter((piece) => piece.type === "audio").length, 10);
assertEquals(byCode.get("d5_pdf")?.type, "text");
assertEquals("media_ref" in (byCode.get("d5_pdf")?.payload ?? {}), false);
for (const code of ["d6_duvida", "d7_ultima"]) {
  assertEquals(String(byCode.get(code)?.payload.content).includes("[nome]"), false);
}
```

- [ ] **Step 2: Confirmar falha.** Rodar `deno test bridge/tests/mega-sorgo-7d-content.test.ts`; esperar falha em `d5_pdf` e `[nome]`.
- [ ] **Step 3: Alterar apenas o JSON.** Trocar `d5_pdf` para `type: "text"`, `payload.content: "O material gratuito da Embrapa continua disponível. Se quiser receber o PDF, responda 'Quero o material' e envio por aqui. 📚"`, removendo `asset` e `media_ref`. Remover `[nome]` das duas mensagens seguintes, preservando o restante do texto. Manter o convite original com `menu_isca_silagem` para entrega sob pedido.
- [ ] **Step 4: Confirmar.** Rodar o teste e `deno check bridge/shared/mega-sorgo-7d-content.ts`; esperar PASS. Conferir `git diff --check`.
- [ ] **Step 5: Commit.** `git add bridge/shared/mega-sorgo-7d-content.json bridge/tests/mega-sorgo-7d-content.test.ts` e `git commit -m "Fix seven-day PDF consent and name placeholders"`.

### Task 2: Separar agenda real do ensaio acelerado

**Files:** Modify `bridge/shared/n8n-action-contract.ts`, `bridge/handlers/n8n-action-enqueue.ts`, `bridge/tests/n8n-action-enqueue.test.ts`, `bridge/tests/mega-sorgo-7d-schedule.test.ts`.

**Interfaces:** `ActionRequest.test_accelerated?: boolean`; `buildActionRows(body, conversationId, now)` escolhe `scheduleSevenDayPieces` por padrão e `scheduleSevenDayTestPieces` somente para `test_accelerated === true` em `source: "macro"` com versão 7d. O handler já confere allowlist e canal antes de criar linhas.

- [ ] **Step 1: Escrever teste que falha.** No teste do enqueue, criar pedido 7d sem a flag e comparar `rows` de `day: 5` com `scheduleSevenDayPieces` para o mesmo relógio. Criar segundo pedido com `test_accelerated: true` e comparar `rows[1].send_at` com `now + 5 * 60_000`. Rejeitar `test_accelerated: true` em `source: "ad"` e fora da versão 7d.

```ts
assertEquals(realRows.find((row) => row.day === 5)?.send_at,
  scheduleSevenDayPieces(SEVEN_DAY_CONTENT, now)
    .find((row) => row.day === 5)?.sendAt);
assertEquals(fastRows[1].send_at, new Date(now + 5 * 60_000).toISOString());
```

- [ ] **Step 2: Confirmar falha.** `deno test bridge/tests/n8n-action-enqueue.test.ts bridge/tests/mega-sorgo-7d-schedule.test.ts`.
- [ ] **Step 3: Implementar.** Adicionar a flag opcional tipada ao contrato; validar que é booleana e só vale para macro 7d. Em `buildActionRows`, chamar `scheduleSevenDayPieces` para o padrão, `scheduleSevenDayTestPieces` para a flag; manter o gate de conversa de teste na entrada. Atualizar os testes antigos que dependiam da compressão para passar a flag explicitamente.
- [ ] **Step 4: Confirmar.** Executar os testes acima, `deno check bridge/server.ts` e `git diff --check`; esperar PASS.
- [ ] **Step 5: Commit.** `git add bridge/shared/n8n-action-contract.ts bridge/handlers/n8n-action-enqueue.ts bridge/tests/n8n-action-enqueue.test.ts bridge/tests/mega-sorgo-7d-schedule.test.ts` e `git commit -m "Separate real and accelerated seven-day schedules"`.

### Task 3: Remover a exceção temporária da madrugada

**Files:** Delete `bridge/shared/mega-sorgo-7d-night-test.ts`; modify `bridge/handlers/n8n-queue.ts`, `bridge/handlers/send-outbound.ts`, `bridge/handlers/n8n-action-enqueue.ts`, `bridge/shared/mega-sorgo-7d-schedule.ts`, `bridge/server.ts`; modify tests of the queue and schedule as needed.

**Interfaces:** Fora do horário, `n8n-queue` volta a retornar `[]`, e qualquer `POST` de peça agendada volta a bloquear por `horario-comercial`; o ensaio acelerado continua respeitando 08h–20h. A versão de build é uma label manual.

- [ ] **Step 1: Escrever o teste que falha.** Testar `scheduleSevenDayTestPieces` às 20h01 BRT e esperar a primeira peça às 08h do dia seguinte. Para a fila, verificar que não há referência a `isSevenDayNightTest` e que a barreira de horário precede envio; testes de roteamento existentes devem continuar passando.

```ts
const rows = scheduleSevenDayTestPieces([{ code: "a", day: 1 }],
  Date.parse("2026-11-09T23:01:00Z"));
assertEquals(rows[0].sendAt, "2026-11-10T11:00:00.000Z");
```

- [ ] **Step 2: Confirmar a falha dos testes afetados.** Rodar `deno test bridge/tests/mega-sorgo-7d-schedule.test.ts bridge/tests/n8n-queue.test.ts` antes da limpeza.
- [ ] **Step 3: Remover somente o override expirado.** Apagar imports/chamadas do helper e o ramo noturno em `n8n-queue`; restaurar `send-outbound` para exigir a janela normal em toda peça agendada; remover `allowOutOfHours` de `scheduleSevenDayTestPieces`. Atualizar `build:` em `bridge/server.ts`.
- [ ] **Step 4: Confirmar.** Rodar os testes, `deno check bridge/server.ts` e `rg -n "mega-sorgo-7d-night-test|ensai[o0]Noturno" bridge`; a busca deve retornar zero linhas.
- [ ] **Step 5: Commit.** `git add -A bridge/shared/mega-sorgo-7d-night-test.ts bridge/handlers/n8n-queue.ts bridge/handlers/send-outbound.ts bridge/handlers/n8n-action-enqueue.ts bridge/shared/mega-sorgo-7d-schedule.ts bridge/server.ts bridge/tests` e `git commit -m "Remove expired overnight funnel override"`.

### Task 4: Verificar consentimento e recibos sem disparar clientes

**Files:** Modify `bridge/tests/mega-sorgo-7d-content.test.ts`; create `bridge/tests/mega-sorgo-7d-videos.test.ts`; create `bridge/scripts/audit-mega-sorgo-7d-test.py`; create `docs/superpowers/plans/2026-11-09-mega-sorgo-7d-verificacao.md`; allowlist do novo documento em `.gitignore`.

**Interfaces:** O auditor recebe caminho de `.env` e IDs das conversas de teste, faz apenas GET em PostgREST, imprime contagem por execução e identifica qualquer `[nome]`, PDF sem clique, vídeo sem aceite, fila duplicada ou status `failed`. O auditor não envia, cancela, retoma nem cria mensagens.

- [ ] **Step 1: Testar o contrato dos cinco vídeos.** Verificar ordem dos slots `official_01` a `official_05`, ausência de vídeos nas 34 peças e IDs estáveis por conversa em clique repetido. O teste deve usar um `DbClient` falso que retorna sequência `running`, cinco URLs e as linhas inseridas; no segundo clique, retorna IDs existentes e espera `0` novas linhas.

```ts
assertEquals(SEVEN_DAY_CONDITIONAL_VIDEOS.map((v) => v.payload.media_ref.slot),
  ["official_01", "official_02", "official_03", "official_04", "official_05"]);
assertEquals(SEVEN_DAY_CONTENT.some((piece) => piece.type === "video"), false);
```

- [ ] **Step 2: Implementar o auditor read-only.** Consultar `scheduled_messages` pela versão e conversa, filtrar `payload.__funnel_sequence_id`, agrupar por `status`, contar IDs únicos em `messages.scheduled_message_id` e conferir `video_invite`, `d5_pdf`, `d6_duvida`, `d7_ultima`. Nunca imprimir segredo ou número completo; não fazer POST/PATCH/DELETE.
- [ ] **Step 3: Escrever roteiro de teste.** O agente prepara conversas autorizadas, roda teste de agenda simulada e, só com autorização para envio ao número de teste, executa uma inscrição com `test_accelerated: true`. Confere 34 linhas, dez áudios, ausência de `[nome]`, dia 4 vazio no modo real, PDF sob clique, zero/cinco vídeos antes/depois do aceite e repetição idempotente. Compara `sent` com confirmação no aparelho.
- [ ] **Step 4: Confirmar sem disparar.** Rodar testes focados, `deno check bridge/server.ts`, `python -m py_compile bridge/scripts/audit-mega-sorgo-7d-test.py`, `git diff --check`. Ler as primeiras e últimas peças do catálogo para garantir 34 peças e zero placeholders.
- [ ] **Step 5: Commit.** Adicionar arquivos do teste, auditor, roteiro e `.gitignore`; `git commit -m "Add isolated seven-day funnel audit and consent tests"`.

### Task 5: Integração e entrega para o agente

**Files:** Modify `HANDOFF.md`; modify `docs/superpowers/plans/2026-11-09-mega-sorgo-7d-verificacao.md` se o teste revelar ajuste necessário.

**Interfaces:** Entregar os commits locais, o comando de auditoria e o roteiro operacional; nenhum canal de anúncio muda de versão.

- [ ] **Step 1: Conferir estados.** `git diff origin/main -- bridge/shared/funnel-identity.ts bridge/handlers/funil-enroll.ts` deve estar vazio para as rotas de anúncio. `git status --short` deve estar limpo após os commits.
- [ ] **Step 2: Conferir n8n sem mutação.** Ler `pQFCtRhzQTKqXTjS`: a condição datada de 08/11 já é inerte; documentar a alteração do nó para remover a linha temporária quando houver publicação posterior, sem alterar a versão ativa nesta etapa.
- [ ] **Step 3: Registrar handoff.** Anotar versão, testes executados, bloqueios e roteiro para o agente em `HANDOFF.md`, distinguindo código preparado de código implantado.
- [ ] **Step 4: Commit de handoff.** `git add HANDOFF.md docs/superpowers/plans/2026-11-09-mega-sorgo-7d-verificacao.md` e `git commit -m "Hand off seven-day funnel repair for isolated test"`.
