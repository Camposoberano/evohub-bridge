# Linha do tempo do EvoHub

**Recorte:** histórico da `main` até `08c6e5c` e documentação preservada no repositório, consultados em 22/10/2026. Horários abaixo são de America/Fortaleza (UTC−3). Datas de documentos indicam quando o texto foi registrado; datas de commits indicam quando o código entrou no Git. Somente os itens explicitamente marcados como implantação têm confirmação de deploy nesta auditoria.

## Marcos por período

| Período | Marco | Fonte e alcance da evidência |
|---|---|---|
| Julho de 2026 | Ponte entre EVO Hub, Chatwoot e banco; consolidação da operação social e da migração. | [Handoff de operação](HANDOFF-OPERACAO-2026-07-21.md), [handoff social](HANDOFF-SOCIAL-2026-07-21.md), [histórico pós-migração](historico-operacional-evohub-pos-migracao-2026-07.md). São registros da época. |
| Agosto de 2026 | Motor conversacional com posição, ramificação e timeout; expansão do fluxo e da recuperação de clientes. | [Motor de fluxo](motor-de-fluxo.md), [recuperação de clientes](RECUPERACAO-DE-CLIENTES.md). Verificar o código atual antes de usar regras antigas. |
| Setembro de 2026 | Campanhas do Sul, mensageria híbrida, PDF/isca e redução/retenção de dados ganham especificações próprias. | [Estratégia Sul](estrategia-disparo-sul.md), [auditoria híbrida](auditoria-mensageria-hibrida-e-replicacao.md), [especificações](superpowers/specs/). |
| 05–13/10 | Funil comercial, recuperação de 5895 e recibos de vídeo evoluem em planos e código. | [Planos](superpowers/plans/), [restauração 5895](restauracao-funil-5895-execucao-2026-10-09.md), [PR #19](https://github.com/Camposoberano/evohub-bridge/pull/19). Distinguir propostas de código mesclado. |
| 14/10 | Ajustes da retomada Embrapa e PDFs diferidos entram no histórico Git. | [PR #20](https://github.com/Camposoberano/evohub-bridge/pull/20), [PR #21](https://github.com/Camposoberano/evohub-bridge/pull/21). |
| 16/10 | Recuperação da entrada Instagram e reparo de contato Chatwoot excluído. | [PR #22](https://github.com/Camposoberano/evohub-bridge/pull/22), [PR #23](https://github.com/Camposoberano/evohub-bridge/pull/23). |

## Incidentes e mudanças recentes

| Data e hora BRT | O que ocorreu | Estado e fonte |
|---|---|---|
| 17/10, 17h50–18h21 | Recuperação de entradas Uazapi atrasadas e registro do deploy. | [PR #24](https://github.com/Camposoberano/evohub-bridge/pull/24), [PR #25](https://github.com/Camposoberano/evohub-bridge/pull/25). |
| 18/10, 17h24–17h25 | Deduplicação de incidentes do 5895 e auditoria diária de mensagens. | [PR #26](https://github.com/Camposoberano/evohub-bridge/pull/26), presente na `main`. |
| 20/10, 22h34–22h35 | Abridor por template, qualificação após vídeo e decisões de reativação registradas. | Commits `36ade17`, `36669d0`, `d307d05` na `main`; documentação do template nesse intervalo. |
| 21/10, 01h52 | Página inicial de monitor da reativação. | Commit [`dccb5ad`](https://github.com/Camposoberano/evohub-bridge/commit/dccb5ad) na `main`. |
| 21/10, 10h31 | Correção da paginação da campanha de botões 5895. | [PR #29](https://github.com/Camposoberano/evohub-bridge/pull/29), presente na `main`. |
| 21/10, 12h29 | Rotação diária de disparos entre 5895, 0595 e 6836. | [PR #30](https://github.com/Camposoberano/evohub-bridge/pull/30) e [especificação](superpowers/specs/2026-10-21-rotacao-campanhas-por-numero-design.md). |
| 21/10, 14h27 | Recuperação de respostas interativas do 0595 via catchup Uazapi. | [PR #31](https://github.com/Camposoberano/evohub-bridge/pull/31), presente na `main`. |
| 21/10, 14h51–14h52 | Correção adicional para `TemplateButtonReplyMessage` e detecção de webhook Uazapi ausente. | [PR #32](https://github.com/Camposoberano/evohub-bridge/pull/32), commit `2ed18ad`; deploy do bridge confirmado concluído às 14h52, `/health` HTTP 200. Após ajuste do webhook 0595, foram observados eventos reais da instância no Hub. |
| 22/10, 00h08 | Preflight transitório deixa de pausar a campanha inteira. | Commit [`92a449f`](https://github.com/Camposoberano/evohub-bridge/commit/92a449f) na `main`; esta linha do tempo não confirma deploy desse commit. |
| 22/10, 00h30–00h38 | Lista por contato em `/reativacao` e paginação correta de `/acompanhamento`. | Commits [`9ef2549`](https://github.com/Camposoberano/evohub-bridge/commit/9ef2549) e [`08c6e5c`](https://github.com/Camposoberano/evohub-bridge/commit/08c6e5c) na `main`; esta linha do tempo não confirma deploy desses commits. |

## Como atualizar esta linha do tempo

Para cada mudança, registre: horário local e UTC, commit/PR, componente, efeito esperado, evidência observada e status de deploy. Não converta “mesclado” em “implantado” sem checar o serviço. Não converta “cliente clicou” em “resposta entregue” sem verificar o recibo do provedor e o estado do fluxo.

Documentos históricos não foram movidos nem apagados. Uma atualização futura pode acrescentar links e rótulos de validade diretamente nos documentos antigos, depois de comparar cada afirmação com o código e com o estado operacional.
