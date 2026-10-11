# Workflows do WhatsApp Oficial 5895 no n8n Soberano

Instância: `https://automacao.soberano.pro`. Projeto n8n: pessoal de Cícero de Matos (`LTI5Jh7p1cbLrrAX`). Os 14 workflows foram publicados em 10/10/2026. A migração de execução exclusiva do 5895 está na branch `codex/n8n-all-funnels-5895`; até seu deploy, as quatro recuperações ainda seguem o código do bridge.

Janela solicitada para os disparos automáticos dos funis: 06h–21h, horário de Fortaleza (UTC−3). O agendamento e a fila cortam às 20h55 para que envios em andamento terminem antes das 21h. Peças restantes conservam seus intervalos úteis e retomam a partir das 06h do dia seguinte. Respostas humanas no Chatwoot e campanhas independentes têm regras próprias.

| Ação | Workflow ID | Peças | Situação |
| --- | --- | ---: | --- |
| Funil completo 30-09 | `Gi816kZhzzlSZGbG` | 31, em 5 fases | Publicado e habilitado |
| Preço | `LpIJzlfzIQVb6m1b` | 4 | Publicado e habilitado |
| Vídeo | `tHXWvor101ACf9Uk` | 1 | Publicado e habilitado |
| Plantio | `UFn1CDKL2ZIDHqFh` | 2 | Publicado e habilitado |
| Nutrição | `VMNm5NS9YvSkKR0n` | 2 | Publicado e habilitado |
| Recuperação 1 | `ScpS8QFJ0mUe2VqV` | 1 | Publicado; ligação no bridge pendente de deploy |
| Recuperação 2 | `OKSLDm55eSBCM9fT` | 2 | Publicado; ligação no bridge pendente de deploy |
| Recuperação 3 | `oqKTRZtRM7iWPGig` | 2 | Publicado; ligação no bridge pendente de deploy |
| Recuperação 4 | `SjGRW2ItnLVqtxPd` | 1 | Publicado; ligação no bridge pendente de deploy |
| Abrir catálogo | `Jybjc2MAL1uQt1lb` | Controle | Publicado e habilitado |
| Voltar ao Mega Sorgo | `ElTVXX90R4KjdgSx` | Controle | Publicado e habilitado |
| Pausar | `UEG65que4bk3bO1u` | Controle | Publicado e habilitado |
| Retomar | `7lR1VkUeUdeDu4T7` | Controle | Publicado e habilitado |
| Parar | `ChaOmWGgdbXAyLOs` | Controle | Publicado e habilitado |

O funil principal foi exportado de `FASES` para `ops/soberano-5895-funil-pieces.json`: 7/5/5/6/8 peças; 10 áudios, 4 vídeos, 4 imagens, 6 botões interativos, 5 listas, 1 texto e 1 sequência de texto. Mídias são referidas por dia e slot e resolvidas pelo bridge na biblioteca `funnel_media` ativa. A consulta de 10/10 confirmou os slots necessários e as três artes de preço.

As macros do Chatwoot já passam pelo n8n nas dez ações habilitadas. A resposta automática de **preço, vídeo, plantio e nutrição** no 5895 foi ligada aos mesmos quatro workflows: texto, áudio reconhecido e botão de menu usam o conteúdo do nó `Conteúdo`/`Artes e opções de preço` no n8n. O bridge conserva a identificação da intenção, a fila, a deduplicação e a entrega ao WhatsApp. Os cliques dos temas de plantio (13 opções), nutrição (10 opções) e preço (pacotes, cotação, pagamento) usam o campo `selection` no workflow respectivo. O workflow de preço contém as artes, textos e botões; o bridge conserva o registro da cotação, a atribuição e a nota privada. Após a escolha de finalidade, o conteúdo inicial de preço também é acionado no n8n. A resposta de contexto ou prova por finalidade ainda sai do bridge, pois depende da disponibilidade da mídia aprovada no banco.

O workflow ativo da fila `pQFCtRhzQTKqXTjS` foi publicado na versão `d1c4d8c4-fb75-4667-850a-4a25ecce9ff4`: busca somente `mega-sorgo-5895-20260930`, passa `scheduled_message_id` ao bridge, não marca `sent` por PATCH independente e consulta 200 registros vencidos recentes por rodada. O nó inicial bloqueia saídas após 20h55 e antes das 06h de Fortaleza; a execução `160088` às 21h12 gerou zero itens. Em 10/10, o limite antigo de 50 registros mais antigos ocultou a conversa #3524 atrás de 81 pendências; a execução `159848` já incluiu e enviou a abertura. A apresentação antiga `UqpRZbkcslDBnZ9K` permanece inativa.

Na #3524, a pergunta pré-preenchida do anúncio também foi confundida com pedido de atendimento humano e pausou a régua. O bridge passou a manter o funil restaurado ativo para essa saudação e a não criar a rota `menu_humano` por ela. A rota falsa da #3524 foi cancelada e as peças foram retomadas com os intervalos preservados. Às 18:05 BRT: sete peças da fase 1 enviadas, 24 pendentes, sequência `running`; o provedor registrou texto, imagem, menu, áudios e vídeo como `Read` ou `Played`. A fase 2 inicia às 18:33 BRT. O deploy efetivo da regra foi `fec42536547870eedb7f1dfacb5c6a4641df1ff0`.

## Pendências

1. Publicar a ligação das quatro recuperações ao n8n após revisão do código. A cadeia automática usa `recovery_sent` apenas após todas as peças da recuperação ficarem `sent`; a aceitação na fila devolve `queued` e não avança a variação. A entrada do 5895 usa a rota híbrida UazAPI; se ela não estiver disponível e a janela Meta estiver fechada, a peça não deve ser considerada enviada.
2. Migrar os leads antigos que receberam a versão curta só após checar janela Meta e atendimento humano ativo. A correção automática já permite reinscrição quando um lead de anúncio aberto desde 06/10 volta a escrever.
3. Tirar as credenciais embutidas nos dois nós HTTP do cron da fila e substituí-las por credenciais gerenciadas no n8n.
4. A escolha de finalidade (`uso_silagem`, `uso_pastejo`, `uso_outro`) foi adicionada à versão `a20c2eb9-1dc2-4a0a-98fa-fcd5ba68b6a0` do workflow de Preço. Não havia slot de prova aprovado na consulta de 10/10; o texto de contexto e as quatro peças de preço passam a ser produzidos no n8n após o deploy do bridge. Uma futura mídia de prova exige referência a slot ativo e aprovado no workflow.

Não interpretar `accepted` como mensagem entregue. `sent` indica confirmação do serviço de envio, e a entrega ao aparelho pode ser posterior.

Em 10/10, os cliques de plantio/nutrição foram publicados no bridge em `f259d9c`; os de preço em `8be8520`. Ambos os deploys terminaram e o `/health` respondeu 200. As versões ativas dos três workflows coincidem com o conteúdo editado; a avaliação local do nó de conteúdo retornou as peças iniciais e as respostas por seleção esperadas. Onze verificações direcionadas do contrato/roteamento passaram. A consulta após 23:09 UTC não encontrou conversa nova no canal 5895; portanto ainda não há evidência de envio real dessas seleções em cliente após o deploy. O cron de fila continuava executando com sucesso a cada minuto.

## Rastreamento da entrada por anúncio (10/10)

O webhook UAZAPI reconhece `referral`/`externalAdReply` da Meta antes de classificar o texto. `ingestInbound` persiste `origem=anuncio` e agora grava `ad_origin_detected` na primeira detecção; perguntas de preço ou qualquer outro texto mantêm essa atribuição. O funil principal é inscrito uma vez por conversa. Um watchdog no bridge consulta as conversas de anúncio abertas do 5895 a cada 20 segundos, tenta recuperar as que não têm a sequência `mega-sorgo-5895-20260930` e registra `ad_watchdog_enrolled` quando confirma a criação. A execução manual de diagnóstico está em `ops/run-ad-funnel-watchdog-5895.ts`.

Na #3527, aberta às 18:17:38 BRT com `referral` e pergunta de preço, o watchdog encontrou a sequência ausente e a criou às 18:18:27. A primeira peça saiu às 18:19:28; às 18:23:38 havia cinco enviadas e 26 pendentes. O cron da fila pode adicionar até cerca de um minuto entre `send_at` e `sent_at`; acompanhar esse intervalo em novos leads. Não habilitamos disparo indiscriminado para todas as conversas novas porque a referência da Meta está disponível e houve conversa iniciada por saída do próprio número.

Na mesma #3527, antes do funil restaurado, foram enviadas cinco peças de preço fora da fila do funil, incluindo “Promoção SAFRINHA” com validade 20/09/2026 já vencida. Essas peças não carregam `funnel` nem `scheduled_message_id` no banco; a origem exata da automação legada ainda precisa ser localizada no UAZAPI/Chatwoot. Não repetir esse conteúdo nas ações novas.

A peça 5 (vídeo da fase 1) da #3527 ficou `failed` com resultado `uncertain`. A consulta direta ao provedor encontrou exatamente uma cópia com status `Read` e o mesmo arquivo. `ops/reconcile-3527-phase1-video.ts --apply` marcou essa peça como enviada, com trilha de reconciliação, sem duplicar o vídeo. Esse caso e o vídeo da fase 3 da #3501 mostram que a resposta incerta do provedor ainda merece uma reconciliação automática; a checagem de anúncio cobre inscrição ausente, não todas as falhas de mídia.
