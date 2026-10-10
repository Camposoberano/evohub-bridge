# Workflows do WhatsApp Oficial 5895 no n8n Soberano

Instância: `https://automacao.soberano.pro`. Projeto n8n: pessoal de Cícero de Matos (`LTI5Jh7p1cbLrrAX`). Criados em 10/10/2026, todos inativos até completar credenciais, publicação do bridge e verificação real.

| Ação | Workflow ID | Peças | Situação |
| --- | --- | ---: | --- |
| Funil completo 30-09 | `Gi816kZhzzlSZGbG` | 31, em 5 fases | Rascunho |
| Preço | `LpIJzlfzIQVb6m1b` | 4 | Rascunho |
| Vídeo | `tHXWvor101ACf9Uk` | 1 | Rascunho |
| Plantio | `UFn1CDKL2ZIDHqFh` | 2 | Rascunho |
| Nutrição | `VMNm5NS9YvSkKR0n` | 2 | Rascunho |
| Recuperação 1 | `ScpS8QFJ0mUe2VqV` | 1 | Rascunho |
| Recuperação 2 | `OKSLDm55eSBCM9fT` | 2 | Rascunho |
| Recuperação 3 | `oqKTRZtRM7iWPGig` | 2 | Rascunho |
| Recuperação 4 | `SjGRW2ItnLVqtxPd` | 1 | Rascunho |
| Abrir catálogo | `Jybjc2MAL1uQt1lb` | Controle | Rascunho |
| Voltar ao Mega Sorgo | `ElTVXX90R4KjdgSx` | Controle | Rascunho |
| Pausar | `UEG65que4bk3bO1u` | Controle | Rascunho |
| Retomar | `7lR1VkUeUdeDu4T7` | Controle | Rascunho |
| Parar | `ChaOmWGgdbXAyLOs` | Controle | Rascunho |

O funil principal foi exportado de `FASES` para `ops/soberano-5895-funil-pieces.json`: 7/5/5/6/8 peças; 10 áudios, 4 vídeos, 4 imagens, 6 botões interativos, 5 listas, 1 texto e 1 sequência de texto. Mídias são referidas por dia e slot e resolvidas pelo bridge na biblioteca `funnel_media` ativa. A consulta de 10/10 confirmou os slots necessários e as três artes de preço.

O workflow ativo da fila `pQFCtRhzQTKqXTjS` foi corrigido e publicado na versão `4483e0b3-9fd9-4911-8355-305b671d83c8`: busca somente `mega-sorgo-5895-20260930`, passa `scheduled_message_id` ao bridge e não marca `sent` por PATCH independente. Primeira execução ativa observada: `158794`, sem peças vencidas. A apresentação antiga `UqpRZbkcslDBnZ9K` permanece inativa.

## Pendências para ativação

1. Associar uma credencial `httpHeaderAuth` de entrada (header `Authorization: Bearer ...`) e uma `httpBearerAuth` de saída em cada workflow. O SDK criou os rascunhos sem associação automática; nenhum segredo foi colocado nos nós.
2. Configurar no bridge `SOBERANO_N8N_BASE_URL`, `SOBERANO_N8N_WEBHOOK_SECRET`, `N8N_ACTION_SECRET`; manter `SOBERANO_N8N_ACTIONS_ENABLED` vazio até a publicação e a verificação de cada ação.
3. Revisar a janela de 24 horas e o template das recuperações antes de habilitá-las. O caminho antigo envia template quando a janela está fechada; o novo lote de peças ainda precisa preservar essa decisão.
4. Publicar o bridge no ramo efetivo do Coolify e verificar `/version` e `/health`. Fazer um disparo real controlado no 5895 em janela comercial, comparando mensagem visível, retorno do provedor e `scheduled_messages`.

Não interpretar `accepted` como mensagem entregue. `sent` indica confirmação do serviço de envio, e a entrega ao aparelho pode ser posterior.
