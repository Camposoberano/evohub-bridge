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
- `GET /applications/{uuid}/restart` recria o container e já pega env nova —
  confirmar por `uptime_s` baixo em `/version`

## Convenções
- Toda mensagem registrada no Chatwoot DEVE capturar `chatwoot_message_id` do response e gravar na tabela `messages` (previne duplicação pelo pull-loop)
- Canal não-oficial (uazapi) = sem janela Meta
- Lógica de negócio SEMPRE no bridge (n8n é só cron de despacho)

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
