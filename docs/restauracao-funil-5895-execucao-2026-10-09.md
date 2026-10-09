# Execução da restauração do funil 5895 em 09/10/2026

## O que foi publicado

- O roteiro multimídia de 30/09 foi recuperado na versão `mega-sorgo-5895-20260930`: 31 etapas, cinco fases, dez áudios e quatro vídeos. O catálogo histórico `mega-sorgo` fornece os arquivos.
- A versão curta `mega-sorgo-5895-v2` e a abertura antiga de duas peças ficam identificadas separadamente. O canal 5895 inscreve novos leads de anúncio apenas na versão restaurada.
- Respostas de preço não pausam essa versão; os botões históricos têm ações. Falha de mídia impede a conclusão falsa.
- Publicação inicial: commits `669b615` e `acc9cd4` em `main`, com `/version` retornando `2026-10-09-funil-completo-5895-30-09` e `/health` retornando `ok`.

## Migração e evidência de envio

- O #3509 foi inscrito primeiro. Sua saudação, imagem, mensagem com botões, dois áudios e primeiro vídeo foram aceitos em ordem pelo caminho de envio. O evento `funnel_delivery_attempt` registrou `sent` para o vídeo às 20:47:55 UTC.
- Outras 34 conversas elegíveis foram inscritas, inclusive #3501 e #3503. Cada uma recebeu uma fila de 31 etapas. Ao todo: 35 sequências e 1.085 etapas agendadas.
- Foram excluídas da migração 12 conversas com pedido real de atendimento, quatro encerradas, bloqueadas ou com bot desligado e cinco sem evidência de anúncio. Pedidos registrados apenas como `cotacao` foram incluídos, pois preço deve coexistir com o funil.
- A primeira etapa das 35 sequências ficou `sent`, com uma mensagem de saída registrada para cada conversa. Este status registra aceitação no caminho de envio; não confirma entrega ao aparelho. Na auditoria inicial do lote, havia 121 etapas `sent`, 964 `pending`, nenhuma `failed` e nenhuma `paused` na versão restaurada.
- Nenhuma etapa `pending` ou `paused` das versões antigas restava nas conversas do 5895 abertas desde 06/10. A última peça antiga pausada (#3507) foi cancelada.

## Achado adicional

Cinco pares de mensagens de saída com mesmo conteúdo apareceram no espelho do Chatwoot com diferença inferior a três segundos. Um registro estava vinculado à etapa do funil, e o outro era eco sem vínculo. A correção posterior aguarda o eco híbrido e reaproveita sua linha antes de criar a mensagem espelhada. Ainda é preciso conferir a incidência após o próximo deploy. Esses pares, por si só, não provam dois envios ao aparelho.

Na primeira fase do lote, o vídeo da #3402 terminou `failed/uncertain` após um erro de transporte no worker do bridge. A consulta ao histórico da Uazapi encontrou **dois** envios do mesmo arquivo para esse chat, ambos com status `Delivered`, às 20:56:39 e 20:57:20 UTC. Assim, o problema real era a concorrência entre o cron do n8n e o worker local do bridge sobre a mesma etapa. A correção `afba779`, publicada às 21:08 UTC, retira as peças normais da versão restaurada da seleção do worker local. O cron do n8n continua consumindo essa versão; o bridge conserva a rota de intenção adiada, manutenção e auditoria. A etapa #3402 foi reconciliada com a evidência do provedor, marcada `sent` e liberou o passo seguinte **sem reenviar** ao WhatsApp.

A auditoria posterior do histórico do provedor encontrou o primeiro vídeo com status `Delivered` nas **35 de 35** conversas. Houve dois casos com cópia duplicada antes da correção: #3509 (20:47:20 e 20:47:26 UTC) e #3402 (horários acima). As sete peças da primeira fase das 35 sequências ficaram `sent`. Consulta paginada às 21:18 UTC: 1.085 peças, sendo 245 `sent`, 816 `pending`, 24 `paused`, zero `failed`. As 24 pausas pertencem somente à #3455. O Chatwoot contém nota privada de pedido de atendimento, atribuição a agente e resposta ao cliente às 21:08 UTC, após áudio recebido; por isso a pausa foi mantida. O histórico mostra preços enviados antes do pedido, mas a decisão de pausa foi o pedido registrado como `atendimento`, não o preço isolado.

O Chatwoot espelha algumas mídias somente como texto (`[áudio]`, `[video]`) sem anexo, apesar da confirmação `Delivered` no WhatsApp pela Uazapi. Exemplo: #3509 mostra `[video]` no painel, sem arquivo anexado; #3402 não mostra bolha de vídeo na lista recente. Isso explica por que a inspeção visual do painel pode indicar ausência de envio. A prova de entrega para estas peças está no histórico da Uazapi, e a representação do Chatwoot requer correção independente.

Após o deploy do despachante único, a segunda fase do piloto #3509 começou às 21:20 UTC. Suas cinco peças foram marcadas `sent`; a abertura interativa e o vídeo têm um único recibo `Delivered` cada no histórico da Uazapi. Até 21:26 UTC, não havia nova conversa aberta no canal 5895 desde o deploy, portanto o gatilho automático para leads posteriores ainda não teve um caso novo observável.

Auditoria final da segunda fase às 21:38 UTC: as cinco peças das 34 conversas ativas ficaram `sent` (170 peças); as cinco peças da #3455 continuam `paused` por atendimento humano; nenhuma ficou `failed`. A Uazapi confirmou exatamente **uma** abertura interativa e **um** vídeo `Delivered` por conversa ativa (34/34), inclusive #3501, #3503, #3509 e #3402. Nenhuma duplicação nova foi observada após o deploy. O vídeo #3474 apareceu temporariamente como `Queued` no provedor, mas passou a `Delivered` na consulta seguinte; não foi reenviado. A auditoria ainda registra somente os dois vídeos duplicados da primeira fase, anteriores à correção.

Scripts reexecutáveis: `ops/audit-5895-provider-first-phase.ts` cruza a fila com o histórico da Uazapi sem mudar dados; `ops/reconcile-3402-video.ts` guarda a reconciliação idempotente da etapa #3402 com prova do provedor. Os dois passaram em `deno check`.

## Critério operacional

Não reenviar uma etapa marcada como `sent` apenas porque o cliente não a vê no Chatwoot. Conferir `messages`, `funnel_delivery_attempt`, o provedor e o recibo antes de repetir o envio. A sequência completa leva aproximadamente dois dias úteis; acompanhar as etapas restantes e qualquer `failed` ou `uncertain`.
