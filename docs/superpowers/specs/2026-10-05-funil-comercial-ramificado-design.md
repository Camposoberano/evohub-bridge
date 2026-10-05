# Funil comercial ramificado — design

## Objetivo

Fazer a conversa comercial avançar conforme a necessidade informada pelo produtor, com menos conteúdo genérico, prova mais pertinente e um caminho claro para solicitar cotação. A proposta vale para WhatsApp, Instagram e Facebook.

## Contexto confirmado

- A auditoria disponível cobre 19/09/2026 a 04/10/2026 BRT. Na amostra de áudio, os argumentos de rebrota, altura e produção apareciam repetidamente; a triagem de intenção foi lexical e não mede conversão validada.
- O funil atual distribui imagens, áudios e vídeos em várias fases. Respostas de preço, plantio, nutrição, vídeo e intenção de compra possuem handlers, mas ainda falta qualificação real por necessidade.
- A taxa de venda não pode ser atribuída com segurança: 2.020 dos 6.400 envios agendados do corte não estavam ligados à mensagem enviada, e os desfechos comerciais registrados não coincidem com o status operacional das conversas.
- A escolha de pacote aprovada é `1 hectare → 4 kg`, `2 hectares → 10 kg` e `4 hectares → 20 kg`. A cotação exata depende do volume e da região.

## Decisão de produto

Ramificar a jornada pela intenção e pela resposta do produtor. Um pedido direto de preço não deve ser atrasado por uma pergunta de qualificação: vai direto ao seletor de área. Uma manifestação geral de interesse começa com uma pergunta neutra sobre o uso pretendido. Cada resposta deve produzir um próximo passo curto e relacionado.

## Jornada proposta

### 1. Entrada e intenção

- Se o contato pedir preço/valor, exibir diretamente as opções de área e volume. Não enviar tabela ou valor absoluto.
- Se demonstrar interesse sem pedir preço, perguntar uma coisa por vez: se pretende usar para silagem, pastejo ou outra finalidade.
- Se trouxer dúvida técnica específica, responder somente quando houver conteúdo aprovado para aquela dúvida; sem resposta técnica validada, encaminhar para atendimento humano.

### 2. Qualificação e pacote

- Depois de conhecer o uso, perguntar a área e a região quando essas informações forem necessárias para escolher material ou cotar.
- Mostrar os botões `1 hectare`, `2 hectares` e `4 hectares`, mapeados respectivamente para 4 kg, 10 kg e 20 kg.
- Para áreas maiores, aceitar a quantidade/área em texto e solicitar cotação humana.

### 3. Prova relevante

- Enviar no máximo uma peça de prova por necessidade identificada, usando mídia ativa e validada no catálogo.
- Associar vídeo ou imagem à dúvida (por exemplo, plantio, uso para silagem ou manejo). Se não houver mídia validada para a resposta, enviar texto breve ou passar ao atendimento.
- Não afirmar que o contato assistiu ao vídeo; não há confirmação confiável de visualização.
- Alegações de produtividade, altura, resistência, rebrota e comparações com milho precisam indicar as condições aplicáveis e ter suporte técnico verificável. Não usar chamadas absolutas como “lavoura forte mesmo no ano mais difícil” sem evidência adequada.

### 4. Cotação e atendimento humano

- Informar que o frete é grátis e que o desconto progressivo pode chegar a 30% em pedidos acima de 100 kg. Não sugerir que os pacotes de 4, 10 ou 20 kg recebem esse desconto máximo.
- Após seleção do pacote, perguntar se o produtor quer solicitar o valor exato. O preço será confirmado pelo Cícero conforme quantidade e região.
- Registrar o pacote escolhido no pedido humano e atribuir a conversa quando o responsável estiver configurado. A mensagem ao cliente deve confirmar apenas o que foi efetivamente registrado/encaminhado.

### 5. Acompanhamento

- Quando não houver resposta, permitir no máximo um acompanhamento curto após a peça enviada, dentro do horário e das proteções existentes.
- Suprimir o acompanhamento se chegou nova mensagem do contato, se já há atendimento humano ativo, ou se a conversa foi encerrada/classificada como não compradora.
- Não retomar uma sequência longa automaticamente após o cliente responder.

## Canais e interfaces

- WhatsApp mantém lista interativa para seleção de área; Instagram usa respostas rápidas; Facebook usa botões de postback, respeitando os limites de cada canal.
- IDs dos botões devem continuar levando ao pacote correto. Títulos antigos já enviados devem continuar reconhecidos durante a transição.
- A cotação e os cliques sociais devem chegar ao handler existente de atendimento e à conversa correta no Chatwoot.

## Medição

Registrar e associar à conversa/funil, usando IDs já disponíveis sempre que possível:

1. intenção de entrada (preço, interesse geral, dúvida técnica);
2. uso, área/pacote e região informados;
3. prova enviada e resposta após a prova;
4. solicitação de cotação, encaminhamento ao humano e primeira resposta humana;
5. desfecho comercial e valor vendido, quando disponível.

Relatórios devem distinguir mensagem automática de resposta humana e desfecho comercial de status operacional da conversa. A implementação deve reduzir a lacuna de associação de mensagens agendadas sem tentar reconstruir entrega física apenas a partir de registros incompletos.

## Segurança e comportamento operacional

- Preservar horário, pausa, rampa e estado das campanhas existentes; esta proposta não reativa a lista 6836 nem altera o ritmo de campanha.
- Preservar deduplicação de saída, proteção contra eco e bloqueio de reenvio em entrega incerta. Resultado incerto requer conciliação antes de nova tentativa.
- Não exibir preço numérico automaticamente nem inserir alegações técnicas não confirmadas.
- Usar apenas mídias ativas e confirmadas na fonte operacional antes de associá-las a uma resposta. O snapshot local das imagens não comprova qual mídia está ativa hoje no servidor.

## Fora de escopo

- Publicar/deployar o novo funil, escrever no banco, religar campanhas ou enviar mensagem a contatos.
- Escolher por conta própria o vídeo principal ou aprovar conteúdo agronômico sem ficha técnica atual.
- Definir faixas de desconto entre 21 kg e 100 kg sem regra comercial confirmada.
- Prometer prazo de retorno do Cícero sem SLA operacional confirmado.

## Validação planejada para a implementação

- Conferir que cada intenção segue a ramificação correta nos três canais e que os três rótulos de área mapeiam aos volumes aprovados.
- Confirmar que pedidos de cotação registram o pacote e chegam à conversa/atendente corretos.
- Confirmar que entrada recente, atendimento humano, pausa, encerramento, horário e resultado de envio incerto bloqueiam o acompanhamento indevido.
- Revisar o texto e a mídia final por alegações, preço, chamada e adequação ao canal antes de qualquer publicação.

## Critérios de aceite

- Pedido de preço abre imediatamente a seleção `1 ha / 4 kg`, `2 ha / 10 kg`, `4 ha / 20 kg`, sem tabela ou preço automático.
- Interesse geral inicia por pergunta neutra, sem presumir cultura, praga ou dificuldade financeira.
- O produtor recebe no máximo uma peça de prova alinhada à necessidade identificada antes do CTA de cotação.
- Dúvidas sem conteúdo aprovado chegam ao atendimento humano sem resposta técnica inventada.
- A cotação registra pacote, área e região disponíveis; frete e limite do desconto são descritos sem sugerir desconto máximo em pacotes pequenos.
- O sistema não envia acompanhamento indevido após resposta, atendimento humano, encerramento, pausa ou fora da janela operacional.
- Métricas separam saída automática, atendimento humano, pedido de cotação e venda, com a lacuna de atribuição visível até que seja corrigida.

## Estado

Desenho aprovado pelo usuário em 05/10/2026. A implementação continua aguardando revisão desta especificação; nenhuma mudança de código ou publicação decorre deste documento.
