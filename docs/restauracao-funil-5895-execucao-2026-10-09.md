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

## Continuação em 10/10, após meia-noite de Fortaleza

- Dois novos leads de anúncio chegaram após o deploy. #3512 entrou automaticamente na versão restaurada; as fases 1 e 2 (12 peças) ficaram `sent`, e a Uazapi registra um vídeo `Read` na fase 1 e um `Delivered` na fase 2, sem duplicação. As 19 peças restantes seguem agendadas.
- #3511 perguntou somente "Vocês oferecem entrega em todo o Brasil?". A regra antiga tratou logística como atendimento humano e pausou as 31 peças antes da saudação. Nenhuma peça havia sido enviada. A correção `09dfc46` foi publicada com build `2026-10-10-funil-5895-logistica-sem-pausa`: perguntas de logística de anúncio recebem resposta automática sem pausar a versão restaurada. A fila da #3511 foi reprogramada, sem WhatsApp resend, para iniciar às 06h de Fortaleza em 10/10: sequência `running`, 31 peças `pending`.
- A resposta de logística do #3511 foi agendada como rota adiada, separada das 31 peças, às 06h07min20s de Fortaleza, após a primeira fase. O texto confirma entrega nacional, nota fiscal, rastreio e frete grátis; pede município/UF para confirmação do prazo. O deploy `dbd647c`, build `2026-10-10-funil-5895-resposta-logistica-adiada`, foi confirmado em produção antes do agendamento. Estado conferido: sequência `running`, 31 peças normais `pending` e uma rota `deferred_intent` `paused`, aguardando a abertura; nenhuma mensagem foi enviada durante a recuperação.
- Além da #3455, a #3475 pausou as 19 peças futuras após um áudio recebido; o sistema registrou `tipo_pedido: atendimento` e atribuiu a conversa. Mais tarde, o banco passou a registrar `outcome: lost` e as 19 peças foram `cancelled`; esse desfecho impede a retomada automática. O usuário autorizou transcrever os áudios de #3455 e #3475, mas o ambiente local não tem chaves OpenAI/Gemini, então a tentativa retornou `null` para ambos. A classificação do conteúdo desses áudios não foi revisada independentemente.
- Retrato às 00h09 de Fortaleza: 37 sequências na versão restaurada (35 `running`, uma `paused`, uma `cancelled`); 1.147 peças normais, com 427 `sent`, 677 `pending`, 24 `paused` e 19 `cancelled`, sem `failed`; há ainda a rota logística adiada da #3511. Este retrato inclui as conversas novas #3511 e #3512 e substitui os totais anteriores, que eram de 35 sequências.

## Critério operacional

Não reenviar uma etapa marcada como `sent` apenas porque o cliente não a vê no Chatwoot. Conferir `messages`, `funnel_delivery_attempt`, o provedor e o recibo antes de repetir o envio. A sequência completa leva aproximadamente dois dias úteis; acompanhar as etapas restantes e qualquer `failed` ou `uncertain`.
