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

## Critério operacional

Não reenviar uma etapa marcada como `sent` apenas porque o cliente não a vê no Chatwoot. Conferir `messages`, `funnel_delivery_attempt`, o provedor e o recibo antes de repetir o envio. A sequência completa leva aproximadamente dois dias úteis; acompanhar as etapas restantes e qualquer `failed` ou `uncertain`.
