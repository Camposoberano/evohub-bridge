# Funções, rotas e comandos

**Recorte:** `main` em `08c6e5c`, 22/10/2026. Use este catálogo para localizar a responsabilidade antes de alterar uma função. O detalhe da autenticação, método HTTP e efeitos de cada rota está no handler correspondente; o nome da rota sozinho não autoriza sua execução.

## Entradas HTTP do bridge

O roteador é `bridge/server.ts`. As rotas abaixo são as 37 entradas registradas no objeto `routes` do commit auditado.

| Grupo | Rotas | Handler / função |
|---|---|---|
| Webhooks de conversa | `/hub-webhook`, `/chatwoot-webhook`, `/uazapi-webhook` | `handlers/hub-webhook.ts`, `chatwoot-webhook.ts`, `uazapi-webhook.ts` |
| Estado e incidentes | `/conversation-outcome`, `/channel-health`, `/inbound-incidents`, `/operational-health`, `/relatorio` | handlers de mesmo nome |
| Conexão e canais | `/connect-channel`, `/connect-uazapi`, `/uazapi`, `/channel-sync`, `/chatwoot-accounts` | handlers de mesmo nome |
| Envio, campanha e funil | `/send-outbound`, `/campaign`, `/funil-enroll`, `/funil-control`, `/funil-queue-pump`, `/funnel-ops` | handlers de mesmo nome |
| Ações n8n | `/n8n-action-enqueue`, `/n8n-action-send-now`, `/n8n-queue`, `/n8n-reconcile-5895` | handlers de mesmo nome; separar enfileirar, envio imediato e reconciliação |
| Rotas híbridas e Meta | `/hybrid-routes`, `/hybrid-ops`, `/meta-templates`, `/repair-official-5895` | handlers de mesmo nome |
| Clientes e sincronização | `/clientes`, `/sync-facebook`, `/sync-comments`, `/sync-chatwoot-out`, `/sync-labels`, `/sync-wa-labels`, `/label-window` | handlers de mesmo nome |
| Métricas, IA e retenção | `/metrics-rollup`, `/llm-orchestrate`, `/media-retention` | handlers de mesmo nome |

Além do objeto `routes`, o servidor oferece `/health` e `/version`. Verifique no código qualquer rota dinâmica ou especial antes de acrescentar outra ao catálogo.

## Módulos compartilhados por responsabilidade

| Responsabilidade | Arquivos de entrada |
|---|---|
| Identidade e entrada | `inbound.ts`, `customer.ts`, `accounts.ts`, `ddd.ts`, `intent.ts`, `intent-dedup.ts` |
| Envios e provedores | `hub.ts`, `uazapi.ts`, `chatwoot.ts`, `native.ts`, `audio.ts`, `media-relay.ts`, `document-delivery.ts`, `outbound-dedup.ts` |
| Campanha | `campaigns.ts`, `campaign-queue.ts`, `campaign-pace.ts`, `campaign-preflight.ts`, `lotes.ts` |
| Fluxo e funil | `flow.ts`, `flow-runner.ts`, `flow-state.ts`, `flow-inbound.ts`, `funnel-queue.ts`, `funnel-recovery.ts`, `funnel-state.ts`, `funil-pausa.ts` |
| Bloqueios e atendimento | `bot-mute.ts`, `gate-comercial.ts`, `stop-contact.ts`, `lead-block.ts`, `negative-intent.ts`, `pedido-humano.ts` |
| Recuperação e incidentes | `catchup-uazapi.ts`, `inbound-incidents.ts`, `operational-alert.ts`, `recovery-chain.ts`, `recovery-content.ts` |
| Social e IA | `social.ts`, `social-funnel.ts`, `social-sales.ts`, `social-autoreply.ts`, `llm-orchestrator.ts`, `openai-exec.ts` |
| Persistência e proteção | `supabase.ts`, `env.ts`, `hmac.ts`, `segredo-bridge.ts`, `redact.ts`, `loop-guard.ts` |

Uma função pode depender de mais de um grupo. O critério de propriedade é quem decide a regra: handlers recebem e respondem HTTP; módulos compartilhados fazem a decisão e integração; o painel apresenta e aciona.

## Ciclos iniciados no servidor

`bridge/server.ts` registra sincronização social e Chatwoot, etiquetas, rollup, retenção, enriquecimento, avatares, limpeza, comandos, mute, resultados, canais, fila de funil, watchdog de anúncios, fila de campanhas, guardião de recusa, recuperação de funil, timeouts, PDF diferido, catchup Uazapi, monitor operacional e watchdog de entrada. Procure por `function start...Loop` no arquivo antes de alterar frequência ou desligar um ciclo.

Os ciclos com `agendarLoop` usam nomes como `comments`, `label-window`, `rollup`, `retention`, `data-cleanup`, `channel-sync`, `decline-guard`, `funnel-recovery`, `uazapi-catchup`, `operational-monitor` e `inbound-watchdog`. Outros usam `setInterval`. Intervalo, habilitação por variável de ambiente e trava de reentrância são propriedades do código e da configuração do deploy; não assuma que todos estão ligados.

## Painel

As páginas em `web/app/` incluem `/acompanhamento`, `/reativacao`, `/analytics`, `/campanhas`, `/conversas`, `/disparos`, `/eventos`, `/fluxos`, `/funil`, `/clientes`, `/contatos`, `/conexoes`, `/hibridos`, `/instancias`, `/orquestracao`, `/relatorio` e outras páginas de operação. O painel não é a única fonte de verdade para entrega: mensagens, eventos e recibos vivem nos sistemas integrados.

## Comandos de desenvolvimento e verificação

Execute a partir da raiz do repositório. Estes comandos verificam arquivos locais; não enviam mensagens a clientes:

```powershell
git status --short
git diff --check
deno check bridge/server.ts
deno test bridge/tests
npm --prefix web run build
```

`deno test` pode exigir permissões específicas conforme o teste; leia o teste antes de conceder acesso à rede ou a segredos. `npm --prefix web run build` depende das variáveis locais exigidas pelo Next.js. O arquivo `bridge/deno.json` contém a task `dev`; `package.json` da raiz contém `db:apply` e `ai:bundle`; `web/package.json` contém `dev`, `build` e `start`.

### Leitura operacional

```powershell
gh pr list --state open
gh api repos/Camposoberano/evohub-bridge/branches/main --jq '.commit.sha'
```

Para o serviço, consulte `/health` e `/version` no domínio configurado do bridge. A verificação do banco e do provedor deve filtrar canal, período e identificador de mensagem, sem imprimir tokens ou telefones completos.

### Comandos que alteram estado

`npm run db:apply` aplica migrations. `git push`, gatilhos de deploy, `/send-outbound`, `/campaign`, `/funil-*`, `/n8n-action-send-now` e scripts `ops/` com nomes como `migrate`, `reconcile`, `recover`, `reanchor`, `schedule` ou `set` podem alterar banco, fila, configuração ou enviar mensagens. Antes de executá-los, confira no código: alvo, modo de simulação, idempotência, filtro de contato/campanha e confirmação de saída já entregue. Nenhum script `ops/` é declarado seguro apenas pelo nome.

## Sequência de diagnóstico de uma resposta que não chegou

1. Fixe instância/canal, contato parcial, horário local e ID do clique no provedor.
2. Consulte evento de webhook e a configuração do endpoint da instância.
3. Consulte mensagem recebida e posição do fluxo no banco.
4. Consulte o envio e o recibo no provedor e no Chatwoot.
5. Só então avalie catchup, reconciliação ou atendimento manual. Registre o resultado em uma linha do tempo com UTC e America/Fortaleza.
