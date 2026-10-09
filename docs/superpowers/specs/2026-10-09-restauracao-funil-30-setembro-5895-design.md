# Restauração do funil de anúncios 5895 de 30/09/2026

## Decisão e evidência

O usuário aprovou recuperar fielmente o roteiro comercial de 30/09/2026 e substituir os envios futuros da versão curta no WhatsApp oficial 5895. A referência de código é `71f58b9` (fim de 30/09), confirmada contra as 31 linhas da sequência `mega-sorgo` da conversa Chatwoot #3123. Naquele dia, 12 conversas do canal com `origem=anuncio` receberam 31 etapas cada; 370 das 372 linhas dessas conversas ficaram como `sent`, e duas falharam. `sent` registra aceitação do caminho de envio, não confirma entrega ao aparelho.

Em 06/10, `c5a40af` trocou a inscrição de cinco fases pelo roteiro de duas peças. Em 09/10, `2d2e515` substituiu esse roteiro por cinco textos, e `057aced` isolou os textos sob `mega-sorgo-5895-v2`. Por isso o comando manual atual não alcança o roteiro multimídia de 30/09. Em 09/10, 33 conversas abertas desde 06/10 tinham a versão curta `v2` ativa, com etapas futuras pendentes ou pausadas. A #3509 tinha apenas o primeiro texto da `v2` registrado como enviado, com quatro textos pausados depois de uma resposta do cliente.

## Roteiro a recuperar

Criar uma versão nova e identificável para o 5895, preservando `mega-sorgo` e `mega-sorgo-5895-v2` como histórico. A nova versão usa as falas, botões e sequência de 30/09, sem substituir os textos comerciais da época por cópia revisada. Um novo ID elimina a trava de deduplicação das versões antigas. O rótulo operacional identifica claramente a versão de 30/09.

| Fase | Etapas agendadas | Conteúdo |
| --- | ---: | --- |
| 1 | 7 | Saudação; logo; pergunta com imagem e botões; dois áudios; vídeo; lista de opções. |
| 2 | 5 | Produção com imagem e botões; dois áudios; vídeo; lista. |
| 3 | 5 | Rebrota com imagem e botões; dois áudios; vídeo; lista. |
| 4 | 6 | Pragas e seca com imagem e botões; dois áudios; imagem adicional; vídeo; lista. |
| 5 | 8 | Oferta com imagem e botão; dois áudios; textos de logística; arte de logística; imagem de 2 kg; oferta de material digital; lista final. |

Total: 31 etapas agendadas, incluindo dez áudios e quatro vídeos. A `text_sequence` de logística contém três textos dentro de uma etapa. O catálogo ativo não tem vídeo da fase 5; reproduzir a fila de 30/09 significa não acrescentar esse vídeo. Usar os slots de mídia históricos e verificar disponibilidade antes de inscrever. A imagem de 2 kg do exemplo #3123 deixou de estar ativa, então a seleção usa o slot ativo correspondente; registrar a URL selecionada para auditoria. Se faltar uma mídia obrigatória, a inscrição falha de modo visível em vez de criar silenciosamente um funil incompleto.

Os intervalos retomam os valores de 30/09: primeira fase imediata, depois 30 minutos, 6 horas, 12 horas e 12 horas de tempo comercial, contados do fim da fase anterior. Cada peça dentro da fase mantém o deslocamento original de pelo menos 70 segundos. A janela de envio é 06h–22h no horário de Fortaleza, com duração máxima de fase de 560 segundos. Início manual respeita a mesma ordem e os mesmos intervalos entre peças.

## Interação, estado e entrega

Preservar os textos e IDs dos botões `f1_*` a `f5_*`. Implementar resposta para cada ID: registrar a escolha, responder de forma compatível com a pergunta e manter a próxima fase no horário previsto, sem dispará-la em duplicidade. As opções `menu_preco`, `menu_plantio`, `menu_nutricao`, `menu_depoimento`, `menu_humano` e a oferta de material digital continuam usando os handlers existentes. O menu de preço pode responder durante as pausas da apresentação. Pedidos de preço, uso, plantio ou informação não cancelam nem pausam a sequência. Compra concluída, recusa explícita, bot desligado e pausa ou cancelamento manual mantêm seus bloqueios. Pedido de atendimento humano preserva a fila em pausa até retomada deliberada.

O controle manual `iniciar`, `status`, `pausar`, `retomar` e `parar` aponta para a versão nova no 5895. Repetir `iniciar` na mesma conversa não duplica a versão nova; uma sequência antiga ou curta não bloqueia a nova. A fila, a manutenção, a recuperação, as métricas e o rótulo de conclusão reconhecem o novo ID. A versão curta deixa de aceitar novas inscrições no 5895 e suas linhas pendentes ou pausadas são canceladas na migração, preservando as linhas já enviadas como histórico.

Uma falha de mídia ou de provedor deve registrar a etapa, o HTTP, o corpo resumido do erro, a tentativa e o resultado de aceitação, sem marcar `sent` por mera tentativa. Nenhuma falha silenciosa pode concluir a sequência como se todas as peças tivessem saído. Retries automáticos só ocorrem para erro transitório comprovado e com chave idempotente; resultado incerto fica para verificação antes de novo envio. A etapa seguinte aguarda a resolução da falha, preservando a ordem. A existência do arquivo no storage não prova que a Meta aceitará o vídeo: 45 vídeos falharam no recorte operacional de 05–08/10 e o erro do provedor não foi preservado naquele histórico.

## Migração controlada

Após publicar e confirmar `/version` e `/health`, verificar primeiro o envio real do início da versão nova, inclusive a aceitação do primeiro vídeo, em conversa autorizada. Reconciliar o resultado no registro local e no provedor antes de migrar o lote. O lote é o conjunto de conversas de anúncio do 5895 abertas de 06/10 até a publicação que receberam a abertura de duas peças, a versão curta de cinco textos ou não receberam o funil completo. A identificação combina `origem`, `referral`, mensagem inicial de anúncio e registro manual, pois a #3509 tem `origem=null` mesmo tendo sido incluída manualmente. Não reinscrever conversas de 30/09 a 05/10 que já receberam a apresentação completa.

Antes de cada reinscrição: verificar compra, recusa, bloqueio, bot desligado e atendimento humano; cancelar somente as linhas futuras das versões erradas; registrar motivo e versão substituída; criar uma única sequência nova. A #3509 recebe tratamento explícito por sua autorização anterior, considerando o estado atual da conversa e sem reutilizar a pausa da `v2` como prova de entrega da versão nova. A migração deve poder ser retomada sem repetir peças já aceitas. Clientes que receberam uma ou duas peças antigas verão a nova apresentação completa, como solicitado; o relatório operacional deixa clara essa sobreposição.

## Verificação e critérios de aceite

1. Uma inscrição de anúncio no 5895 gera 31 etapas, com tipos, ordem, conteúdo e tempos correspondentes à fila de 30/09; os dez áudios e quatro vídeos são selecionados de slots ativos.
2. Pergunta inicial ou posterior de preço recebe sua resposta específica e mantém o restante da apresentação programado.
3. Todos os botões históricos têm destino funcional, sem duplicar as fases seguintes.
4. O comando manual cria ou consulta a versão nova e informa quantidade realmente enviada, pendente, pausada e falha; não declara entrega ao aparelho sem recibo.
5. A fila curta de cinco textos não produz novos envios no 5895 após a migração; uma segunda execução da migração não duplica inscrições.
6. Uma falha de vídeo deixa causa observável, não gera conclusão falsa e não libera etapas posteriores fora de ordem.
7. A auditoria pós-publicação identifica as conversas migradas e a primeira peça efetivamente aceita de cada uma. O ciclo completo leva aproximadamente dois dias úteis de envio e só é considerado entregue por etapa após evidência do provedor.

Não alterar campanhas de disparo em massa, outros canais ou histórico já enviado. A cópia fiel reintroduz alegações comerciais e agronômicas do roteiro de 30/09 por escolha explícita do usuário; sua veracidade não foi validada nesta auditoria.
