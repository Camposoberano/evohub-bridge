# Reconciliação automática e alertas do funil 5895

## Objetivo

Impedir que o timeout da resposta da uazapi paralise conversas cujo vídeo já foi entregue, sem reenviar peças incertas, e tornar visíveis todos os bloqueios reais da fila.

## Fluxo

1. O envio pelo bridge preserva a regra atual: timeout após o início do despacho marca a peça `failed` com `last_outcome=uncertain`; não tenta novamente.
2. Um workflow n8n separado chama, a cada minuto na janela de 06h–21h de Fortaleza, um endpoint autenticado do bridge. O endpoint examina um lote limitado de peças incertas do funil WhatsApp 5895. Não envia mensagens.
3. Para cada peça, o bridge consulta `/message/find` da instância 5895 e exige exatamente um recibo `Delivered`, `Read` ou `Played`, com destinatário, tipo, conteúdo e horário compatíveis. Uma correspondência única muda a peça para `sent`, guarda o identificador/status do provedor, registra evento e libera as próximas etapas. Zero ou múltiplas correspondências deixam a peça intacta e geram alerta. Falha na consulta também preserva a peça.
4. O workflow principal da fila sinaliza erro sempre que houver qualquer bloqueio real. Resultados temporários (`not_due`, processamento em andamento, janela de envio) continuam classificados como espera. Outras conversas da mesma rodada seguem enviando.
5. O bridge registra para mídia o tipo, duração do pedido à uazapi, etapa da resposta e tamanho do arquivo quando o `HEAD` já tiver fornecido `Content-Length`. Não grava URL, telefone, token nem conteúdo no diagnóstico. Painel e alertas agrupam timeout e recibos pendentes por tipo e tamanho.

## Segurança e idempotência

O endpoint usa `N8N_ACTION_SECRET`, aceita apenas o canal WhatsApp 5895 e limita lote/frequência. Uma atualização condicional vincula o `attempt_id` observado ao estado `failed`; invocações concorrentes não criam dois eventos de reconciliação. A consulta ao provedor nunca dispara mensagem. Falta de prova inequívoca mantém a conversa pausada para revisão humana. O PR #10 permanece como procedimento manual de contingência.

## Verificação

Testes dirigidos cobrem recibo único, ausente/ambíguo, concorrência, falha do provedor, ausência de reenvio, bloqueio único no n8n e captura de diagnósticos sem dados pessoais. Na produção, conferir a execução do n8n, o estado da fila e amostras de recibos. Nenhuma mensagem de teste será disparada para clientes.
