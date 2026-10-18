# Auditoria de conversas e mensagens — 18/10/2026

**Janela:** 00h00–17h21 (America/Fortaleza). Leitura dos registros de produção, eventos de entrada e execuções dos dois workflows do 5895. Os números são uma fotografia do horário da consulta e podem crescer até o fim do dia. Nenhum dado de outro canal foi alterado.

## Movimento do dia

| Canal | Entradas registradas | Saídas com status `sent` | Conversas abertas hoje |
| --- | ---: | ---: | ---: |
| 5895 | 25 | 335 | 9 |
| 6836 | 11 | 8 | 0 |
| david inst | 7 | 1 | 1 |
| Atendimento IG | 6 | 1 | 1 |
| campo soberano | 2 | 2 | 1 |
| **Total** | **51** | **347** | **12** |

Nenhuma das 398 mensagens registradas hoje estava em `failed` no momento da leitura. O status `sent` representa registro de envio, não prova de leitura pelo destinatário.

## Entrada de mensagens

- O cruzamento dos **36 webhooks de entrada UAZAPI** de hoje com mensagens persistidas e ações encontrou **0 entradas perdidas, 0 cliques sem ação e 0 atrasos superiores a 1 minuto**.
- Às 11h28 houve um evento `inbound_processing_failed` com motivo `Consulta à UAZAPI expirou`. O cruzamento atual não aponta incidente em aberto decorrente desse evento; foi transitório ou recuperado.
- O clique antigo da conversa **#3693** continua destinado a atendimento manual, conforme instrução. A versão do monitor em produção repetiu o alerta `inbound_unprocessed` **16 vezes hoje**, apesar de não haver novo incidente de entrada.

## Saída, fila e reconciliação do 5895

- A fila principal executou **862 vezes** (entre 03h00 e 17h21): **858 sucessos, 3 erros e 1 execução em andamento** na fotografia. Os 3 erros foram `envio-incerto`, em 4 tentativas de vídeo. As 4 foram conciliadas com confirmação do provedor cerca de 2 minutos depois, nas conversas **#3737, #3740, #3744 e #3745**. Não havia tentativa nova de hoje ainda incerta.
- A reconciliação executou **862 vezes**, com **510 erros**. As respostas 503 amostradas repetem `unsupported_type` para o áudio antigo da conversa **#3677**; algumas também indicam `receipt_missing` de mídia antiga. Trata-se de repetição do mesmo bloqueio, não de 510 mensagens distintas perdidas. A correção para excluir áudio do reconciliador está pronta no código, ainda não publicada no bridge.
- Permanecem **2 mídias sem confirmação** que travam sequências: áudio da conversa **#3677**, etapa 24, e vídeo da **#3728**, etapa 5. Há **18 peças vencidas do 5895**: 6 em #3677 e 12 em #3728. Mantidas para revisão manual; reenviar sem confirmação pode duplicar mensagem ao cliente.
- Há **2 peças vencidas de outro funil** nas conversas #3520 e #3522. Foram apenas observadas.
- Os vídeos antigos das conversas #3527 e #3550 têm cópia `Sent` no provedor e sequências liberadas; continuam sem recibo de entrega/leitura. A correção do monitor os exclui do alerta de sequência bloqueada.
- Uma peça comprovadamente obsoleta do 5895, ligada à conversa #1565 com desfecho comercial `lost`, foi cancelada e auditada. As demais peças não foram canceladas.

## Alertas e outras conversas

- Foram registrados **29 envios de alerta** hoje. O conteúdo agregou 16 avisos repetidos da entrada antiga #3693 e 13 ocorrências de cada um destes sinais: instância UAZAPI desconectada, fila vencida e vídeo 5895 aguardando recibo. Os **96 eventos** `operational_alert` são amostras do monitor, não 96 mensagens enviadas.
- O sinal da instância desconectada envolve o **0595**. Não houve modificação nesse canal, conforme a restrição do usuário.
- Nas conversas sociais abertas hoje, #210 (`david inst`) e #3742 (`Atendimento IG`) tinham apenas entradas e nenhuma saída registrada até a consulta. Ambas merecem conferência pelo atendimento. A #3736 (`campo soberano`) tinha duas saídas antes das entradas, mas o campo `first_response_at` segue vazio; esse campo isolado não prova falta de resposta.

## Estado da correção do 5895

A lógica da fila n8n foi publicada e as execuções recentes estavam concluindo com sucesso; os 3 erros de hoje correspondiam a envios incertos novos, posteriormente conciliados. A correção no bridge para silenciar a repetição do áudio incerto, mostrar um alerta por bloqueio de mídia e respeitar o tratamento manual de #3693 passou em **37 testes direcionados** e checagem de tipos. Ela ainda precisa ser publicada para que a queda de ruído apareça em produção.

**Limite da verificação:** a auditoria consulta registros do Evohub, eventos brutos e execuções n8n. `sent` no banco ou `Sent` no provedor não equivale a `Delivered`, `Read` ou `Played` no WhatsApp.
