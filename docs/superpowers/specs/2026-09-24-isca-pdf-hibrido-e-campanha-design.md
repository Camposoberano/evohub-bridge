# Correção de PDF híbrido e campanha Embrapa — design

## Objetivo

Garantir que a entrega de PDFs de isca em canais WhatsApp híbridos ocorra uma única vez e preparar a campanha de distribuição do material da Embrapa para 1.253 leads frios do canal 5895, iniciando às 8h BRT de 25/09/2026.

## Escopo

1. Corrigir a isca digital de silagem e os PDFs equivalentes de plantio e nutrição.
2. Preservar o histórico operacional no Chatwoot e impedir que `sync-chatwoot-out` retransmita uma saída já entregue.
3. Criar uma campanha com fluxo de oferta, entrega do PDF e ramificação de recusa.
4. Enfileirar os 1.253 destinatários no canal híbrido 5895 somente após o teste individual no número 5511910363320 comprovar uma única entrega.

## Fora de escopo

- Disparo imediato ou fora da janela de 8h a 20h BRT.
- Alterar a política de bloqueio comercial (`pago`, `não compra`) ou o modo de envio oficial de campanhas existentes.
- Reativar ou recriar o canal removido `david face`.

## Arquitetura

### Entrega de documentos

As sequências de isca, plantio e nutrição passarão por uma rotina compartilhada de entrega de documento.

- Quando `getHybridRoute` encontrar uma rota válida e o destinatário passar por `isHybridRecipient`, o documento será enviado pela UAZAPI com `hybridSendMedia`.
- A rota híbrida será tratada como entrega exclusiva: falha explícita é registrada e devolvida ao chamador; ela não dispara um envio oficial concorrente que possa duplicar o documento.
- Sem rota híbrida válida, a rotina mantém o envio oficial com `sendMeta`.
- Após uma entrega aceita, o histórico será gravado pelo caminho de registro já usado pelo motor de fluxos, que cria a mensagem no Chatwoot e associa seu `chatwoot_message_id` à linha em `messages`.

Isso elimina a causa observada: o PDF oficial gerava uma saída/eco no Chatwoot sem par durável e o sincronizador a enviava novamente pela UAZAPI.

### Campanha Embrapa

A campanha será persistida em `soberano-config/campaigns.json` e consumida pelo loop de `campaign_queue`.

- Identificador determinístico e nome explícito para auditoria.
- Canal: 5895 híbrido.
- Ritmo: `capInicial: 50`, `capIncremento: 5`, `capMaximo: 1253`, `horaInicio: 8`, `horaFim: 20`.
- Fluxo: botão de oferta com imagem; `quero` entrega documento e registra `interesse-silagem`; `nao` envia agradecimento; ambos encerram.
- A fila receberá exatamente os telefones normalizados da lista `5895-sul-sudeste-1253.csv`, removendo repetidos. O loop já consulta `bloqueioPorContato` e respeita pausas manuais antes de cada envio.

### Etiqueta de interesse

O modelo de fluxo ganhará uma declaração opcional de etiquetas de saída, aplicada pelo orquestrador com acesso à conversa depois que o ramo correspondente for realmente entregue. Para esta campanha, somente o ramo `quero` aplica `interesse-silagem`; o ramo de recusa não adiciona etiqueta.

## Segurança e comportamento em falhas

- A fila não envia nada antes das 8h BRT, mesmo que seja enfileirada de madrugada.
- Um contato bloqueado, com bot pausado ou já marcado como pago/não compra é marcado como pulado, sem envio.
- Cada item tem no máximo três tentativas; falhas ficam auditáveis em `campaign_queue.last_error`.
- Nenhum lote é enfileirado antes de o teste no 3320 e a consulta a `messages` confirmarem um único documento.
- Segredos permanecem somente em `.env` e no armazenamento protegido; nenhum será registrado em código, documentação, saída de teste ou commit.

## Validação

1. Testes unitários para seleção de rota, retorno de erro híbrido sem fallback concorrente, correlação com Chatwoot e etiqueta no ramo `quero`.
2. `deno check --node-modules-dir=none` nos arquivos modificados e execução da suíte de `bridge/tests/`.
3. Deploy identificado por novo `build` em `bridge/server.ts` e confirmação no endpoint `/version`.
4. Oferta de teste ao 5511910363320 pelo 5895; após o clique, conferir uma única mensagem `document` em `messages` e ausência de retransmissão atrasada.
5. Validar a lista: 1.253 telefones únicos, configuração de ritmo correta e resumo inicial da fila com 1.253 pendentes antes de 8h BRT.

## Critérios de aceite

- O teste do 3320 recebe um único PDF rapidamente após clicar em “Quero o material”.
- Plantio e nutrição usam a mesma decisão de rota de documento.
- A campanha permanece inativa até a janela de 8h BRT e, então, libera no máximo 50 contatos no primeiro dia, distribuídos pela janela de 12 horas.
- O clique positivo da campanha aplica `interesse-silagem` à conversa correta.
