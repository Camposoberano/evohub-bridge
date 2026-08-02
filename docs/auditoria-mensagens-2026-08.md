# Auditoria de mensagens, respostas e resultado — 08/2026

Levantamento feito raspando o endpoint `/relatorio` (que era público até esta auditoria —
ver defeito 9) para os 30 dias de 03/07 a 01/08/2026, dia a dia, sem precisar de nenhuma
credencial. O funil Mega Sorgo está em produção desde 11/07.

## 1. Série diária

| dia | conversas ativas | novas | recebidas | enviadas | out:in | entraram funil | pediram preço | pagamento | engajou | sem interação |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 03/07 | 0 | 0 | 0 | 0 | – | 0 | 0 | 0 | 0 | 0 |
| 04/07 | 1 | 1 | 2 | 0 | 0,0 | 0 | 0 | 0 | 0 | 1 |
| 05/07 | 1 | 1 | 2 | 0 | 0,0 | 0 | 0 | 0 | 0 | 1 |
| 06/07 | 2 | 2 | 5 | 0 | 0,0 | 0 | 0 | 0 | 0 | 1 |
| 07/07 | 0 | 0 | 0 | 0 | – | 0 | 0 | 0 | 0 | 0 |
| 08/07 | 1 | 1 | 1 | 0 | 0,0 | 0 | 0 | 0 | 0 | 1 |
| 09/07 | 1 | 1 | 1 | 0 | 0,0 | 0 | 0 | 0 | 0 | 1 |
| 10/07 | 0 | 0 | 0 | 0 | – | 0 | 0 | 0 | 0 | 0 |
| 11/07 | 2 | 2 | 3 | 35 | 11,7 | 2 | 0 | 0 | 1 | 1 |
| 12/07 | 14 | 12 | 60 | 339 | 5,7 | 12 | 4 | 0 | 12 | 2 |
| 13/07 | 24 | 10 | 74 | 293 | 4,0 | 21 | 2 | 1 | 12 | 11 |
| 14/07 | 14 | 8 | 62 | 250 | 4,0 | 12 | 2 | 1 | 10 | 3 |
| 15/07 | 49 | 12 | 63 | 332 | 5,3 | 33 | 2 | 2 | 23 | 24 |
| 16/07 | 19 | 2 | 27 | 120 | 4,4 | 17 | 0 | 0 | 9 | 10 |
| 17/07 | 82 | 0 | 121 | 484 | 4,0 | 43 | 3 | 1 | 35 | 46 |
| 18/07 | 20 | 13 | 60 | 350 | 5,8 | 19 | 3 | 1 | 13 | 6 |
| 19/07 | 35 | 17 | 101 | 528 | 5,2 | 33 | 10 | 1 | 23 | 11 |
| 20/07 | 36 | 19 | 146 | 525 | 3,6 | 31 | 6 | 4 | 23 | 9 |
| 21/07 | 59 | 11 | 94 | 482 | 5,1 | 54 | 8 | 2 | 24 | 33 |
| 22/07 | 29 | 11 | 119 | 456 | 3,8 | 25 | 8 | 2 | 17 | 10 |
| 23/07 | 23 | 11 | 67 | 294 | 4,4 | 21 | 2 | 0 | 14 | 9 |
| 24/07 | 55 | 17 | 119 | 597 | 5,0 | 51 | 6 | 2 | 26 | 27 |
| 25/07 | 45 | 11 | 101 | 556 | 5,5 | 45 | 4 | 2 | 14 | 29 |
| 26/07 | 37 | 16 | 66 | 555 | 8,4 | 37 | 6 | 0 | 20 | 17 |
| 27/07 | 69 | 12 | 80 | 708 | 8,8 | 69 | 9 | 0 | 28 | 40 |
| 28/07 | 64 | 16 | 116 | 697 | 6,0 | 62 | 7 | 2 | 23 | 39 |
| 29/07 | 67 | 15 | 122 | 686 | 5,6 | 62 | 5 | 0 | 25 | 42 |
| 30/07 | 42 | 13 | 125 | 606 | 4,8 | 39 | 3 | 1 | 19 | 22 |
| 31/07 | 38 | 11 | 75 | 363 | 4,8 | 35 | 2 | 0 | 23 | 15 |
| 01/08 | 38 | 9 | 32 | 274 | 8,6 | 34 | 1 | 0 | 13 | 25 |

**Nota**: "pediram preço" nesta tabela é o número que o relatório mostrava ANTES desta
auditoria — na prática mede o bot ter entregado a tabela de preço (fingerprint de saída),
não o lead ter pedido (ver defeito 4). Depois da correção (seção 3), os dois números passam
a aparecer separados.

## 2. Agregados semanais

| Semana | Enviadas | Recebidas | out:in | Entraram funil | "Pediram preço" (métrica antiga) | Pagamento |
|---|---:|---:|---:|---:|---:|---:|
| 12–18/07 | 2.168 | 467 | 4,6:1 | 157 | 16 (10,2%) | 6 |
| 19–25/07 | 3.438 | 747 | 4,6:1 | 260 | 44 (16,9%) | 13 |
| 26/07–01/08 | 3.889 | 616 | 6,3:1 | 338 | 33 (9,8%) | **3** |

**30 dias**: 9.530 enviadas / 1.844 recebidas (5,2:1) · 757 entradas de funil → 93 "pediram
preço" (12,3%) → 22 pagamentos (2,9%) · 59 falhas de envio · **50% das conversas ativas
(436/867) nunca responderam nada** (`Sem interação` na tabela acima).

Na última semana o volume subiu (envio +13%, entradas +30%) e o resultado caiu (pagamento
13 → 3, −77%). Esse sinal é real, mas três dos números que o compõem não eram confiáveis —
é isso que a seção 3 corrige.

## 3. Defeitos de instrumentação encontrados (e corrigidos nesta mudança)

Todos verificados no código antes de qualquer correção.

### 1. `msg_type` errado em ~95% do inbound
`uazapi-webhook.ts` lia `mediaType`/`messageType` cru da uazapi (`conversation`,
`extendedTextMessage`, `imageMessage`, `ptt`…) e o normalizador só aceitava o enum do
Postgres — tudo que não casava virava `unknown`. Medido na amostra de 5 dias: 95% do
inbound e ~32% do outbound gravados sem tipo. Nenhum recorte por tipo de mensagem era
possível.
**Corrigido**: `bridge/shared/msg-type.ts` (novo) — tabela de alias uazapi/Baileys/Meta →
enum, usada nos dois sentidos (`bridge/shared/inbound.ts`, `bridge/handlers/send-outbound.ts`).
Tipo que não casar com nada continua `unknown`, mas agora loga (`isUnmappedMsgType`) em vez
de sumir silenciosamente.

### 2. Duplicata de echo inflando o volume
6,5% das linhas de uma amostra de 30 dias eram duplicatas reais no banco: mesmo minuto,
mesmo texto, uma linha `text` e outra `unknown` — o echo do WhatsApp (coexistência) entrava
como registro novo em vez de casar com o insert do envio original. O relatório escondia
isso só na renderização (dedupe em memória); o dado gravado em `messages` — e por tabela,
`daily_metrics` — continuava inflado.
**Corrigido**: `bridge/shared/inbound.ts` — echo de saída (`msg.outgoing`) agora casa com a
linha já gravada pelo envio (mesma conversa/conteúdo, janela de 30s) e completa
`meta_message_id` nela, em vez de inserir uma segunda linha.

### 3. "Perguntas que o bot não sabe responder" não media isso
Só coletava a mensagem quando era a primeira da conversa (`convOut === 0`) — por isso o
topo do ranking era sempre a mensagem padrão do anúncio CTWA ("olá! posso ter mais
informações..."), não uma pergunta sem resposta de verdade.
**Corrigido**: `bridge/handlers/relatorio.ts` — agora coleta qualquer inbound que não bata
com nenhum intent reconhecido (`bridge/shared/intent.ts`), excluindo a mensagem padrão do
anúncio, saudação isolada e reação curta (emoji/"ok").

### 4. O funil de 3 etapas era uma tautologia
"Pediram preço" e os "Intents Disparadas" vinham de conteúdo de **saída** (o bot ter
mandado a tabela de preço/vídeos/plantio/nutrição), não de o lead ter pedido.
**Corrigido**: `relatorio.ts` agora separa `leadPediuX` (intent detectada no texto/clique de
**entrada**, mesma detecção que o bot usa em produção) de `botEntregouX` (fingerprint de
saída, mantido para a etapa visual do funil). O card de preço mostra os dois números lado a
lado; uma recomendação nova dispara quando "pediram" > "entregou" (lead perguntou e o bot
não respondeu).

### 5. Nenhuma correlação entre resposta e a mensagem que a provocou
`messages` não tinha `reply_to`, `funnel`, `funnel_day`, `funnel_step` nem
`scheduled_message_id`; o `context.id` do WhatsApp (resposta citada) nunca era lido. Era
impossível responder "qual mensagem da sequência faz o lead responder" — a pergunta central
desta auditoria.
**Corrigido (parcial, habilita a próxima auditoria)**: `supabase/migrations/0012_message_funnel_link.sql`
adiciona as 4 colunas (nullable, sem backfill). `bridge/shared/funnel-queue.ts` →
`bridge/handlers/send-outbound.ts` já propagam `funnel`/`funnel_day`/`funnel_step`/
`scheduled_message_id` para os envios que passam pela fila do funil. Envios manuais/outros
caminhos (`hub-webhook.ts`, `catalog.ts`, `chatwoot-webhook.ts`) continuam sem o elo — o
volume principal do funil Mega Sorgo já fica coberto.

### 6. Tempo de resposta nunca foi medido
`conversations.first_response_at` existe desde a criação da tabela e nunca era escrita;
`avg_first_response_s` ficava marcado "TODO Fase 4" em `metrics-rollup.ts`.
**Corrigido**: `supabase/migrations/0011_first_response_trigger.sql` — trigger
`mark_first_response` no Postgres (roda em qualquer insert de saída, não depende de
instrumentar os ~16 pontos de código que inserem mensagem), mais backfill do histórico
existente. `metrics-rollup.ts` agora calcula `avg_first_response_s` a partir disso.

### 7. Catálogo engolindo pergunta em silêncio
`catalog.ts` (`routeCatalogText`) só tratava intenção de preço e **sempre retornava
`true`** — qualquer outra pergunta numa conversa em jornada `catalogo` era consumida sem
nenhuma resposta, e `uazapi-webhook.ts` usava esse retorno pra pular o Mega Sorgo por cima.
Aparecia no relatório como conversa sem resposta.
**Corrigido**: `catalog.ts` agora responde com um aviso de handoff pro humano quando o texto
não casa com nenhum handler (exceto ruído puro — dígito avulso, "ok", "sim"), e reconhece
"menu"/"catálogo"/"voltar" como pedido pra reabrir o menu.

### 8. Sem opt-out durável — **corrigido depois, via etiqueta (02/08)**
Nada no modelo registrava "não quero mais"/"já comprou": `FUNIL_CANCEL_ON_REPLY` fica
desligado por padrão, o detector de intenção só reconhece intenções positivas, e
`contacts.attributes.dead` só marca número inexistente pela Meta (erro da própria API), não
vontade do lead ou fechamento de venda.
**Corrigido**: em vez de detecção automática (risco de falso positivo — "queria grãos" não
é xingamento, é só fora do escopo do produto), o atendente marca por etiqueta no Chatwoot.
Loop dedicado (`bridge/server.ts` `startOutcomeLabelLoop`, 20s, `bridge/handlers/funil-control.ts`
ações `marcar-pago`/`marcar-nao-compra`):
- etiqueta **`pago`** → cancela a fila do funil pra aquela conversa e marca
  `conversations.outcome='won'`.
- etiqueta **`nao-compra`** → cancela a fila, marca `outcome='lost'` e bloqueia o CONTATO
  (`contacts.attributes.blocked`, `bridge/shared/lead-block.ts`) — durável entre conversas:
  `bridge/handlers/funil-enroll.ts` recusa qualquer novo enroll (auto, manual ou recuperação)
  pra um contato bloqueado.
Diferente do poll de comandos (`cmd-*`), essas etiquetas **não são removidas** depois de
rodar — ficam como status visível permanente. Fora do escopo desta correção: bloquear
contato bloqueado de campanhas em massa (disparo/n8n) — esse fluxo não passa pelo código
deste repositório.

### 9. `/relatorio` e `/metrics-rollup` sem nenhuma autenticação
Foi assim que esta auditoria coletou os dados: sem credencial nenhuma. A página serve
transcrição literal de conversa, nome de cliente e final de telefone; `/metrics-rollup`
aceitava `?day=` de qualquer origem e escrevia em `daily_metrics`.
**Corrigido**: `bridge/shared/report-auth.ts` (novo) — aceita token de cron
(`SYNC_SECRET`/`CHATWOOT_WEBHOOK_SECRET`, mesmo usado pelos loops internos) OU um JWT de
usuário Supabase, aplicado nos dois endpoints. O painel (`web/app/relatorio/page.jsx`) foi
adaptado: como um `<iframe src="...">` não manda header `Authorization`, o relatório agora é
buscado por `fetch` (com o token da sessão já aberta no browser) através de um proxy
same-origin novo (`web/app/api/relatorio/route.js`) e injetado no iframe via `srcDoc`. Nenhum
segredo novo precisou ser embutido no browser — o proxy só repassa o JWT que a sessão do
usuário já tinha, o mesmo padrão que `funnel-ops`/`operational-health` já usavam.

## 4. Fora de escopo desta mudança (registrado para decisão)

- **Bloqueio de campanha em massa** (disparo/n8n) pra contato marcado `nao-compra` — o
  bloqueio de defeito 8 cobre o funil deste repositório; disparo em massa é outro sistema.
- **DDL versionado ausente** para `sales_sequences`, `scheduled_messages`, `funnel_media` —
  essas tabelas existem em produção mas não têm `CREATE TABLE` em nenhuma migration deste
  repositório (foram criadas manualmente no Studio).
- **Cadência e CTA do funil** — os números acima (5,2:1 out:in, 50% sem interação, queda de
  pagamento na semana de maior volume) apontam pra um problema de conteúdo/cadência, não só
  de medição. Recomendação, não execução:
  - A proporção de 5-6 mensagens de saída para cada 1 de entrada sugere sequência longa
    demais ou pouco interativa — vale medir quantas mensagens da sequência já rodam antes do
    lead abandonar (isso fica possível agora com a correlação da seção 3.5).
  - Metade das conversas ativas nunca responde nada — testar uma abertura mais curta com
    pergunta direta nas primeiras 1-2 mensagens, em vez de apresentação longa.
  - A queda de pagamento (13 → 3) na semana de maior volume de entrada merece corte por
    canal/origem antes de qualquer mudança de conteúdo — pode ser qualidade de lead, não o
    funil.
