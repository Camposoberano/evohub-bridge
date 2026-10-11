# Funis comerciais do Soberano no Instagram e Facebook

- Data: 11/10/2026
- Projeto: Hub Soberano
- Canais incluídos: Facebook `campo soberano` e `Mega Sorgo Santa Elisa`; Instagram `Atendimento IG` e `sorgo brasileiro`.
- Canal excluído: Instagram `david inst`.

## Objetivo e limite

Disponibilizar as 14 ações comerciais já organizadas no n8n aos quatro canais sociais aprovados, com o mesmo conteúdo editável em cada workflow de ação. O funil principal para novos leads elegíveis terá as 31 peças fiéis a 30/09 em cinco fases. A versão do WhatsApp 5895 continuará identificada como `mega-sorgo-5895-20260930`; a versão social terá uma identidade própria. A migração não fará disparo retroativo para conversas antigas.

O registro `sent` comprova aceitação positiva do emissor, não entrega ao aparelho. Recibos de entrega e leitura, quando disponíveis, serão exibidos separadamente.

## Situação verificada

- Os 14 workflows ativos têm nome e webhook do 5895. O consumidor n8n consulta somente `funnel=mega-sorgo-5895-20260930`.
- `autoEnrollFunil` retorna antes de examinar uma abertura Instagram/Facebook porque exige `canalAlvoFunil(channel, "5895")`. O código de detecção de abertura social abaixo desse retorno não é alcançado nesses canais.
- O endpoint que recebe lotes do n8n também rejeita canais diferentes do 5895 e aceita apenas a versão do funil 5895.
- Instagram e Facebook ainda têm sequências `mega-sorgo` executadas pelo bridge. Essa identidade é legada. Em sete dias, as conversas Facebook #3401 e #3376 tinham peças pausadas; #3401 também tinha dois envios falhados antigos. As conversas Instagram #3520 e #3522 receberam respostas comerciais, mas nenhuma sequência principal. Suas primeiras mensagens eram anexos, seguidos de pedidos comerciais; a primeira mensagem sozinha não bastou para identificá-las.
- O bridge aplica janela de envio aos canais sociais. Se uma fase vencer depois do fechamento, ela precisa esperar uma nova mensagem do cliente. A janela conservadora para sinais sociais sem referência explícita da Meta é de 24 horas.

## Alternativas

1. **Compartilhar um workflow n8n por ação entre os canais, com identidade social e adaptador de envio por plataforma — escolhido.** Uma edição de preço ou roteiro tem um único lugar. O bridge valida o canal e controla estado, ordem, janela e idempotência.
2. Duplicar as 14 ações por plataforma. Isola alterações, mas cria conteúdo divergente e exige editar preço e texto em vários workflows.
3. Manter o funil social no bridge e usar n8n só como acionador. Preserva a dificuldade de corrigir conteúdo e não atende ao objetivo de operar as ações no n8n.

## Entrada e identidade

Uma lista explícita de IDs dos quatro canais comerciais autoriza ações sociais; nome serve apenas para exibição. `david inst` fica fora da lista. A validação acontece tanto no webhook do bridge quanto no lote recebido do n8n. Identidades de sequência social e 5895 são distintas e aparecem claramente no painel, nas notas internas e nos eventos. A identidade legada `mega-sorgo` continua consultável, sem iniciar novos envios automáticos nesses quatro canais após a troca.

Uma referência de anúncio recebida da Meta é evidência suficiente para inscrever um novo lead, independentemente do texto ou tipo da mensagem. Quando a referência não chegar, a primeira pergunta comercial significativa de uma conversa nova pode iniciar o funil. Um anexo inicial pode ser seguido dessa pergunta: aceitar no máximo as três primeiras entradas dentro de cinco minutos da abertura, sem classificar anexo isolado como anúncio. Esse fallback não cria uma referência Meta fictícia nem amplia a janela oficial. A mesma conversa e o mesmo comando mantêm chaves idempotentes; anúncio, macro e repetição de webhook não podem duplicar a sequência.

Conversas antigas, concluídas, pausadas, canceladas ou com sequência legada não entram automaticamente na versão social. Qualquer recuperação dessas conversas exige seleção e verificação individual, preservando o histórico.

## Conteúdo e envio

Os 14 workflows existentes passam a aceitar contexto validado de canal e versão, mantendo um workflow por ação: funil completo, preço, vídeo, plantio, nutrição, quatro recuperações, catálogo, retorno, pausa, retomada e parada. Os webhooks atuais do 5895 permanecem funcionais durante a migração; os novos acionamentos sociais usam o mesmo conteúdo do workflow da ação. Mudanças de conteúdo afetam apenas inscrições futuras e deixam a versão aplicada rastreável.

O preço apresenta os valores aprovados: 2 kg R$ 179,90; 4 kg R$ 341,62; 10 kg R$ 764,15; 20 kg R$ 1.437,90. As escolhas usam respostas rápidas ou botões compatíveis com cada plataforma, sem promoções vencidas. Um pedido de preço entra no próximo intervalo permitido e não encerra o funil principal.

O adaptador social existente transforma imagens, vídeos, áudios, botões e listas em mensagens aceitas por Instagram ou Facebook. Antes da publicação, cada mídia e conversão de áudio é conferida. Uma lista que exige mais de uma chamada ao provedor registra aceitação por parte; resultado parcial ou incerto interrompe a continuação automática e não é reenviado sem prova de ausência de entrega.

Uma fila compartilhada e ordenada consome as identidades aprovadas, inclusive ações complementares, sem dois emissores para a mesma peça. O bridge confirma estado e posição anterior antes do envio. Todas as peças respeitam 06h–21h de Fortaleza e os intervalos do roteiro. A abertura de lead elegível dentro da janela de operação busca resposta em até 15 segundos; o cron serve para recuperação. Fora do horário, a primeira peça fica para a próxima abertura.

Quando a janela Meta fecha, as peças restantes ficam em `paused` com motivo estruturado `window_closed`, sem tentativa de contornar a restrição. Nova mensagem do cliente reabre a avaliação da janela e reagenda o restante sem encurtar as pausas. O sistema não promete entregar cinco fases se o cliente não voltar a interagir. Pausas por atendimento humano, pagamento, não compra ou comando manual continuam distintas da pausa de janela.

## Observabilidade e segurança

Para cada canal e conversa, painel e eventos mostram: origem detectada ou fallback, ação, versão, primeiro tempo de resposta, quantidade enfileirada/enviada/pausada/falhada, motivo da pausa, resposta do provedor e eventual recibo posterior. Alertas distinguem espera normal de falha acionável. Falhas `uncertain` e resultados parciais nunca viram retentativa automática que possa duplicar mídia.

Os webhooks mantêm autenticação e escopo por canal. Chaves de acesso não ficam em nós de conteúdo nem em cabeçalhos literais do workflow; a leitura da fila usa credencial do n8n. Logs e relatórios não imprimem conteúdo de conversa, telefone, documentos ou tokens.

## Implantação e aceite

1. Salvar o conteúdo atual dos workflows e mapear as quatro identidades de canal, sem tocar em `david inst`.
2. Implementar os guardas de canal, identidade social, detecção de entrada e contrato multicanal do lote. Preparar a fila única e os adaptadores de mídia com workflows em rascunho.
3. Verificar formato, ordem, deduplicação, janela fechada, pausa/retomada, preço e falha parcial com dados simulados, sem enviar a clientes.
4. Fazer um envio real controlado em conversa de teste elegível de cada plataforma antes de liberar a entrada automática daquele canal. Conferir a conversa e a resposta do provedor; não confundir aceitação com entrega ao aparelho.
5. Ativar um canal por vez e acompanhar as primeiras inscrições. O caminho antigo não consome as novas identidades. Não reativar conversas legadas em massa.

Aceite: nos quatro canais aprovados, novas entradas comerciais elegíveis acionam a mesma versão social de 31 peças; as 14 ações são editáveis no n8n e funcionam no canal correto; respostas diretas, como preço, não suprimem o funil; não há duplicata por anúncio/macro; peças fora de horário ou janela permanecem pausadas; falha real e entrega incerta aparecem no painel; o 5895 mantém seu comportamento e `david inst` continua excluído.
