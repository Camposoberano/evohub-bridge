# Funil 5895: recibos incertos e alertas

- Fila principal n8n: `pQFCtRhzQTKqXTjS`. A versão publicada em 12/10/2026 acusa erro se qualquer peça da rodada tiver bloqueio real, mesmo que outras tenham sido enviadas. Esperas temporárias continuam normais.
- Conferência automática n8n: `KuOvfHpTUSVNxjX5`. Chama `POST /n8n-reconcile-5895` a cada minuto; usa a credencial HTTP existente `Soberano 5895 bridge enqueue`. Publicar somente após o endpoint do bridge estar implantado.
- Endpoint: autenticado por `N8N_ACTION_SECRET`, limitado ao WhatsApp +55 19 99971-5895 e à janela 06h–21h de Fortaleza. Examina até três tentativas incertas por rodada. Não envia WhatsApp.
- Prova: exatamente um recibo da uazapi `Delivered`, `Read` ou `Played` para o destinatário, tipo, arquivo/texto e horário da tentativa. O update exige `status=failed` e o mesmo `attempt_id`; invocações concorrentes não confirmam uma tentativa diferente.
- Sem prova, com prova ambígua ou falha de consulta: mantém `failed`, bloqueia as etapas seguintes da conversa e gera execução de erro. Não reenviar automaticamente.
- Evento `provider_delivery_reconciled` identifica a confirmação. Eventos `funnel_delivery_attempt` incluem `media_size_bytes` quando o HEAD já forneceu tamanho; `/operational-health` agrupa timeouts por tipo, faixa de tamanho e etapa da resposta. Não inclui URL/telefone/conteúdo no agrupamento.
- Contingência manual: `ops/reconcile-5895-uncertain.ts` do PR #10, sempre em `dry-run` antes de `--apply`.

## Verificação de publicação

1. Conferir saúde do bridge e 401 sem bearer no endpoint novo.
2. Conferir credencial do nó HTTP e publicar `KuOvfHpTUSVNxjX5`.
3. Inspecionar execuções reais, estado das peças `failed`, eventos e recibos; não enviar mensagens de teste a clientes.
4. Se não houver recibo inequívoco, manter a peça pausada e investigar individualmente.
