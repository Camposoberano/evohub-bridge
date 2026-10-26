# EVO Hub Bridge

## Stack
- **Bridge**: Deno HTTP server em `bridge/server.ts`, deploy via Coolify em `cofre.camposoberano.com.br`
- **DB**: Supabase self-host (`bancortovital.soberano.pro`)
- **Chatwoot**: `gerenciador.soberano.pro` (conta 1)
- **Gateway**: EVO Hub (proxy Meta — WhatsApp oficial, FB, IG)
- **WhatsApp não-oficial**: uazapi (disparo em massa e canais espelhados)

## Deploy
- Trabalha em `master`, deploya com `git push origin master:main` (Coolify observa `main`)
- Dois serviços Coolify: **SERVIDOR** (bridge Deno) e **PAINEL** (Next.js dashboard)
- Sempre dizer qual ao pedir redeploy

## Coolify API
- **URL**: `https://painelgeral.camposoberano.com.br/api/v1`
  (o host `coolify.institutobelem.com` que constava aqui devolve `Unauthenticated`
  para qualquer token — não é o Coolify deste projeto)
- **Token**: ler de `$COOLIFY_TOKEN` (`.env` local, nunca commitar). Uso: `Authorization: Bearer $COOLIFY_TOKEN`
- **SERVIDOR UUID**: `m8qf6ru2x75gukzozpsrssrm` (`evohub-bridge` → cofre.camposoberano.com.br)
- **PAINEL UUID**: `ue0tgzd5a30jrxyenzff7piv` (`evohub-dashboard` → painel.camposoberano.com.br)
- **Logs**: `GET /applications/{uuid}/logs?lines=200`
- Env **nova** é `POST /applications/{uuid}/envs`; `PATCH` só atualiza existente e
  responde `Environment variable not found.` se a chave ainda não existe
- `POST /applications/{uuid}/restart` recria o container e já pega env nova —
  confirmar por `uptime_s` baixo em `/version`

## Convenções
- Toda mensagem registrada no Chatwoot DEVE capturar `chatwoot_message_id` do response e gravar na tabela `messages` (previne duplicação pelo pull-loop)
- Canal não-oficial (uazapi) = sem janela Meta
- Lógica de negócio SEMPRE no bridge (n8n é só cron de despacho)

## Decisões travadas (correções que NÃO se repetem)

- **Telemetria/funil que só cobre o caminho Meta mente sobre o negócio (2026-10-25).**
  Os eventos comerciais `sales-funnel` (`intencao_identificada` etc.) eram gravados SÓ em
  `handlers/hub-webhook.ts` (Meta) e `handlers/sync-facebook.ts` (FB/IG). O caminho **uazapi**
  (`handlers/uazapi-webhook.ts`) — que é o tráfego dominante do funil 5895 (~4:1 out:in) — nunca
  chamava `recordInboundCommercialIntent`, então o relatório via o topo do funil quase zerado
  (22 eventos p/ 500+ conversas) e `won`/receita não mediam venda real. Corrigido chamando o
  `recordInboundCommercialIntent` já exportado nos cliques `menu_preco`/`menu_uso` e na intenção
  por texto/áudio (`classificarIntencaoComercial`). **Regra:** ao instrumentar/medir o funil,
  cobrir uazapi + Meta + FB/IG; nunca assumir que o caminho oficial representa o volume real.
- **Fingerprint por texto exato em `/relatorio` apodrece a cada campanha (2026-10-25).**
  A detecção "bot entregou preço" era `content.includes("imagem preco_"|"Tabela de preços")` e
  casava ZERO (preço real sai como card de mídia com step de funil `:preco` e como texto `R$`/
  "preço de *"). Corrigido com regex + o elo `messages.funnel` (migration 0012). **Regra:** métrica
  de etapa do funil deve preferir o dado estruturado (`messages.funnel`/`funnel_step`,
  eventos `sales-funnel`) ao match de string; se usar string, validar contra o banco antes de
  confiar no número. Um "0" numa métrica de funil ativo é suspeito — conferir no banco.
- **Deploy é do `main`, não `master` (ver memória [[deploy-main-divergencia]]).** Os 2 apps Coolify
  buildam do `main`; `master` divergiu. Deploy = cherry-pick pro `main` + `POST /deploy?uuid=<app>`
  (a seção Deploy acima ainda diz "master" — está desatualizada).
- **Preço NÃO tem número no automático — é por volume, o Cícero cota (2026-10-26).** O bot nunca manda
  R$; responde "escolha o pacote, o Cícero confirma o valor". NÃO reintroduzir tabela de preço no bot
  sem decisão explícita (histórico de número errado: "30%" que não existe). `shared/ancoragem-preco.ts`
  é código MORTO (não ligado em lugar nenhum) — não religar achando que é o fluxo de abertura.
  **Regra:** lead que insiste no preço (2º pedido/dia) = fast-track pro humano em `handleMenuClick`
  (pausa funil + `handleHumanRequest` cotação), NUNCA dead-air. Ver [[preco-sem-numero-fast-track]].

---

## Decisões travadas (correções que NÃO se repetem)

- **Campanha fria OFICIAL precisa de template como abridor.** O pump da `campaign_queue` abre a
  conversa com `runFlow` pela rota híbrida (uazapi-first) — NÃO manda template oficial. Fora da
  janela de 24h a Meta só aceita template. Por isso existe o `FlowStepKind` **`template`**
  (shared/flow.ts): 1º step do flow abre a janela pelo oficial e espera o clique. Não concluir
  "é só config" para frio oficial. (20/10/2026, [[template-abridor-oficial-flow]])
- **Handoff pro humano de dentro do flow usa `pedirHumano`.** A resposta da campanha passa por
  `continueFlowOnReply` (flow-inbound), não por `handleMenuClick` — então o pedido-humano do funil
  não dispara sozinho. Marcar `pedirHumano: true` no step; `flow-inbound.executarHandoff` faz
  `registrarPedidoHumano` + `assignConversation(CHATWOOT_ASSIGNEE_ID)`.
- **Custo Meta = por template entregue, não por conversa nem por step.** Flow com N respostas custa
  o mesmo que 1 padrão (1 template abridor pago; vídeo/qualificação/handoff saem free-form via
  uazapi/janela, grátis). Preço BR out/2026 ≈ US$0,0625 / R$0,3217 por marketing; muda com
  frequência — conferir no Gerenciador do WhatsApp, nunca decorar. (calculadora: artifact de custo)
- **Imagem de template/anúncio oficial: sem "140 t/ha", sem preço.** O acervo é quase todo IA e
  muitas artes trazem esse claim/preço — risco de reprovação na Meta e claim sem laudo. Usar só as
  limpas (D:\sementes\SORGO\Imagens\selecao-header). `video_3` é reportagem SBT SD, ruim pra still.
- **Deploy do SERVIDOR:** código entra via PR → merge no `master` → `git push origin master:main`
  (Coolify observa `main`) → o push NÃO dispara deploy sozinho, precisa `POST /deploy` (ou restart)
  no Coolify. Em worktree, sincronizar o master antes do PR.
- **Coolify API é POST p/ deploy e restart** (24/10/2026): `GET /deploy` e `GET /restart`
  respondem `405 · This endpoint has changed to a POST request`. Usar `POST /deploy?uuid={uuid}&force=false`
  (devolve `deployment_uuid`; acompanhar em `GET /deployments/{uuid}` até `status=finished`) e
  `POST /applications/{uuid}/restart`. Env nova = `POST /applications/{uuid}/envs` com corpo
  **só `{key, value}`** (`is_build_time` → `422 not allowed`). Ver [[coolify-dois-servicos]].
- **Migration/psql roda NO VPS, não daqui** (24/10/2026): a porta do Postgres do Supabase
  self-host (`bancortovital.soberano.pro`) não abre pra fora (connect timeout). Rodar pelo
  **terminal do Coolify** no container `supabase-db-<uuid>` (service `supabase-ORTOVITAL-migrado`),
  nunca pelo SQL editor do Studio (envelopa em transação; CONCURRENTLY falha). **DDL exige o role
  `supabase_admin`** (dono das tabelas): `psql -U postgres` dá `ERROR: must be owner of table`.
  Usar `psql -U supabase_admin -d postgres -c "..."`.
- **Entrada uazapi casa pelo `owner`, não pelo nome da instância** (24/10/2026): `owner` (chat/data)
  é o NOSSO número e bate com `channels.phone`; os campos phone/wa_chatid do chat são do CLIENTE.
  Instância "0595 cecape" ≠ canal "0595" → o match caía no número do cliente e a entrada do 0595
  era DESCARTADA como `canal_nao_cadastrado` (29 eventos 23/10). `findChannelForInstance` agora
  tenta `owner` primeiro. Corrigido em `ca85ea2`.
- **`canal_nao_cadastrado` é falso positivo sem allowlist** (24/10/2026): a uazapi é multi-tenant
  (vê instância de outro cliente: INSTITUTO BELEM etc.). `inbound_sem_canal` só alerta instância
  listada em **`EVO_UAZAPI_INSTANCES`** (setada: `5895,6836,0595 cecape,11910,mato grosso`).
  NUNCA cadastrar canal pros números de fora. Ver [[canal-nao-cadastrado-falso-positivo]].
- **macro-poll tem trava anti-loop** (24/10/2026): resposta não-terminal (ex.: n8n respondendo
  HTTP 200 fora do contrato) mantinha a `cmd-*` e retentava a cada 15s pra sempre (conv 3509, paga).
  Agora pula+limpa `cmd-*` em conversa `won`/`lost` e para após `MACRO_MAX_ATTEMPTS` (evento
  `macro_command_stuck`, não alerta).
- **n8n `soberano-5895-*` devolve 200 VAZIO — DIAGNOSTICADO** (24/10/2026): teste ao vivo
  `POST https://automacao.soberano.pro/webhook/soberano-5895-plantio` (base/secret em
  `SOBERANO_N8N_BASE_URL`/`SOBERANO_N8N_WEBHOOK_SECRET` no Coolify) → HTTP 200, corpo vazio. O
  bridge (`dispatchSoberanoAction`) exige `{ok:true,accepted:N}` → vira falha → comando trava.
  **RESOLVIDO no bridge (`f2ed2af`):** `dispatchSoberanoAction` agora aceita **2xx sem sinal de
  falha como despachado** (`accepted:0`) — webhook é fire-and-forget com dedupe por `request_id` e a
  entrega é confirmada à parte (reconcile-5895/recibo uazapi). Falha explícita (`ok:false`/`error`/
  `terminal`) e não-2xx seguem falha. Fix no workflow n8n virou **OPCIONAL** (só traria a contagem
  `accepted:N` de volta: Webhook → Respond "Using Respond to Webhook Node" + nó Respond em cada caminho).
- **`5895_media_blocked` / `video_receipt_overdue` NÃO são do n8n** (24/10/2026): são da **uazapi**
  (`shared/async-video-receipt.ts` — "Receipt check for async Uazapi video sends"; confirmação =
  status `Delivered/Read/Played` buscado na uazapi; vídeo grande do funil 5895). Arrumar o n8n NÃO
  limpa esses. Não confundir as duas frentes.
- **`events` limpa EM LOTES** (24/10/2026): o DELETE único de ~1,1M linhas estourava o
  `statement_timeout` (57014), `events` não drenava e o operational-monitor também estourava.
  `startDataCleanupLoop` agora apaga em lotes de 300. Migration `0018` adiciona índice
  `(event_type, received_at)` pras consultas do monitor sem `source`.
- **`inbound_unprocessed` alerta só após janela (anti-ping)** (25/10/2026): o audit detecta
  incidente em 90s, mas o `runInboundWatchdog` alertava no WhatsApp QUALQUER coisa >90s → ~11
  pings/noite por atraso transitório (Chatwoot 502/503, catch-up a cada 15min) que resolvia sozinho
  (em 24-25/10, 51/51 entradas do 5895 processaram, 0 `inbound_processing_failed`). Agora só ALERTA
  incidente mais velho que **`INBOUND_ALERT_MIN_AGE_MS`** (default 8min); detecção (90s) e replay
  (2min) inalterados. `4000d77`.
- **`reconcile-5895` NÃO avança com recibo presente — ABERTO** (24/10/2026, não corrigido): 30 peças
  de vídeo presas em `transport_stage`=`await_receipt`/`await_response` desde Out 11-18; 29 com
  `provider_status`=`Delivered`/`Read` (ENTREGUE) mas `followups_released_at`=null → `reconcile-5895.ts`
  só trata `receipt_missing`, não o caso recibo-já-presente. Trava follow-ups em ~20 conversas +
  alertas `5895_media_blocked`/`video_receipt_overdue`. #971 é falha real de envio (sem provider_id).

---

## Protocolo Handoff

### Quando escrever handoff
O agente DEVE atualizar `handoff.md` (no diretório de memória do projeto) nos seguintes momentos:
1. Usuário diz "handoff", "salva estado", "guarda contexto", "encerra sessão"
2. Antes de qualquer operação que pode estourar contexto (muitas edições seguidas)
3. Ao final de uma tarefa grande concluída (pra próxima sessão saber o estado limpo)

### O que incluir no handoff
```
# Handoff — {data ISO}

## Estado atual
- Build deployado: {nome do build}
- Último deploy: {quando}
- Branch: {branch atual}

## Tarefa em andamento
{o que estava sendo feito — 2-3 frases}

## Concluído nesta sessão
- item 1
- item 2

## Pendente / próximo passo
- [ ] item com contexto suficiente pra retomar sem perguntar
- [ ] item 2

## Decisões tomadas
- decisão 1 — motivo
- decisão 2 — motivo

## Bloqueios / avisos
- qualquer coisa que a próxima sessão precisa saber (ex: env não trocada, migration não rodada)
```

### Quando ler handoff
Quando usuário diz "continue", "continua", "retoma", "onde parou", "sequência", "handoff":
1. Lê `handoff.md` do diretório de memória
2. Mostra resumo compacto: estado + pendências
3. Pergunta o que atacar primeiro
