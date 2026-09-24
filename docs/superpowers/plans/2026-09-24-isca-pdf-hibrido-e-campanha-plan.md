# Correção de PDF híbrido e campanha Embrapa — Implementation Plan

> **Para agentes de implementação:** leia a especificação vinculada e execute as tarefas em ordem, mantendo cada tarefa pequena, revisável e testável.

**Goal:** Entregar cada PDF de isca uma única vez no canal híbrido e deixar a campanha Embrapa de 1.253 leads enfileirada para iniciar às 8h BRT com cadência e bloqueios comerciais preservados.

**Architecture:** Uma rotina compartilhada decide a rota do documento, envia pela UAZAPI exclusivamente quando há rota híbrida válida e registra a saída via `ingestInbound`, incluindo o `meta_message_id` oficial quando existir. O fluxo conversacional ganha etiquetas declarativas por step; um script operacional validará a lista, o PDF e a configuração antes de gravar a campanha e a fila no Supabase Storage/PostgREST.

**Tech Stack:** Deno 2.x, TypeScript, Supabase PostgREST/Storage, Chatwoot API, EVO Hub, UAZAPI, testes `deno test`.

**Spec:** `docs/superpowers/specs/2026-09-24-isca-pdf-hibrido-e-campanha-design.md`

## Global Constraints

- Disparo somente entre 8h e 20h BRT; enfileirar fora da janela não pode enviar imediatamente.
- A campanha usa `capInicial: 50`, `capIncremento: 5`, `capMaximo: 1253`, `horaInicio: 8`, `horaFim: 20`.
- O canal 5895 é o único canal da campanha; o canal removido `david face` não deve reaparecer.
- Etiquetas `pago` e `não compra`, bot pause e bloqueios existentes continuam impedindo o envio.
- O ramo positivo aplica `interesse-silagem`; o ramo de recusa não aplica etiqueta.
- Nenhum lote é aplicado antes do teste individual no 5511910363320 comprovar uma única mensagem `document`.
- Segredos ficam em `.env`/armazenamento protegido; nenhum segredo ou CSV de telefones entra no commit.

---

### Task 1: Criar decisão testável e rotina compartilhada de entrega de documento

**Files:**
- Create: `bridge/shared/document-delivery.ts`
- Create: `bridge/tests/document-delivery.test.ts`
- Modify: `bridge/shared/inbound.ts`
- Test: `bridge/tests/document-delivery.test.ts`

**Interfaces:**
- Consumes: `DbClient`, `Json` de canal, `getHybridRoute`, `isHybridRecipient`, `hybridSendMedia`, `sendMeta`, `ingestInbound`, `CwAcct`.
- Produces: `sendFunnelDocument(db, channel, input, acct?)`, retornando `{ via: "hybrid" | "official"; providerMessageId: string | null }` ou lançando erro de envio.
- `input` tem `to`, `mediaUrl`, `fileName`, `caption`, `registro` e opcional `labels: string[]`.

- [ ] **Step 1: Escrever os testes da decisão de rota.**

```ts
const HYBRID: HybridRoute = {
  provider: "uazapi",
  instance: "5895",
  token: "test-token",
  channelId: "channel-test",
};

Deno.test("documento usa híbrido para destinatário brasileiro quando há rota", () => {
  assertEquals(decideDocumentRoute({ route: HYBRID, to: "5511910363320" }), "hybrid");
});

Deno.test("documento usa oficial para destinatário que não é telefone brasileiro", () => {
  assertEquals(decideDocumentRoute({ route: HYBRID, to: "bsuid-abc" }), "official");
});

Deno.test("documento usa oficial quando não há rota", () => {
  assertEquals(decideDocumentRoute({ route: null, to: "5511910363320" }), "official");
});
```

- [ ] **Step 2: Executar o teste para confirmar a falha inicial.**

Run: `deno test --allow-all --node-modules-dir=none bridge/tests/document-delivery.test.ts`

Expected: FAIL porque `decideDocumentRoute` e o módulo ainda não existem.

- [ ] **Step 3: Implementar a decisão e o envio.**

```ts
export function decideDocumentRoute(input: {
  route: HybridRoute | null;
  to: string;
}): "hybrid" | "official" {
  return input.route && isHybridRecipient(input.to) ? "hybrid" : "official";
}
```

`sendFunnelDocument` deve buscar `channel_token` apenas para o caminho oficial; no caminho híbrido deve chamar `hybridSendMedia` e, se o retorno for nulo ou não-OK, lançar erro sem tentar o envio oficial. Depois de uma entrega aceita, chamar `ingestInbound` com `outgoing: true`, `msgType: "document"`, `content: registro`, `acct` e `labels`. No caminho oficial, extrair o WAMID da resposta de `sendMeta` e passá-lo como `metaMessageId` ao `ingestInbound`, para o eco oficial cair no claim existente.

- [ ] **Step 4: Adicionar a aplicação idempotente de etiquetas de saída ao ingest.**

Acrescentar `labels?: string[]` a `IngestInboundMessage`. Depois da inserção da mensagem, quando `msg.outgoing`, houver conversa Chatwoot e `labels` não estiver vazio, ler as etiquetas atuais e chamar `setConversationLabels` com a união sem duplicatas. Falha de etiqueta deve ser registrada em log e não desfazer a entrega.

- [ ] **Step 5: Rodar os testes da tarefa.**

Run: `deno test --allow-all --node-modules-dir=none bridge/tests/document-delivery.test.ts bridge/tests/flow.test.ts`

Expected: PASS.

- [ ] **Step 6: Commitar a unidade.**

```bash
git add bridge/shared/document-delivery.ts bridge/shared/inbound.ts bridge/tests/document-delivery.test.ts
git commit -m "fix: centralizar entrega deduplicada de documentos"
```

### Task 2: Migrar as três sequências de PDF para a rotina compartilhada

**Files:**
- Modify: `bridge/handlers/hub-webhook.ts:2027-2198` (plantio)
- Modify: `bridge/handlers/hub-webhook.ts:2530-2676` (nutrição)
- Modify: `bridge/handlers/hub-webhook.ts:2823-2920` (isca)
- Modify: imports no topo de `bridge/handlers/hub-webhook.ts`
- Test: `bridge/tests/document-delivery.test.ts`

**Interfaces:**
- Consumes: `sendFunnelDocument` da Task 1 e o registro `Isca` já carregado.
- Produces: as mesmas sequências públicas; apenas a entrega do documento muda de rota e de registro.

- [ ] **Step 1: Cobrir o contrato de chamada no teste.**

Adicionar uma fixture de isca com `registro`, `fileName`, `caption` e `labels`, verificando que o contrato aceita a etiqueta somente na entrega da isca.

- [ ] **Step 2: Substituir o bloco PDF de plantio.**

Manter a consulta do slot `plantio_pdf` e a pausa de 3 segundos, mas trocar o objeto `sendMeta`/`registra` por `sendFunnelDocument` com registro `[PDF Instruções de Plantio]` e sem etiquetas.

- [ ] **Step 3: Substituir o bloco PDF de nutrição.**

Manter a consulta do slot `nutricao_pdf` e a pausa de 3 segundos, mas usar `sendFunnelDocument` com o mesmo nome, legenda e registro atuais, sem etiquetas.

- [ ] **Step 4: Substituir a entrega da isca.**

Usar `sendFunnelDocument` com `registro = [isca ${isca.id}] ${isca.filename}` e `labels = [isca.etiqueta]`; remover o registro Chatwoot manual e a inserção manual em `messages`, mantendo a aplicação de etiqueta somente pelo helper. Preservar a validação posterior de erro Meta e o retorno de `handleMenuClick`.

- [ ] **Step 5: Verificar tipos e testes focados.**

Run: `deno check --node-modules-dir=none bridge/shared/document-delivery.ts bridge/shared/inbound.ts bridge/handlers/hub-webhook.ts`

Run: `deno test --allow-all --node-modules-dir=none bridge/tests/document-delivery.test.ts bridge/tests/sync-chatwoot-out.test.ts`

Expected: PASS sem mudança nos testes de sincronização.

- [ ] **Step 6: Commitar a migração.**

```bash
git add bridge/handlers/hub-webhook.ts bridge/shared/document-delivery.ts bridge/shared/inbound.ts bridge/tests/document-delivery.test.ts
git commit -m "fix: entregar PDFs de funil pela rota híbrida"
```

### Task 3: Permitir etiquetas declarativas no fluxo da campanha

**Files:**
- Modify: `bridge/shared/flow.ts`
- Modify: `bridge/shared/flow-record.ts`
- Modify: `bridge/tests/flow.test.ts`
- Modify: `bridge/tests/flow-runner.test.ts`

**Interfaces:**
- Consumes: `FlowStep` e `gravadorDeFluxo` existentes.
- Produces: `FlowStep.labels?: string[]`; o callback de registro passa essas etiquetas a `ingestInbound` depois que o step foi aceito pelo provedor.

- [ ] **Step 1: Escrever teste de validação e transporte de etiquetas.**

Adicionar um step `media` com `labels: ["interesse-silagem"]` ao fixture de fluxo e verificar que `validateFlow` não o rejeita; adicionar uma asserção do texto/tipo do step para garantir que a extensão não altera o payload.

- [ ] **Step 2: Implementar a propriedade opcional.**

Adicionar `labels?: string[]` ao tipo `FlowStep`, sem criar uma etiqueta implícita em steps antigos.

- [ ] **Step 3: Encaminhar etiquetas pelo gravador.**

Em `gravadorDeFluxo`, chamar `ingestInbound` com `labels: step.labels`; o callback continua capturando falhas de registro sem interromper a mensagem já enviada.

- [ ] **Step 4: Rodar os testes de fluxo.**

Run: `deno test --allow-all --node-modules-dir=none bridge/tests/flow.test.ts bridge/tests/flow-runner.test.ts`

Expected: PASS.

- [ ] **Step 5: Commitar a extensão.**

```bash
git add bridge/shared/flow.ts bridge/shared/flow-record.ts bridge/tests/flow.test.ts bridge/tests/flow-runner.test.ts
git commit -m "feat: permitir etiquetas nos steps de fluxo"
```

### Task 4: Criar preparador seguro da campanha sem versionar a lista de telefones

**Files:**
- Create: `ops/prepare-isca-campaign.mjs`
- Create: `ops/prepare-isca-campaign.test.mjs`
- Modify: `.gitignore` somente se necessário para manter o CSV local fora do Git

**Interfaces:**
- Consumes: caminho de CSV fornecido em `--csv`, `.env`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SCHEMA`.
- Produces: em `--dry-run`, relatório sem escrita; em `--apply`, uma campanha em `soberano-config/campaigns.json` e linhas `pending` em `campaign_queue`.

- [ ] **Step 1: Escrever o teste de normalização e validação.**

```js
assert.deepEqual(normalizePhones("(11) 91036-3320\n5511910363320\n"), ["5511910363320"]);
assert.throws(() => validateCampaignList(Array(1252).fill("5511999999999")), /1253/);
```

- [ ] **Step 2: Implementar o parser fail-closed.**

Aceitar coluna `telefone`, `phone` ou a primeira coluna; normalizar para dígitos; remover duplicados; exigir exatamente 1.253 números E.164 brasileiros; rejeitar arquivo ausente, linhas inválidas, duplicatas que reduzam a lista ou qualquer valor fora de `55` com 12–13 dígitos. Nunca imprimir nomes completos ou telefones no relatório.

- [ ] **Step 3: Implementar o manifesto de campanha.**

Usar ID fixo `isca-embrapa-sul-sudeste-5895-2026-09-25`, rejeitar `--apply` se já existir uma campanha com esse ID ou filas não canceladas para ele, buscar o canal WhatsApp pelo número 5895 e buscar `isca_silagem_capa`/`isca_silagem` ativos. Criar o fluxo com steps `oferta` (buttons e imagem), `quero` (document com `labels: ["interesse-silagem"]`, depois `end`) e `nao` (text, depois `end`).

- [ ] **Step 4: Implementar o modo `--dry-run`.**

Mostrar somente `{ campaignId, channelId, total: 1253, pdfFound: true, coverFound: true, pace }`, sem Storage upload nem upsert no banco. O modo padrão deve ser `--dry-run`; `--apply` é obrigatório para qualquer escrita.

- [ ] **Step 5: Implementar `--apply` em duas escritas verificáveis.**

Fazer upload upsert de `campaigns.json` preservando campanhas existentes e, em seguida, upsertar `campaign_queue` em lotes de 500 com `campaign_id`, `contact_key`, `channel_id`, `status: "pending"`. Depois reler e exigir 1.253 linhas dessa campanha, todas `pending`.

- [ ] **Step 6: Testar o script sem dados reais.**

Run: `node --test ops/prepare-isca-campaign.test.mjs`

Expected: PASS para lista válida, deduplicação, rejeição de contagem incorreta e `--dry-run` sem chamadas de escrita.

- [ ] **Step 7: Commitar somente o preparador e a regra de exclusão do CSV.**

```bash
git add ops/prepare-isca-campaign.mjs ops/prepare-isca-campaign.test.mjs .gitignore
git commit -m "ops: preparar campanha Embrapa com dry-run"
```

### Task 5: Validar o build e publicar o fix

**Files:**
- Modify: `bridge/server.ts` no identificador de `build`
- Test: todos os arquivos `bridge/tests/`

**Interfaces:**
- Consumes: as três tarefas anteriores.
- Produces: build identificável no endpoint `/version`.

- [ ] **Step 1: Rodar checagem de tipos.**

Run: `deno check --node-modules-dir=none bridge/shared/document-delivery.ts bridge/shared/inbound.ts bridge/shared/flow.ts bridge/shared/flow-record.ts bridge/handlers/hub-webhook.ts bridge/server.ts`

Expected: exit code 0.

- [ ] **Step 2: Rodar a suíte completa.**

Run: `deno test --allow-all --node-modules-dir=none bridge/tests/`

Expected: todos os testes passam. Se o Deno repetir o panic de pipe do Windows observado no baseline, executar cada arquivo individualmente, registrar o panic como falha de infraestrutura e não como falha de aplicação.

- [ ] **Step 3: Atualizar o build.**

Trocar o valor atual por `2026-09-24-isca-pdf-hibrido-campanha` sem alterar a lista de features.

- [ ] **Step 4: Revisar diff e commitar.**

```bash
git diff --check
git status --short
git add bridge/server.ts
git commit -m "chore: identificar build da correção de isca"
```

- [ ] **Step 5: Publicar e confirmar saúde.**

Enviar a branch isolada para `origin/master`, acionar o deploy Coolify do servidor `m8qf6ru2x75gukzozpsrssrm` via API com os valores já existentes em `.env` e consultar `/version`, exigindo o novo build e `uptime_s` baixo.

### Task 6: Testar o PDF no 3320 e só então armar a campanha

**Files:**
- No arquivo versionado; executar `ops/prepare-isca-campaign.mjs` com o CSV operacional fora do Git.

**Interfaces:**
- Consumes: build publicado, credenciais em `.env`, lista operacional `5895-sul-sudeste-1253.csv` e fluxo definido na Task 4.
- Produces: evidência de uma entrega no 3320 e fila de 1.253 itens para o dia seguinte.

- [ ] **Step 1: Enviar a oferta individual pela UAZAPI 5895.**

Usar `POST {UAZAPI_URL}/send/menu` com `number: "5511910363320"`, texto e botões da isca, capa ativa e `readchat: true`; resolver o token da instância pelo endpoint administrativo sem registrar o token.

- [ ] **Step 2: Acionar o clique do 3320 e verificar a entrega.**

Consultar `messages` no canal 5895/conversa do 3320 após o clique; exigir exatamente uma linha de `msg_type=document` para a isca e nenhuma nova linha nos minutos seguintes. Se houver duplicata, pausar o trabalho e não aplicar a campanha.

- [ ] **Step 3: Executar o dry-run da campanha.**

```powershell
node ops/prepare-isca-campaign.mjs --csv ops/5895-sul-sudeste-1253.csv --dry-run
```

Exigir `total: 1253`, `pdfFound: true`, `coverFound: true`, canal 5895 e pace exatamente configurado.

- [ ] **Step 4: Aplicar a campanha após o teste verde.**

```powershell
node ops/prepare-isca-campaign.mjs --csv ops/5895-sul-sudeste-1253.csv --apply
```

Reler a campanha e a fila; exigir 1.253 pendentes, zero enviados e o ID fixo da campanha. A janela do loop fará o primeiro envio somente às 8h BRT.

- [ ] **Step 5: Registrar o handoff operacional.**

Salvar no relatório final o build, horário do teste, contagem do 3320, campaign ID, contagem da fila e qualquer item pulado; não registrar tokens, nomes ou telefones.

## Verificação final do plano

- A correção de rota, o registro Chatwoot, a etiqueta, a configuração de ritmo, o teste individual, o deploy e o enfileiramento têm tarefas explícitas.
- Não há dependência de um CSV versionado nem escrita silenciosa: o script começa em `--dry-run` e exige `--apply`.
- Os nomes de funções, campos, arquivos e comandos usados nas tarefas correspondem ao código e às migrations presentes no `origin/master`.
