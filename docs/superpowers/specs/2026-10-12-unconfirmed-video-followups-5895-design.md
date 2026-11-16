# Continuação após vídeo sem confirmação no funil 5895

## Decisão aprovada

Após dez minutos de um vídeo assíncrono sem recibo de entrega, a conciliação consulta o histórico da Uazapi. Se houver exatamente uma cópia `Sent` da tentativa correta, a fila libera as etapas seguintes do mesmo funil. O vídeo permanece `failed/uncertain`, visível como entrega não confirmada e elegível para conciliação posterior. Nenhuma consulta ou liberação reenvia o vídeo.

## Evidência e limites

A cópia precisa corresponder ao `track_id`, URL da mídia, destinatário, tipo e horário da tentativa. Zero cópias, múltiplas cópias, busca incompleta ou erro no provedor preservam o bloqueio. Um recibo `Delivered`, `Read` ou `Played` continua sendo a única prova para marcar o vídeo como enviado. A liberação vale somente para vídeos assíncronos do funil `mega-sorgo-5895-20260930`, na mesma execução.

## Operação

A liberação grava `followups_released_at` e o ID da cópia em metadados da peça, com compare-and-set pelo ID da tentativa. Um evento único registra conversa, etapa e evidência. O painel mostra que a sequência seguiu apesar de o vídeo continuar sem entrega confirmada. O alerta operacional lista as conversas afetadas. A conciliação continua procurando recibos novos, mas uma peça já liberada com a mesma cópia `Sent` deixa de gerar erro no n8n a cada minuto.
