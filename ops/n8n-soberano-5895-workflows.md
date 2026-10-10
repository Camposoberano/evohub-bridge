# Workflows do WhatsApp Oficial 5895 no n8n Soberano

Instância: `https://automacao.soberano.pro`. Projeto n8n: pessoal de Cícero de Matos (`LTI5Jh7p1cbLrrAX`). Os 14 workflows foram publicados em 10/10/2026. As dez ações imediatas estão habilitadas no bridge; as quatro recuperações continuam com a flag desligada até preservar o uso de template fora da janela Meta.

| Ação | Workflow ID | Peças | Situação |
| --- | --- | ---: | --- |
| Funil completo 30-09 | `Gi816kZhzzlSZGbG` | 31, em 5 fases | Publicado e habilitado |
| Preço | `LpIJzlfzIQVb6m1b` | 4 | Publicado e habilitado |
| Vídeo | `tHXWvor101ACf9Uk` | 1 | Publicado e habilitado |
| Plantio | `UFn1CDKL2ZIDHqFh` | 2 | Publicado e habilitado |
| Nutrição | `VMNm5NS9YvSkKR0n` | 2 | Publicado e habilitado |
| Recuperação 1 | `ScpS8QFJ0mUe2VqV` | 1 | Publicado, flag desligada |
| Recuperação 2 | `OKSLDm55eSBCM9fT` | 2 | Publicado, flag desligada |
| Recuperação 3 | `oqKTRZtRM7iWPGig` | 2 | Publicado, flag desligada |
| Recuperação 4 | `SjGRW2ItnLVqtxPd` | 1 | Publicado, flag desligada |
| Abrir catálogo | `Jybjc2MAL1uQt1lb` | Controle | Publicado e habilitado |
| Voltar ao Mega Sorgo | `ElTVXX90R4KjdgSx` | Controle | Publicado e habilitado |
| Pausar | `UEG65que4bk3bO1u` | Controle | Publicado e habilitado |
| Retomar | `7lR1VkUeUdeDu4T7` | Controle | Publicado e habilitado |
| Parar | `ChaOmWGgdbXAyLOs` | Controle | Publicado e habilitado |

O funil principal foi exportado de `FASES` para `ops/soberano-5895-funil-pieces.json`: 7/5/5/6/8 peças; 10 áudios, 4 vídeos, 4 imagens, 6 botões interativos, 5 listas, 1 texto e 1 sequência de texto. Mídias são referidas por dia e slot e resolvidas pelo bridge na biblioteca `funnel_media` ativa. A consulta de 10/10 confirmou os slots necessários e as três artes de preço.

O workflow ativo da fila `pQFCtRhzQTKqXTjS` foi publicado na versão `acb77878-7920-4fe0-b3a9-ee721ba14c5e`: busca somente `mega-sorgo-5895-20260930`, passa `scheduled_message_id` ao bridge, não marca `sent` por PATCH independente e consulta 200 registros vencidos recentes por rodada. Em 10/10, o limite antigo de 50 registros mais antigos ocultou a conversa #3524 atrás de 81 pendências; a execução `159848` já incluiu e enviou a abertura. A apresentação antiga `UqpRZbkcslDBnZ9K` permanece inativa.

Na #3524, a pergunta pré-preenchida do anúncio também foi confundida com pedido de atendimento humano e pausou a régua. O bridge passou a manter o funil restaurado ativo para essa saudação e a não criar a rota `menu_humano` por ela. A rota falsa da #3524 foi cancelada e as peças foram retomadas com os intervalos preservados. Às 18:05 BRT: sete peças da fase 1 enviadas, 24 pendentes, sequência `running`; o provedor registrou texto, imagem, menu, áudios e vídeo como `Read` ou `Played`. A fase 2 inicia às 18:33 BRT. O deploy efetivo da regra foi `fec42536547870eedb7f1dfacb5c6a4641df1ff0`.

## Pendências

1. Revisar a janela de 24 horas e o template das recuperações antes de habilitar as quatro flags. O caminho antigo envia template quando a janela está fechada; o novo lote de peças ainda precisa preservar essa decisão.
2. Migrar os leads antigos que receberam a versão curta só após checar janela Meta e atendimento humano ativo. A correção automática já permite reinscrição quando um lead de anúncio aberto desde 06/10 volta a escrever.
3. Tirar as credenciais embutidas nos dois nós HTTP do cron da fila e substituí-las por credenciais gerenciadas no n8n.

Não interpretar `accepted` como mensagem entregue. `sent` indica confirmação do serviço de envio, e a entrega ao aparelho pode ser posterior.
