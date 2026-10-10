# Diagnóstico dos anúncios do 5895 — sete dias

Consulta feita em 10/10/2026, desde 03/10 às 18:39 BRT. Fonte: conversas com `referral` da Meta ou `origem=anuncio` no banco Soberano, sequências, fila de mensagens e horário do primeiro inbound. Dados individuais, sem nome ou telefone, em `audit-5895-ads-seven-days-result.json`.

| Medida | Resultado |
| --- | ---: |
| Conversas de anúncio | 93 |
| Receberam alguma resposta em até 15 s | 71 |
| Com sequência restaurada de 30/09 | 48 |
| Com somente sequência anterior | 45 |
| Sequência registrada, sem nenhuma peça na fila | 4: #3472, #3473, #3478, #3480 |
| Conversas com ao menos uma peça `failed` | 58 |
| Peças em `failed` | 96 |

As 45 conversas sem sequência restaurada **não equivalem automaticamente a 45 leads sem funil**: muitas receberam as 31 peças do antigo `mega-sorgo` em 04–05/10. Quatro têm sequência registrada mas nenhuma peça na fila e requerem avaliação individual antes de qualquer reenvio. O campo `failed` também não prova falta de entrega: já houve vídeos marcados assim com cópia `Read` no provedor. O grupo de falhas concentra-se nos passos de mídia 5, 10, 15 e 21; cada eventual correção precisa consultar o provedor para evitar duplicata.

No dia 10/10, até a consulta, houve 12 entradas de anúncio. Todas estavam inscritas na versão restaurada e tinham a abertura registrada como enviada, mas somente **2 de 12** receberam a primeira peça em até 15 s. Mediana: **46 s**. Dez ficaram acima da meta: #3515 (59 s), #3516 (40 s), #3517 (42 s), #3518 (60 s), #3519 (28 s), #3523 (3 h 11 min), #3524 (1 h 3 min), #3525 (39 s), #3527 (110 s) e #3528 (50 s). Em 10 de 12 houve alguma resposta inicial em até 15 s; resposta inicial e abertura do funil são medidas distintas.

O processamento anterior podia executar fluxo conversacional, catálogo ou preço antes de inscrever o anúncio. Uma dessas rotas podia consumir o primeiro inbound, deixando a inscrição para o watchdog. Após a inscrição, a primeira peça ainda aguardava o cron da fila, acrescentando dezenas de segundos. A correção põe a inscrição na entrada com referência Meta antes dessas rotas e envia imediatamente a peça 0 pelo mesmo endpoint com deduplicação usado pela fila. O watchdog permanece como retaguarda. É necessário medir novos leads após o deploy para comprovar a meta de 15 s; os dados acima são do comportamento anterior.
