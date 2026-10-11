# Funis sociais do Soberano no n8n Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar as 14 ações comerciais editáveis no n8n e o funil completo de 31 peças aos quatro canais comerciais de Instagram/Facebook aprovados, com envio ordenado, janela Meta e observabilidade, preservando o 5895.

**Architecture:** Uma lista de IDs autoriza os quatro canais sociais. O bridge identifica a entrada e valida conversa/canal/versão; cada ação usa o workflow n8n já existente, que produz as peças; a fila única do bridge transporta e confirma cada envio. A versão social tem identidade própria, e o adaptador Meta transforma mídia e botões sem duplicar o conteúdo dos workflows.

**Tech Stack:** Deno/TypeScript no bridge, Supabase PostgreSQL, n8n MCP/API, Meta Messenger/Instagram, Chatwoot, Next.js no painel.

**Spec:** `docs/superpowers/specs/2026-10-11-funis-sociais-n8n-design.md`

## Global Constraints

- Canais incluídos: Facebook `campo soberano` e `Mega Sorgo Santa Elisa`; Instagram `Atendimento IG` e `sorgo brasileiro`. Instagram `david inst` fica excluído.
- São 14 ações: `funil`, `preco`, `video`, `plantio`, `nutricao`, `recuperacao-1` a `recuperacao-4`, `catalogo`, `catalogo-sair`, `pause`, `resume`, `stop`.
- O funil principal tem 31 peças em cinco fases, fiéis a 30/09; a identidade WhatsApp existente é `mega-sorgo-5895-20260930`.
- Preços: 2 kg R$ 179,90; 4 kg R$ 341,62; 10 kg R$ 764,15; 20 kg R$ 1.437,90; não publicar promoções vencidas.
- Operação entre 06h e 21h de Fortaleza; abertura elegível dentro desse horário busca a primeira resposta em até 15 segundos.
- Sem inscrição retroativa em massa, sem reenvio automático após resposta incerta ou parcial do provedor, sem ampliar a janela Meta por inferência.
- `sent` significa aceitação positiva pelo emissor; recibo de entrega/leitura é evidência separada.
- A migração ativa um canal por vez após teste real controlado. O 5895 continua operacional durante a implantação.

---

## Mapa de arquivos e interfaces

| Arquivo | Responsabilidade |
| --- | --- |
| `bridge/shared/social-channel-allowlist.ts` (novo) | Interpretar os quatro IDs configurados e validar tipo/ID sem depender do nome exibido. |
| `bridge/shared/funnel-identity.ts` | Acrescentar identidade social, rótulo e resolução do funil principal por canal. |
| `bridge/shared/n8n-action-contract.ts` | Manter as 14 ações e acrescentar contexto de canal/versão à identidade idempotente. |
| `bridge/handlers/funil-enroll.ts` | Inscrever apenas conversas sociais novas e elegíveis; anexo inicial pode preceder pergunta comercial. |
| `bridge/handlers/hub-webhook.ts`, `bridge/handlers/sync-facebook.ts` | Passar referência Meta e evento de entrada ao detector; reavaliar pausa de janela após nova mensagem. |
| `bridge/handlers/funil-control.ts` | Acionar as 14 ações no n8n para canais aprovados, com identidade social. |
| `bridge/handlers/n8n-action-enqueue.ts`, `bridge/handlers/n8n-action-send-now.ts` | Validar lote e primeira peça pelo par canal/versão; reservar e enfileirar sem duplicata. |
| `bridge/shared/funnel-queue.ts`, `bridge/handlers/send-outbound.ts`, `bridge/shared/window.ts` | Garantir um emissor, ordem, horário e pausa `window_closed` com retomada segura. |
| `bridge/shared/social-funnel.ts`, `bridge/shared/audio.ts` | Adaptar as peças n8n às capacidades do Instagram e Messenger. |
| `bridge/handlers/operational-health.ts`, `web/app/funil/page.jsx` | Mostrar por canal origem, versão, latência, status, pausa e evidência do provedor. |
| `ops/n8n-soberano-social-workflows.md` (novo) | Inventariar IDs e versões dos 14 workflows, credenciais, configuração e implantação por canal. |
| `bridge/tests/*.test.ts` | Cobrir autorização, entrada, contrato, fila, janela, mídia e regressão 5895. |

## Task 1: Inventário e autorização dos quatro canais

**Files:**
- Create: `bridge/shared/social-channel-allowlist.ts`
- Modify: `bridge/shared/funnel-identity.ts`
- Create: `bridge/tests/social-channel-allowlist.test.ts`
- Modify: `bridge/tests/funnel-identity.test.ts`
- Create: `ops/n8n-soberano-social-workflows.md`

**Interfaces:**
- Produces: `SOCIAL_N8N_FUNNEL = "mega-sorgo-social-20260930"`.
- Produces: `isApprovedSocialChannel(channel: Record<string, unknown>, ids?: ReadonlySet<string>): boolean`.
- Produces: `funnelVersionForChannel(channel): string | null`; 5895 resolve para `RESTORED_5895_FUNNEL`, social aprovado para `SOCIAL_N8N_FUNNEL`, outros para `null` no caminho n8n.

- [ ] **Step 1: Consultar `channels` somente para leitura e registrar em `ops/n8n-soberano-social-workflows.md` os IDs, tipo e nome dos quatro canais; confirmar que o ID de `david inst` é diferente e não entra na lista.** Usar a conexão Supabase já configurada no projeto; não imprimir tokens, contatos ou mensagens.
- [ ] **Step 2: Escrever teste que rejeita ID não configurado, nome igual com ID diferente e `david inst`, e aceita um ID de Facebook e outro de Instagram.**

```ts
Deno.test("social allowlist requires exact configured id and social type", () => {
  const ids = new Set(["fb-approved", "ig-approved"]);
  assert(isApprovedSocialChannel({ id: "fb-approved", type: "facebook" }, ids));
  assert(isApprovedSocialChannel({ id: "ig-approved", type: "instagram" }, ids));
  assert(!isApprovedSocialChannel({ id: "other", name: "campo soberano", type: "facebook" }, ids));
  assert(!isApprovedSocialChannel({ id: "ig-approved", type: "whatsapp" }, ids));
});
```

- [ ] **Step 3: Rodar o teste dirigido e confirmar falha por símbolo ausente.** `deno test --allow-env bridge/tests/social-channel-allowlist.test.ts`
- [ ] **Step 4: Fixar os quatro IDs aprovados e ler `SOBERANO_SOCIAL_CHANNEL_IDS` como subconjunto distinto de um a quatro IDs para ativação gradual; falhar fechado quando ausente, repetido ou desconhecido.**

```ts
export function configuredSocialChannelIds(raw = Deno.env.get("SOBERANO_SOCIAL_CHANNEL_IDS") ?? ""): ReadonlySet<string> {
  const ids = raw.split(",").map((id) => id.trim()).filter(Boolean);
  return ids.length > 0 && ids.length <= 4 && new Set(ids).size === ids.length &&
      ids.every((id) => APPROVED_SOCIAL_CHANNEL_IDS.has(id)) ? new Set(ids) : new Set();
}
export function isApprovedSocialChannel(channel: Record<string, unknown>, ids = configuredSocialChannelIds()): boolean {
  return ["facebook", "instagram"].includes(String(channel.type ?? "")) && ids.has(String(channel.id ?? ""));
}
```

- [ ] **Step 5: Adicionar identidade social e rótulo no módulo de identidade, sem mudar o resultado do 5895 e do legado fora da rota nova.** Atualizar consulta de `mainFunnelForConversation` para selecionar também `id,type`.
- [ ] **Step 6: Rodar os dois testes e commitar apenas estes arquivos.** `deno test --allow-env bridge/tests/social-channel-allowlist.test.ts bridge/tests/funnel-identity.test.ts`; `git commit -m "feat: identify approved Soberano social channels"`.

## Task 2: Detectar o lead social e preservar a sequência existente

**Files:**
- Modify: `bridge/handlers/funil-enroll.ts`
- Modify: `bridge/handlers/hub-webhook.ts`
- Modify: `bridge/handlers/sync-facebook.ts`
- Modify: `bridge/tests/abertura-anuncio-social.test.ts`
- Modify: `bridge/tests/social-sales.test.ts`

**Interfaces:**
- Consumes: `isApprovedSocialChannel` e `SOCIAL_N8N_FUNNEL` da Task 1.
- Produces: `socialLeadEntry(...)` com resultados `ad_referral | commercial_fallback | ineligible`; o resultado segue no evento de inscrição, sem inventar referência Meta.

- [ ] **Step 1: Adicionar casos que exercitam mensagem de anúncio com texto arbitrário, anexo inicial seguido de pergunta comercial na segunda/terceira entrada em cinco minutos, quarta entrada, conversa antiga e duplicação anúncio/macro.**

```ts
assertEquals(socialLeadEntry({ referral: { source: "ADS" }, inboundIndex: 1, ageMs: 0, text: "oi" }), "ad_referral");
assertEquals(socialLeadEntry({ inboundIndex: 2, ageMs: 90_000, text: "qual o preço?" }), "commercial_fallback");
assertEquals(socialLeadEntry({ inboundIndex: 4, ageMs: 90_000, text: "qual o preço?" }), "ineligible");
assertEquals(socialLeadEntry({ inboundIndex: 2, ageMs: 301_000, text: "qual o preço?" }), "ineligible");
```

- [ ] **Step 2: Rodar testes dirigidos e confirmar falha.** `deno test --allow-env bridge/tests/abertura-anuncio-social.test.ts bridge/tests/social-sales.test.ts`
- [ ] **Step 3: Mover o guarda 5895 em `autoEnrollFunil` para uma bifurcação explícita: 5895 mantém a rota atual; canal social aprovado usa a versão social; demais retornam sem inscrição.** Um anexo isolado não autoriza fallback. Consultar estado de `sales_sequences` nas identidades social e legada antes da reserva; não abrir nova versão se houver execução antiga, concluída, pausada ou cancelada.
- [ ] **Step 4: Passar os metadados de referência Meta dos handlers de entrada ao detector e gravar `ad_referral` ou `commercial_fallback` em `events.payload`, sem copiar conteúdo ou telefone para o log.**
- [ ] **Step 5: Garantir que o acionamento de `preco` em uma entrada não retorna antes da inscrição principal.** A sequência principal e a resposta de preço têm IDs e peças próprios; a agenda coloca preço no próximo intervalo disponível.
- [ ] **Step 6: Rodar testes de entrada e regressão 5895 e commitar.** `deno test --allow-env bridge/tests/abertura-anuncio-social.test.ts bridge/tests/social-sales.test.ts bridge/tests/funil-anuncio.test.ts`; `git commit -m "feat: enroll eligible social leads without legacy duplicates"`.

## Task 3: Contrato n8n multicanal e validação de lote

**Files:**
- Modify: `bridge/shared/n8n-action-contract.ts`
- Modify: `bridge/shared/n8n-action-router.ts`
- Modify: `bridge/handlers/n8n-action-enqueue.ts`
- Modify: `bridge/handlers/n8n-action-send-now.ts`
- Modify: `bridge/tests/n8n-action-contract.test.ts`
- Modify: `bridge/tests/n8n-action-enqueue.test.ts`
- Modify: `bridge/tests/n8n-action-send-now.test.ts`

**Interfaces:**
- Consumes: `funnelVersionForChannel` da Task 1.
- Produces: o mesmo `ActionRequest` com `funnel_version` igual à versão do canal e `actionKey` incluindo a versão; webhook `/webhook/soberano-5895-<action>` continua válido e passa o mesmo contrato aos 14 workflows.

- [ ] **Step 1: Escrever teste para `actionKey` distinto entre versões, lote social com 31 peças, rejeição de versão 5895 em conversa social, rejeição de versão social em `david inst`, e `send-now` limitado à primeira peça da solicitação.**

```ts
const a = { request_id: "evt-1", source: "ad", chatwoot_conversation_id: 3520, action: "funil", funnel_version: RESTORED_5895_FUNNEL } as const;
assertNotEquals(actionKey(a), actionKey({ ...a, funnel_version: SOCIAL_N8N_FUNNEL }));
```

- [ ] **Step 2: Rodar testes e confirmar as falhas esperadas.** `deno test --allow-env bridge/tests/n8n-action-contract.test.ts bridge/tests/n8n-action-enqueue.test.ts bridge/tests/n8n-action-send-now.test.ts`
- [ ] **Step 3: Validar o par canal/versão depois de carregar `conversations.channel_id` e `channels.id,type`.** `validateEnqueueBody` aceita apenas as duas versões conhecidas; `handle` exige correspondência do canal real; controles passam ao `funil-control` somente após essa validação.
- [ ] **Step 4: Substituir os usos fixos de `RESTORED_5895_FUNNEL` na reserva, na consulta de existência e em `buildActionRows` por `request.funnel_version`.** A chave de deduplicação passa a incluir a versão para não colidir entre rotas.
- [ ] **Step 5: Aplicar a mesma validação ao envio imediato, incluindo `row.funnel`, `row.chatwoot_conversation_id`, `payload.__funnel_sequence_id` e a posse do canal.** Nenhuma peça social pode sair por solicitação 5895.
- [ ] **Step 6: Rodar os três testes e commitar.** `deno test --allow-env bridge/tests/n8n-action-contract.test.ts bridge/tests/n8n-action-enqueue.test.ts bridge/tests/n8n-action-send-now.test.ts`; `git commit -m "feat: validate n8n actions by channel and funnel version"`.

## Task 4: Conectar todas as ações de macro, intenção e botão ao n8n

**Files:**
- Modify: `bridge/handlers/funil-control.ts`
- Modify: `bridge/handlers/hub-webhook.ts`
- Modify: `bridge/shared/n8n-recovery.ts`
- Modify: `bridge/tests/n8n-action-router.test.ts`
- Modify: `bridge/tests/n8n-recovery.test.ts`
- Modify: `bridge/tests/restored-funnel-buttons.test.ts`

**Interfaces:**
- Consumes: versão validada do canal e `dispatchSoberanoAction(ActionRequest)`.
- Produces: as 14 ações sociais passam pelo mesmo webhook de cada ação; o antigo `mega-sorgo` deixa de criar novas peças nesses quatro canais.

- [ ] **Step 1: Registrar testes de roteamento para os 14 nomes de ação em social aprovado, 5895 e canal excluído.** Assertar que uma seleção `preco_cotar_tam_2kg` preserva `selection` e `quote_registered`, e que preço não cancela o `funil`.
- [ ] **Step 2: Rodar os testes dirigidos e confirmar a falha social.** `deno test --allow-env bridge/tests/n8n-action-router.test.ts bridge/tests/n8n-recovery.test.ts bridge/tests/restored-funnel-buttons.test.ts`
- [ ] **Step 3: Trocar os guardas que verificam apenas `RESTORED_5895_FUNNEL` por resolução explícita 5895/social em `funil-control` e nas rotas de intenção, clique e recuperação do `hub-webhook`.** Manter regras exatas de pausa, retomada, parada, bloqueio comercial e atribuição humana.
- [ ] **Step 4: Associar cada recuperação à versão base da conversa em `n8n-recovery.ts`, usando sufixo `:<action>` sem reabrir a sequência principal nem recriar conteúdo no bridge.**
- [ ] **Step 5: Rodar os testes e commitar.** `deno test --allow-env bridge/tests/n8n-action-router.test.ts bridge/tests/n8n-recovery.test.ts bridge/tests/restored-funnel-buttons.test.ts`; `git commit -m "feat: route social macros and intents through n8n"`.

## Task 5: Adaptar mídia, botões e aceitação parcial da Meta

**Files:**
- Modify: `bridge/shared/social-funnel.ts`
- Modify: `bridge/shared/audio.ts`
- Modify: `bridge/handlers/send-outbound.ts`
- Modify: `bridge/tests/social-funnel.test.ts`
- Modify: `bridge/tests/social-attachment-auth.test.ts`
- Modify: `bridge/tests/outbound-dedup.test.ts`

**Interfaces:**
- Consumes: `QueuePiece` de `n8n-action-enqueue.ts` e canal `facebook | instagram`.
- Produces: `accepted`, `uncertain` ou `failed` por chamada do provedor; listas expandidas mantêm índice e recibo de cada parte.

- [ ] **Step 1: Criar fixtures de cada tipo das 31 peças (`text`, `image`, `video`, `audio`, `interactive`, `list`) e das artes de preço, com respostas Meta aceitas, parciais e incertas.** Confirmar que áudio convertido é acessível ao emissor e que botões ficam dentro dos limites de cada plataforma.
- [ ] **Step 2: Rodar testes e confirmar falhas de casos ainda não tratados.** `deno test --allow-env bridge/tests/social-funnel.test.ts bridge/tests/social-attachment-auth.test.ts bridge/tests/outbound-dedup.test.ts`
- [ ] **Step 3: Fazer `renderSocialFunnelMessages` produzir partes ordenadas com índice estável; registrar confirmação de cada parte antes de avançar.** Se uma parte falhar ou ficar incerta, marcar a peça inteira como bloqueada para reconciliação e não repetir as partes aceitas.
- [ ] **Step 4: Conferir os URLs resolvidos por `resolveActionMedia`, a conversão `toSocialAudio` e as quatro artes de preço sem texto de promoção antiga.** Erro de mídia impede ativar o lote; não substituir silenciosamente por texto.
- [ ] **Step 5: Rodar os três testes e commitar.** `deno test --allow-env bridge/tests/social-funnel.test.ts bridge/tests/social-attachment-auth.test.ts bridge/tests/outbound-dedup.test.ts`; `git commit -m "feat: send n8n social media with partial receipt safety"`.

## Task 6: Fila única, horário e janela Meta

**Files:**
- Modify: `bridge/shared/funnel-queue.ts`
- Modify: `bridge/shared/window.ts`
- Modify: `bridge/handlers/send-outbound.ts`
- Modify: `bridge/handlers/hub-webhook.ts`
- Modify: `bridge/tests/funnel-queue-hours.test.ts`
- Modify: `bridge/tests/funil-pausa.test.ts`
- Modify: `bridge/tests/media-retention-janela.test.ts`

**Interfaces:**
- Consumes: as duas versões principais e os sufixos das ações.
- Produces: peça `pending`, `sent`, `paused(window_closed)`, `failed` ou `uncertain`; uma nova entrada do cliente pode reagendar apenas `window_closed` após reavaliar a janela real.

- [ ] **Step 1: Testar ordem por `conversation_id`, atraso entre fases, limite 06h–21h, janela social de 24h sem referral autorizado, pausa estruturada `window_closed`, retorno após nova mensagem e ausência de retentativa para `uncertain`.**
- [ ] **Step 2: Rodar testes e confirmar falha.** `deno test --allow-env bridge/tests/funnel-queue-hours.test.ts bridge/tests/funil-pausa.test.ts bridge/tests/media-retention-janela.test.ts`
- [ ] **Step 3: Fazer o consumidor aceitar a identidade social e ações derivadas sem entregar a mesma peça pelo cron n8n e pelo pump legado.** Usar `scheduled_message_id` e claim de entrega já existentes como chave única. A consulta do n8n deve ordenar por `send_at.asc` e paginar pendências vencidas, nunca ocultá-las por uma página de itens recentes.
- [ ] **Step 4: Ao fechar a janela Meta, gravar motivo estruturado `window_closed`, retirar a peça da rodada e preservar os intervalos.** Uma nova mensagem só reativa essa causa depois de validar a janela; pausas por humano, pagamento, não compra e comando manual ficam intocadas.
- [ ] **Step 5: Rodar os três testes e commitar.** `deno test --allow-env bridge/tests/funnel-queue-hours.test.ts bridge/tests/funil-pausa.test.ts bridge/tests/media-retention-janela.test.ts`; `git commit -m "feat: schedule social funnel within provider window"`.

## Task 7: Atualizar os 14 workflows compartilhados no n8n

**Files:**
- Modify: `ops/n8n-soberano-social-workflows.md`
- Modify: conteúdo dos 14 workflows já ativos no n8n, sem trocar seus IDs/webhooks do 5895.
- Modify: workflow consumidor `pQFCtRhzQTKqXTjS`.

**Interfaces:**
- Consumes: `ActionRequest.funnel_version`, `selection` e `quote_registered`.
- Produces: `POST /n8n-action-enqueue` com 31 peças na ação `funil`, e lote de cada ação complementar; `POST /n8n-action-send-now` somente para primeira peça vencida.

- [ ] **Step 1: Exportar e versionar em `ops/n8n-soberano-social-workflows.md` ID, versão ativa, nomes de nós e contagem de peças dos 14 workflows e do consumidor, antes de alterar qualquer um.** Não incluir segredo nem URL assinada de mídia.
- [ ] **Step 2: Em cada workflow, validar `funnel_version` contra as duas versões conhecidas e repassar a versão recebida ao lote.** O nó de conteúdo continua único por ação; 5895 e social compartilham texto, preços, mídia e offsets.
- [ ] **Step 3: Substituir cabeçalhos literais de acesso à fila pela credencial HTTP do n8n já autorizada para o projeto; conferir que o export dos workflows não contém tokens.**
- [ ] **Step 4: Atualizar o consumidor para ler ambos os funis principais e sufixos de ações, ordenar por `send_at.asc`, manter paginação e chamar somente o bridge para envio/estado.** O consumidor não altera `status` diretamente no Supabase.
- [ ] **Step 5: Executar cada workflow com entrada simulada 5895/social e comparar a estrutura do lote; depois publicar as versões e registrar seus IDs em `ops/n8n-soberano-social-workflows.md`.** As 14 ações devem ter exatamente um workflow ativo cada.
- [ ] **Step 6: Commmitar o inventário e evidências redigidas.** `git commit -m "docs: record shared n8n social workflows and versions"`.

## Task 8: Painel e alertas por canal

**Files:**
- Modify: `bridge/handlers/operational-health.ts`
- Modify: `web/app/funil/page.jsx`
- Modify: `bridge/tests/operational-alert.test.ts`
- Modify: `bridge/tests/funil-comercial-relatorio.test.ts`

**Interfaces:**
- Consumes: `events` de inscrição, `scheduled_messages`, `sales_sequences` e recibos do provedor.
- Produces: visão por canal/conversa com origem `ad_referral | commercial_fallback`, versão, tempo até primeira aceitação, contagens e motivo de pausa.

- [ ] **Step 1: Escrever fixtures com `window_closed` normal, falha de envio, resultado parcial e recibo tardio.** Assertar que pausa normal não aciona alerta de falha; envio incerto aciona conferência e `sent` não aparece como entregue.
- [ ] **Step 2: Rodar testes e confirmar falha.** `deno test --allow-env bridge/tests/operational-alert.test.ts bridge/tests/funil-comercial-relatorio.test.ts`
- [ ] **Step 3: Acrescentar filtros 5895/quatro canais e campos de versão, origem, latência e evidência separada no endpoint e na página; ocultar telefone e conteúdo em logs.**
- [ ] **Step 4: Rodar testes e commitar.** `deno test --allow-env bridge/tests/operational-alert.test.ts bridge/tests/funil-comercial-relatorio.test.ts`; `git commit -m "feat: expose social funnel delivery and window alerts"`.

## Task 9: Implantação gradual e aceite real

**Files:**
- Modify: `ops/n8n-soberano-social-workflows.md`
- Modify: configuração de `SOBERANO_SOCIAL_CHANNEL_IDS` no serviço bridge após obter os quatro IDs da Task 1.

**Interfaces:**
- Consumes: todos os componentes das Tasks 1–8.
- Produces: quatro canais publicados, sem inscrição retroativa e com evidências de funcionamento individuais.

- [ ] **Step 1: Rodar verificações dirigidas do bridge e da página, conferir diff e deploy do bridge/n8n; validar `/health` e `/version`.** `deno test --allow-env bridge/tests/social-channel-allowlist.test.ts bridge/tests/abertura-anuncio-social.test.ts bridge/tests/n8n-action-enqueue.test.ts bridge/tests/n8n-action-send-now.test.ts bridge/tests/social-funnel.test.ts bridge/tests/funnel-queue-hours.test.ts bridge/tests/operational-alert.test.ts`.
- [ ] **Step 2: Em cada plataforma, usar conversa de teste com janela aberta.** Primeiro ativar somente Facebook `campo soberano`; depois Facebook `Mega Sorgo Santa Elisa`; depois Instagram `Atendimento IG`; por fim Instagram `sorgo brasileiro`. Configurar allowlist progressivamente, sem inserir `david inst`.
- [ ] **Step 3: Em cada conversa de teste, acionar `funil` e `preco`, conferir 31 linhas ordenadas, primeira resposta elegível em até 15 segundos, botão, arte, áudio e vídeo, status Chatwoot e resposta do provedor.** Registrar recibo de entrega/leitura separadamente; sem prova de ausência, não repetir item incerto.
- [ ] **Step 4: Exercitar as 12 ações restantes com entradas controladas, incluindo pausa, retomada, parada e recuperação; comparar conteúdo n8n e fila.** Uma pergunta de preço durante a sequência não a interrompe.
- [ ] **Step 5: Consultar as primeiras inscrições reais de cada canal e verificar que não houve nova sequência `mega-sorgo`, que nenhuma conversa antiga foi reativada e que o WhatsApp 5895 mantém a versão restaurada.**
- [ ] **Step 6: Registrar IDs de execução, horários, versão dos workflows e resultado por canal no inventário, sem dados pessoais; commitar o relatório.** `git commit -m "docs: record social funnel rollout evidence"`.

## Autoavaliação do plano

- O inventário e a allowlist cobrem os quatro canais e a exclusão de `david inst`.
- As Tasks 2–4 cobrem detecção após anexo, idempotência, 31 peças e as 14 ações; a Task 5 cobre mídia e confirmação parcial; a Task 6 cobre horário/janela; a Task 8 cobre painel/alertas; a Task 9 cobre implantação controlada e regressão 5895.
- Os tipos centrais são `ActionRequest`, `QueuePiece`, `SOCIAL_N8N_FUNNEL`, `isApprovedSocialChannel` e `funnelVersionForChannel`, com a mesma grafia em todas as Tasks.
