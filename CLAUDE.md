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

- **Macros do Chatwoot no 5895/6836 operam sobre o 7d, NÃO o funil antigo (2026-11-19, commit `b3816fb`).**
  Depois de desligar o antigo, as macros (Iniciar Funil, Enviar Preço, etc.) davam **404**: `funil-control`
  usava `funnelId = mainFunnelForChannel` (= antigo) e despachava pro webhook n8n morto. Fix: quando
  `sevenDayLiveMode() && isSevenDayWhatsAppChannel(controlChannel)` → `funnelId = MEGA_SORGO_7D_VERSION`
  (pula o dispatch antigo; "Iniciar Funil" cai no `enrollIfNew`→7d; preço/vídeo/etc → `handleMenuClick`;
  não auto-pausa o 7d). **"Iniciar Funil" é a macro pra pôr no 7d, à mão, um lead ANTIGO que voltou a
  falar** (o 7d não re-matricula sozinho quem já existia). Provado na 485: `created`, 41 peças 7d. Macros
  "Recuperar 1-4"/"Voltar ao Mega Sorgo" seguem antigas (decidir desativar/repontar). Ver [[macros-apontam-7d]].
- **Oferta BLACK FRIDAY só pra lead que veio da BF (2026-11-19, commit `27e8671`).** Em `handleMenuClick`,
  no topo do `if (intent)`: se `menu_preco` + `isBlackFridayLead` (a conversa recebeu de nós uma msg
  outgoing com "Black Friday") → manda `BF_IMAGE_URL` (imagem no bucket `soberano-out`) + `BF_PRECO_TEXTO`
  (20kg, de R$1.798 por R$1.258,60, 30% OFF, frete grátis, só esta semana) + etiqueta
  **`black-friday-interesse`** (via `setConversationLabels`, append) + evento `black_friday_preco_enviado`;
  retorna (não cai na tabela normal). Vale esteja ou não em 7d; respiro só se em 7d. Quem NÃO é BF segue
  normal. Arte: tipográfica (sem foto falsa de lavoura, sem preço na arte — preço só no texto). Manutenção:
  preço/validade = `BF_PRECO_TEXTO`; trocar arte = subir no bucket + atualizar `BF_IMAGE_URL`; fim da promo
  = remover o branch. Ver [[black-friday-oferta]].
- **Funil ANTIGO (`mega-sorgo-5895-20260930` + `mega-sorgo`) DESLIGADO em 2026-11-19 — o 7d é o ÚNICO;
  NÃO religar sem decisão do dono.** O antigo rodava em PARALELO com o 7d e duplicava peça no MESMO
  lead (clique de menu → burst antigo `:preco/:plantio/:video` por cima da cadência 7d; 9 convs em
  17/11, 10 em 18/11, ex. 3453/5117). Matrícula no antigo já tinha parado no go-live (16/11), mas os
  disparos seguiam vivos. **O corte (feito ao vivo 19/11, autorizado pelo dono):**
  1. **Banco:** cancelei **277 peças pendentes** (`scheduled_messages` status→cancelled, funnel
     `like.mega-sorgo-5895*` + `eq.mega-sorgo`) + **85 sequências running** (`sales_sequences`
     status→cancelled). Sanity antes: 0 conversa do antigo estava também em 7d running (corte não
     tocou o 7d). 7d intacto (738 pending / 39 running depois).
  2. **n8n:** desativei 11 workflows antigos — `Soberano 5895 — Preço/Vídeo/Plantio/Nutrição`,
     `Funil completo 30-09` (= o `-20260930`), `Recuperação 1/2/3/4`, `Voltar ao Mega Sorgo`,
     `Retomar funil`. **MANTIDOS (infra/7d, NÃO desligar):** `Funil Mega Sorgo - Fila (cron 1min)`
     (`pQFCtRhzQTKqXTjS`, dispacha o 7d), `Conferir envios incertos` (reconcile), `Abrir catálogo`,
     `Pausar/Parar funil` (controle, só param).
  3. **Código:** guarda em `handleMenuClick` (`hub-webhook.ts`, commit `3860340`): se a conversa está
     em `mega-sorgo-7d-v1` running, NÃO dispara o burst antigo — roteia o clique pro humano
     (`cotacao` p/ preço, `atendimento` p/ os demais), evento `funil_7d_intent_para_humano`. Deployado
     (dispatcher 7d pausado durante o restart, >20h BRT).
  **Regra:** nada do funil antigo volta a disparar sozinho. Se um dos 85 leads cortados responder, a
  decisão do dono é ativar OUTRO funil pra ele à mão (não religar o antigo em massa). Os 85 NÃO migram
  pro 7d sozinhos. Ver [[funil-antigo-desligado]].
- **Destravar peça do MEIO da cadeia 7d (n8n-queue `due()`): o `send_at` dela tem que ficar ANTES
  das pendentes seguintes, senão o dedup por conversa starva (2026-11-17, destrava da 5125).** O
  despacho do 7d é o `due()`+`send()` em `handlers/n8n-queue.ts` (o cron n8n `pQFCtRhzQTKqXTjS`
  puxa), NÃO o `pumpFunnelQueue` (ver [[pump-head-of-line-defer]], que é outro dispatcher). `due()`
  devolve **1 peça por conversa por ciclo**, a de `send_at` mais cedo. Ao reenviar uma peça do meio
  (ex.: áudio que falhou em 401 transitório) flipando `failed→pending`, se o `send_at` dela ficar
  DEPOIS das peças seguintes (que já estão pending mais cedo), `due()` pega a seguinte — que está
  bloqueada atrás da falhada — e a cadeia inteira trava (deadlock). Fix na 5125: reposicionei o
  `send_at` da peça falhada pra ANTES da próxima pendente → ela saiu, cascata destravou. **Regra:**
  destravar no meio da cadeia = reenfileirar com `send_at` ≤ ao da próxima peça pendente daquela
  conversa, nunca `now` cru se `now` for maior que as seguintes. (401/UNAUTHORIZED isolado em 1 áudio
  entre dezenas é transitório — basta o retry; não é bug de código.)
- **Disparo do 7d (dia 1) sai QUALQUER hora; a trava 08h–20h vale só pra cadência (dia 2+)
  (2026-11-17, commits `f2ed382`+`4df7e75`).** A abertura é resposta ao lead que acabou de
  escrever (janela de 24h aberta), então fura a janela. Mas tinha **3 travas de horário
  empilhadas** — pra o disparo noturno funcionar, TODAS precisaram mudar:
  1. **Nó n8n** `Janela de envio 06h–21h Fortaleza` no workflow `pQFCtRhzQTKqXTjS` dropava tudo
     fora de 06:00–20:55 → virou pass-through (`return $input.all()`); o BRIDGE é a autoridade de
     horário agora (condiz com "lógica SEMPRE no bridge").
  2. **`n8n-queue`** (`due()` + `send()`): `due()` fora da janela agora surfa as peças de `day=1`
     pendentes/vencidas; `send()` deixa a abertura (`sevenDayOpening = day===1`) furar
     `horario-comercial` e a janela 08-20 (`fora-janela-7d` só pega dia 2+).
  3. **`send-outbound`** "última barreira" (defere `scheduled_message` fora de 07-20h): a abertura
     7d (`funnel_day===1`) agora fura, junto com o ensaio noturno.
  No agendador, `scheduleSevenDayPieces` dia-1 = `enteredAt + 5min*i` sem janela; dia 2+ ancorado
  09h local com guarda. `scheduleSevenDayRemainingPieces` (resume) segue windowed (é cadência, não
  disparo). **Regra:** ao mexer em horário de envio do funil, lembrar que há 3 camadas (n8n node,
  n8n-queue, send-outbound) — mudar 1 só não resolve. Provado: 5119 entrou 20:49 BRT e recebeu
  12/12 peças da abertura à noite. Ver [[funil-7d-disparo-qualquer-hora]].
- **`/ai-gate` INVERTIDO: libera por padrão, nega só `bot-off` e `7d running` (2026-11-17,
  commit `a64b533`).** O gate exigia a label `ai-vendas` pra liberar — mas só **2 de 1000**
  conversas abertas tinham a lane, então ligar o gate como estava calaria o agente em ~todas.
  Por isso o `contactAuth` vivia DESLIGADO e o agente respondia tudo, inclusive leads do 7d
  (colidindo com o funil + quebrando no 429). Nova política: LIBERA por padrão; nega só (a)
  `bot-off` e (b) conversa com sequência `mega-sorgo-7d-v1` em `running` (o funil é dono — reason
  `em_funil_7d`). `contactAuth.enabled` do agente 2 (fazer.ai agro) foi LIGADO (consulta o gate
  por mensagem). Provado ao vivo: 5119 (7d)→`authorized:false em_funil_7d`; 2216 (normal)→
  `authorized:true`. **Regra:** a lane `ai-vendas` deixou de ser pré-requisito; o agente volta
  sozinho ao lead quando a sequência 7d sai de running. Ver [[ai-gate-invertido]].
- **Agente agro quebra em HTTP 429 da OpenAI — STT (whisper) + chat; conserto é crédito/tier,
  não código (2026-11-16/17).** Sob volume do 7d, o "Vendedor Agro" (agente 2, fazer.ai agro)
  estoura 429 em todo áudio (whisper-1) e em parte do chat (5 runs → unanswered) → joga o lead
  pra equipe. Config do agente está SAUDÁVEL; o gargalo é a conta OpenAI (credencial `vault:4`):
  **adicionar crédito / subir o rate tier em platform.openai.com → billing.** Não dá pra consertar
  do bridge. Mitigação de código possível (não feita): setar `modelFallback`. Ver [[openai-429-agro]].
- **Funil 7d GO-LIVE = feature de modo-ao-vivo, NUNCA "só config" (2026-11-16, commit `066915b`).**
  Por 3 dias tentou-se "botar o 7d pra rodar" mexendo em config e nunca rodava: o único gate que
  existia era a allowlist de TESTE (`MEGA_SORGO_7D_TEST_CONVERSATIONS`, fail-closed) + enroll que
  roteava 5895/6836 pro funil ANTIGO (`mega-sorgo-5895-20260930`). Pôr no ar exigiu CÓDIGO:
  (a) flag `MEGA_SORGO_7D_LIVE=true` + `sevenDayLiveMode()`/`sevenDayConversationAllowed()`/
  `isSevenDayWhatsAppChannel()` em `shared/mega-sorgo-7d-gate.ts`; (b) um ramo no TOPO de
  `enrollIfNew` (`handlers/funil-enroll.ts`) que, em modo ao vivo + canal 5895/6836, faz o enqueue
  7d (`source="ad"`) em vez do funil antigo; (c) `n8n-action-enqueue` aceitar `source="ad"` só quando
  live. **Regra:** enroll é o ÚNICO ponto de convergência (autoEnroll/hub-webhook/funil-control/
  recoverEligible passam por `enrollIfNew`) — roteia o 7d LÁ, nunca em `mainFunnelForChannel`
  (deixar intocado faz lead que já está no funil antigo TERMINAR nele, sem corte no meio). Provado
  ao vivo 16/11: 6 leads orgânicos entraram sozinhos (5×5895 + 1×6836), 12 peças entregues cada nos
  4 primeiros, 0 colateral. Ver [[funil-7d-golive-modo-ao-vivo]].
- **Deploy do SERVIDOR DENTRO de 8-20h, se risco aceito: pausar o dispatcher n8n durante o
  restart/deploy (2026-11-16).** O auto-pause da campanha dispara quando um envio fica incerto, e
  restart no meio de envio é a causa clássica. Mitigação comprovada: `POST /deactivate` no workflow
  n8n "Funil Mega Sorgo - Fila (cron 1min)" (`pQFCtRhzQTKqXTjS`) ANTES do `/deploy`|`/restart`,
  reativar (`/activate`) só quando o container novo subir (`uptime_s` baixo no `/version`). Zero
  peça em voo → zero `send_uncertain` → zero `campaign_auto_paused`. Verificado nos 2 deploys do dia.
  **Regra:** a trava das 8-20h continua valendo; só fure com OK explícito do dono E com o dispatcher
  pausado na janela do restart.
- **Eco de deleção/edição/reação do aparelho NÃO se reenvia — vira loop (2026-10-30).**
  Deletar/editar/reagir a uma msg no WhatsApp → a uazapi espelha no Chatwoot como texto de SAÍDA
  ("🗑️ [ Mensagem deletada ]", "👍🏻 [ reação ]") SEM `source_id`, escapando do `isProviderEchoOutgoing`.
  O `handleOutgoing` (webhook) e o `sync-chatwoot-out` reenviavam ao cliente; cada volta vira msg nova
  no Chatwoot (id novo) → o claim `cw-out-<id>` nunca deduplica → loop (103x "Mensagem deletada" em
  29/10, 383 extras). Fix: `isUazapiSystemNotice` (em `shared/chatwoot-provider-echo.ts`) chamado nos
  dois caminhos. **Regra:** aviso de ação do aparelho nunca se reenvia. E atenção: `handleOutgoing` é
  webhook (tempo-real), `AUTO_LOOPS_ENABLED=false` NÃO para — só o guard no código resolve.
- **Filtro de labels no Chatwoot: 1 condição IN, nunca N equal_to com OR (2026-10-30).**
  `macro-poll`/`bot-mute`/`outcome` mandavam 16 condições `equal_to` OR'd no `conversations/filter` →
  ~15s e timeout/500 em 100% na VPS sem CPU (controle do bot por etiqueta morreu). Trocar por UMA
  condição `equal_to` com todos os valores (o Chatwoot traduz pra `tags.name IN (...)`): mesma
  semântica, ~2x mais barato. **Regra:** filtrar por "tem qualquer destes labels" = 1 condição com o
  array completo.
- **events precisa de `idx_events_received_at`; DDL = `supabase_admin` (2026-10-30).**
  Sem o índice, a limpeza (`DELETE ... received_at < cutoff`) faz seq-scan, estoura `statement_timeout`
  (57014) e a tabela cresce sem fim (mediu 1,26M, 866k >30d). Criar `create index concurrently ... on
  events (received_at)` como **`supabase_admin`** (o role `postgres` do Supabase self-host NÃO é dono
  nem superuser) no terminal web do Coolify. Drenar passivo em lotes de 20k (ctid), nunca DELETE único.
  Ver `supabase/manual/0014`.
- **A VPS é UMA caixa de 2 vCPU rodando tudo (2026-10-30).** Supabase+Chatwoot+bridge+agents+Langfuse+
  Grafana no mesmo 136.248.116.231. CPU é gargalo estrutural → ops pesadas daqui (drain/scan) a ≤3
  workers + pausa (16 workers derrubaram a VPS). Fix real = subir cores. Langfuse foi desligado p/ aliviar.
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
- **REVERTIDO 2026-11-19 → preço AGORA é automático (tabela de pacotes) pra lead em 7d. A regra
  abaixo "bot não manda R$" vale só FORA do 7d.** Decisão do dono: no funil 7d, pedido de preço (botão
  ou texto) responde com tabela fixa de pacotes COM valor (`TABELA_PRECO_7D` em `hub-webhook.ts`):
  2kg/½ha R$179,90 · 4kg/1ha R$341,62 · 10kg/2ha R$764,15 · 20kg/4ha R$1.437,90, frete grátis; **acima
  de 4 ha → Cícero cota**. Valores confirmados pelo dono (base R$89,90/kg, desconto por volume), tabela
  FIXA (sem validade; ele avisa quando mudar). Ao mexer no preço do 7d, mexer em `TABELA_PRECO_7D`, não
  reintroduzir número de outro jeito. Ver [[preco-auto-tabela-7d]], [[pergunta-nao-atropela-7d]].
- **Preço NÃO tem número no automático — é por volume, o Cícero cota (2026-10-26; vale FORA do 7d).**
  O bot nunca manda R$; responde "escolha o pacote, o Cícero confirma o valor". NÃO reintroduzir tabela
  de preço no bot sem decisão explícita (histórico de número errado: "30%" que não existe).
  `shared/ancoragem-preco.ts` é código MORTO (não ligado em lugar nenhum) — não religar achando que é o
  fluxo de abertura. **Regra:** lead que insiste no preço (2º pedido/dia) = fast-track pro humano em
  `handleMenuClick` (pausa funil + `handleHumanRequest` cotação), NUNCA dead-air. Ver
  [[preco-sem-numero-fast-track]]. (No 7d, a regra de cima tem precedência: preço automático.)
- **Pergunta de lead em 7d NÃO atropela nem mata o funil (2026-11-19).** O 7d é trilha de EDUCAÇÃO —
  nunca para quando o lead pergunta. Guarda em `handleMenuClick` (`hub-webhook.ts`): se a conversa está
  em `mega-sorgo-7d-v1` running, a pergunta é RESPONDIDA na hora e a próxima peça ganha um "respiro"
  (`darRespiro7d`, empurra +3h o próximo `scheduled_messages` pendente) pra não colar — NÃO pausa, NÃO
  cancela, NÃO faz handoff que mate a cadência. Preço → `TABELA_PRECO_7D`. Info (nutrição/plantio/vídeo)
  → `handleNutricao/Plantio/VideoSequence` (conteúdo nativo do bridge, roda mesmo com agente off) + nota
  privada avisando o Cícero. Evento `funil_7d_pergunta_respondida`. Pega botão E texto (ambos passam por
  `handleMenuClick`). **Regra:** nunca parar o funil numa pergunta; responder + respiro + seguir. Ver
  [[pergunta-nao-atropela-7d]].
- **Pump do funil não pode SEGURAR peça sem mover o `send_at` (head-of-line, 2026-10-26).**
  `pumpFunnelQueue` seleciona `pending AND send_at<=now ORDER send_at ASC LIMIT N`. Se um ramo de hold
  (bot travado, `not_due`, `deferred_business_window`, `deferred_intent`) deixa a peça `pending` com o
  `send_at` antigo, o ciclo seguinte re-pega as MESMAS N na cabeça e a fila inteira para (aconteceu:
  travou em 6 conversas velhas não-mutadas). **Regra:** todo ramo que não envia/cancela/pausa DEVE
  empurrar o `send_at` pra frente (deferir) pra peça sair da cabeça da fila. E log de hold diz o motivo
  real — NUNCA rotular tudo como "bot travado". Ver [[pump-head-of-line-defer]].
- **Campanha auto-pausa a INSTÂNCIA INTEIRA a cada envio incerto (2026-10-26).** `marcarResultadoIncerto`
  → RPC `pause_campaign_after_uncertain_send` pausa TODA a campanha da instância (centenas/milhares de
  contatos) quando 1 envio fica "incerto" (provedor não confirma / erro de rede no oficial EVO Hub /
  **worker interrompido por restart do container**) e NÃO retoma sozinha (precisa `reabrirCampanha`:
  paused→pending). Travou `reativacao-6836-uz` (24/10) e `reativacao-5895-of`. **Regra operacional:
  NÃO deployar/reiniciar o SERVIDOR entre 8–20h BRT (horário de disparo)** — restart no meio do envio
  vira incerto e re-pausa. Retomar = flip paused→pending no `campaign_queue` das campanhas afetadas.
  Follow-up de código: pausar só o item, não a campanha. Ver [[campanha-auto-pause-incerto]].

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
- **Mídia 5895 incerta inconfirmável trava os alertas — age-out de 72h (02/11/2026, `dfc7b93`).**
  Peça `scheduled_messages` `failed + __funnel_delivery.last_outcome=uncertain` sem `followups_released_at`
  nunca saía desse estado quando o recibo envelhecia do `/message/find` (vídeo) ou o tipo não é
  reconciliável (áudio/text) → `5895_media_blocked`/`5895_video_receipt_overdue` alertavam para sempre
  (3 peças de 11-16/out: #3728, #971 vídeo; #3677 áudio — todas `provider_status=None`, NÃO era o caso
  "recibo-já-presente" que se temia). Fix: `expireStale5895Uncertain` marca `last_outcome:"expired"`
  (NÃO "sent" — não afirma entrega) em peça com `last_attempt_at > 72h`, todos os tipos, no cron do
  reconcile. As 3 presas foram expiradas à parte no banco. **Regra:** `uncertain` ≠ não-entregue; e
  monitor de "incidente pendente" sobre estado que o automático pode nunca resolver precisa de age-out.
  Ver [[reconcile-5895-age-out]]. (Melhoria futura não feita: reconcile confirmar p/ `sent` quando o
  recibo Delivered/Read já está no meta — não apareceu ao vivo.)
- **O monitor de alertas roda FORA do kill-switch `AUTO_LOOPS_ENABLED` (02/11/2026, `76bc190`).**
  O bootstrap do `server.ts` gateava todos os loops; com `AUTO_LOOPS_ENABLED=false` morria junto o
  `operational-monitor`, que é quem ALERTA (canal caído, fila presa, inbound perdido) — pausar a
  operação cegava o sistema. Agora `startOperationalMonitorLoop()` roda sempre, antes do gate.
  `startInboundWatchdogLoop()` continua DENTRO (reprocessa entrada = efeito colateral que a pausa
  quer parar). **Regra:** loop observe-only+alerta fora de qualquer kill-switch de operação; loop
  que envia/reprocessa fica gated. Ver [[monitor-fora-do-kill-switch]].
- **`channel-sync` sincroniza `page_id`/`ig_id` na DIFERENÇA, não só quando vazio (02/11/2026,
  `dcc50f1`).** O sync social só gravava o id de roteamento quando estava vazio (`!ch.page_id`) →
  um canal com page_id ERRADO (reconexão a outra página, ou seed errado) nunca se corrigia. O
  "Mega Sorgo Santa Elisa" ficou com `page_id=101431812463255` no DB enquanto o token/hub
  apontavam `112114627195174`, e a entrada do FB caía em silêncio. Agora casa o id do Hub sempre
  que difere (o `if (idSocial)` barra o null transitório). **Diagnóstico de canal social:** testar
  o `channel_token` pelo proxy EVO Hub `GET {HUB}/meta/me?fields=id,name` (NÃO no graph direto, que
  mente). Dado de prod já corrigido. Ver [[channel-sync-page-id-stale]].
- **Erro do PostgREST é objeto, não `Error` — usar `describeError`, nunca `String(e)` (02/11/2026,
  `a561dfa`).** `String(e)`/`${e}`/`e instanceof Error ? e.message : String(e)` renderizam um
  PostgrestError como "[object Object]" e escondem a causa (ex.: `57014`/timeout da limpeza de
  `events`). `bridge/shared/error-detail.ts` → `describeError(e)` extrai `message/code/details/hint`.
  Aplicado no `data-cleanup`; ~40 call sites com o padrão antigo ainda latentes (migrar ao tocar).
  Ver [[erro-objeto-esconde-causa]].
- **Bot agro (fazer.ai) GO-LIVE 2026-10-29 em install PRÓPRIO no soberano.pro** (`agents.soberano.pro`,
  tenant 2 `campo-soberano-agro`, agente "Vendedor Agro" na inbox 46). NUNCA criar material do agro no
  tenant 1 (= Instituto Belém). Lane via `AI_LANE_ENABLED=1` + contactAuth `/ai-gate`. Detalhe +
  anti-repetir-erro em [[fazer-ai-selfhost-soberano]] e [[decisoes-deploy-soberano]].
- **VPS Oracle (136.248.116.231): proxy é NGINX NO HOST, não o Traefik do Coolify.** Expor serviço =
  vhost nginx + certbot apontando pro IP do container (não basta `service_applications.fqdn`). IP muda
  ao recriar ([[nginx-ip-container-quebra]]).
- **`minio/minio` saiu do Docker Hub** → usar `ghcr.io/coollabsio/minio:RELEASE.2025-10-15T17-29-55Z`.
  **API Coolify `/deploy` e `/restart` são POST** (não GET). **MCP fazer.ai no app desktop não faz OAuth**
  (`/mcp` não é comando) → API key no header (`claude mcp add --header`); key = token de tenant (sem arg `tenant`).
- **NÃO reiniciar/deployar o bridge 8-20h BRT com disparo ativo** — restart no meio relê histórico e
  repete envio (incidente 2026-10-29 "disparando/repetindo"; NÃO era o agente novo, era o bridge).
  Ver [[campanha-auto-pause-incerto]].

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
