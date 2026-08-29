# Reducao de logs do Supabase pelo sincronizador de saida

**Data:** 29/08/2026  
**Status:** aprovado para planejamento; pendente de revisao antes da implementacao

## Problema confirmado

O banco `_supabase` contem 67 GB. A tabela de Logflare
`_analytics.log_events_659846f3_a653_4112_a257_8f6b544266fd` ocupa 66 GB, com
aproximadamente 57 milhoes de eventos. Ela registra chamadas REST internas, nao dados
comerciais, conversas ou midias.

Uma amostra mostrou que os maiores recursos sao `messages`, `contacts`,
`conversations` e `channel_secrets`. Os eventos sao pequenos (media de 742 bytes),
mas muito frequentes. O maior candidato de codigo e `sync-chatwoot-out`:

- roda a cada 5 segundos;
- usa uma janela de 30 minutos;
- existem 5 canais WhatsApp ativos;
- pode varrer 40 conversas por canal em cada rodada;
- para cada mensagem de saida encontrada, consulta novamente a tabela `messages`.

Assim, uma mesma saida recente pode ser reconsiderada centenas de vezes. Chamadas de
deduplicacao que recebem conflito tambem aparecem como `4xx` no Logflare, aumentando o
volume tecnico sem representar falha para o cliente.

## Objetivo

Reduzir drasticamente as leituras REST repetidas sem perder mensagens de atendentes,
sem atrasar o caminho normal via webhook e sem alterar a regra de envio, funis ou
canais.

## Decisao de arquitetura

O webhook do Chatwoot continua sendo o caminho primario e imediato. O polling passa a
ser apenas a rede de seguranca para indisponibilidade temporaria de webhook/Sidekiq.

### Polling em dois modos

1. **Recuperacao de partida ou erro:** consulta a janela atual de 30 minutos uma unica
   vez. Isso preserva a cobertura que ja existe hoje depois de um reinicio.
2. **Operacao normal:** consulta a cada 30 segundos com sobreposicao de 2 minutos.
   A sobreposicao tolera atraso de relogio e entrega, mas impede reprocessar meia hora de
   historico a cada 5 segundos.

Os valores devem ser configuraveis por variavel de ambiente, com defaults seguros:

- `SYNC_OUT_POLL_INTERVAL_MS=30000`
- `SYNC_OUT_STEADY_SINCE_MINUTES=2`
- `SYNC_OUT_STARTUP_SINCE_MINUTES=30`

O kill-switch existente `SYNC_OUT_ENABLED=false` permanece inalterado.

### Deduplicacao em lote e cursor

Para cada conversa lida pelo fallback:

1. Coletar as mensagens candidatas recentes do Chatwoot.
2. Consultar os `chatwoot_message_id` ja conhecidos em uma operacao em lote, em vez de
   executar uma consulta por mensagem.
3. Encaminhar somente os IDs ainda ausentes ou explicitamente falhos para
   `handleOutgoing`.
4. Salvar uma marca tecnica de ultima rodada bem-sucedida no bucket de configuracao ja
   existente. Nao criar tabela nova no Supabase.

Em caso de falha, o cursor nao avanca. A proxima rodada usa a janela de recuperacao; a
idempotencia por `chatwoot_message_id` e `deliveries` continua sendo a barreira contra
duplicacao.

## Mudancas proibidas neste escopo

- nao desativar o webhook do Chatwoot;
- nao reduzir a cobertura de recuperacao apos reinicio;
- nao apagar mensagens, conversas, campanhas, filas ou contatos;
- nao alterar diretamente tabelas de producao;
- nao expor tokens, URLs de clientes ou conteudo de conversas em logs;
- nao desligar Analytics/Vector nesta mesma entrega.

## Observabilidade e aceite

O bridge deve registrar apenas metricas tecnicas agregadas por rodada:

- modo (`startup`, `steady` ou `recovery`);
- canais e conversas examinados;
- mensagens candidatas, ja conhecidas e encaminhadas;
- duracao;
- falhas sem dados pessoais.

Criticos de aceite:

1. Uma mensagem enviada manualmente no Chatwoot e entregue via webhook sem aguardar o
   polling.
2. Com webhook indisponivel, uma mensagem nova e recuperada pelo polling em no maximo
   30 segundos na operacao normal.
3. Apos reinicio, mensagens de ate 30 minutos continuam recuperaveis uma unica vez.
4. A mesma mensagem nao e enviada duas vezes.
5. O numero de consultas `GET /rest/v1/messages` cai substancialmente apos 24 horas de
   observacao; a meta inicial e queda superior a 90% no caminho de fallback.
6. Campanhas, funis, canais WhatsApp, Facebook e Instagram permanecem saudaveis.

## Plano de rollout

1. Implementar com testes unitarios para janela normal, partida, falha e deduplicacao.
2. Fazer deploy sem mudar o `SYNC_OUT_ENABLED`.
3. Conferir `/health`, `/version`, logs do bridge e um envio manual interno.
4. Medir contadores do bridge e tamanho de `_analytics` apos 24 horas.
5. Manter a configuracao anterior como rollback imediato por variaveis de ambiente.

## Fase de infraestrutura posterior

Depois da queda comprovada de trafego, decidir separadamente se o Logflare/Vector local
deve continuar ativo. Desativa-lo preserva Supabase DB, Auth, Storage, Realtime e Bridge,
mas remove o Logs Explorer do Studio. Essa decisao exige previa do compose, homologacao e
autorizacao operacional propria. A limpeza do historico de 66 GB tambem sera uma operacao
separada e controlada.

