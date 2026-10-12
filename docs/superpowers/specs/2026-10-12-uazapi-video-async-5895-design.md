# Vídeo do funil 5895: aceitação rápida com confirmação por recibo

## Objetivo

Reduzir o bloqueio de 45 segundos no envio de vídeos do funil restaurado do WhatsApp 5895 sem tratar uma resposta `Queued` como entrega e sem criar cópias.

## Evidência

- Quatro vídeos do funil têm 12,3–16,0 MB; seus URLs responderam a `HEAD` em cerca de 0,2 segundo.
- Um envio síncrono de 15,65 MB terminou em timeout de 45 segundos aguardando resposta da Uazapi; o recibo posterior confirmou a entrega.
- Um teste único ao número de teste 11 91036-3320 com `async: true` respondeu em 537 ms com status `Queued`. A consulta posterior `/message/find` mostrou `Delivered`, com o mesmo `id`, `track_id` e arquivo.

## Fluxo aprovado

1. Somente um vídeo agendado do funil `mega-sorgo-5895-20260930` no canal 5895 usa `POST /send/media` com `async: true` e `track_id` derivado do `attempt_id` persistido antes do envio. Outras mídias e outros canais mantêm o caminho atual.
2. A resposta `Queued` registra aceitação na fila interna do provedor, mas não marca a peça como `sent` nem avança a sequência.
3. O bridge consulta `/message/find` por no máximo 20 segundos. Confirma somente um recibo `Delivered`, `Read` ou `Played` do destinatário, vídeo, arquivo e `track_id` daquela tentativa; quando houver ID na resposta inicial, o recibo deve ter o mesmo ID.
4. Falha de consulta, ausência de recibo ou múltiplos recibos deixa a tentativa `uncertain`, bloqueia a peça seguinte e usa a reconciliação n8n já publicada. Nunca reenvia automaticamente.
5. A reconciliação também reconhece `track_id` quando existir, além dos critérios atuais. O evento operacional distingue espera de recibo de timeout de transporte, sem registrar telefone, URL ou conteúdo.

## Verificação

- Conferir tipos e fluxo local, incluindo resposta `Queued`, recibo único, ausência, ambiguidade e erro.
- Publicar em produção; acompanhar uma execução real agendada, os estados da fila e o recibo do provedor. Não criar envio de teste adicional ao cliente.
