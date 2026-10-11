# Abertura imediata e preço editável no n8n — 5895

Data: 11/10/2026. Aprovado em conversa por Cícero: envio imediato da primeira peça pelo n8n e menu de preços de 2, 4, 10 e 20 kg com os valores confirmados. Este desenho complementa `2026-10-10-acoes-funil-soberano-n8n-design.md`.

## Objetivo e limites

O lead de anúncio do WhatsApp 5895 deve receber a abertura do funil restaurado com meta operacional de até 15 segundos após a entrada ser reconhecida, dentro da janela de envio de 06h a 21h de Fortaleza (corte preventivo às 20h55). O conteúdo continua sendo produzido pelo workflow n8n de cada ação; o bridge conserva identidade da conversa, agenda, bloqueios comerciais, deduplicação e transporte. A janela Meta e o tempo de confirmação do provedor podem impedir a meta; nesses casos registrar o motivo e manter a peça para conciliação, sem afirmar entrega.

O preço deve apresentar uma lista inicial de quatro pacotes com área, volume e valor atual: 2 kg / meio hectare / R$ 179,90; 4 kg / 1 hectare / R$ 341,62; 10 kg / 2 hectares / R$ 764,15; 20 kg / 4 hectares / R$ 1.437,90. Esses valores foram recuperados das saídas reais do 5895 em 30/09 e confirmados como atuais por Cícero em 11/10. Não republicar as datas promocionais de 20/09 ou 05/10, preços anteriores, percentuais de desconto ou promessa de frete grátis: nenhuma dessas condições foi reconfirmada.

## Fluxo de envio imediato

1. A entrada por anúncio e a macro manual chamam o mesmo workflow `Soberano 5895 — Funil completo 30-09` com chave estável por conversa. As demais ações continuam nos próprios workflows.
2. O workflow produz as peças e chama `/n8n-action-enqueue`. O bridge grava o lote inteiro e o ativa antes de responder com o identificador da primeira peça elegível e seu horário. Respostas de duplicata não habilitam novo disparo.
3. Um novo passo no workflow chama um endpoint interno de envio imediato com esse identificador e o segredo já usado na integração n8n. O endpoint busca a peça persistida, verifica canal 5895, vínculo com a solicitação, status pendente, vencimento, horário, janela Meta, bloqueios e estado da conversa. Usa a mesma proteção de envio por `scheduled_message_id` que a fila usa e só marca `sent` após confirmação do serviço de envio.
4. O cron n8n de um minuto permanece como recuperação das peças vencidas que o passo imediato não confirmou e como consumidor das demais peças do funil. Uma tentativa concorrente encontra a peça já enviada ou o claim em andamento e não cria segunda mensagem. As pausas de 70 segundos e as fases seguintes permanecem.
5. Registrar horário de entrada, aceite no n8n, início da tentativa, `sent` e motivo de bloqueio/falha. O relatório operacional mede a abertura em até 15 segundos e separa peças aceitas, enviadas e incertas.

O mesmo caminho imediato atende a primeira peça da ação de preço e das seleções de pacote quando cabível. Ele não antecipa uma peça agendada para uma pausa posterior e não força envio fora do horário permitido.

## Preço e botões

O workflow `Soberano 5895 — Preço` passa a começar com uma lista `Escolher pacote` de quatro linhas (`tam_2kg`, `tam_4kg`, `tam_10kg`, `tam_20kg`). Cada linha mostra área, quilos e valor confirmado. A escolha gera uma peça interativa com a arte do pacote como cabeçalho, valor no texto e dois botões: `Pedir cotação` e `Outro pacote`. A seleção de cotação conserva o registro no bridge e informa se ele foi confirmado; `Outro pacote` retorna à lista. O menu de pagamento existente (PIX, cartão, boleto) permanece acessível pela ação apropriada. Áreas maiores recebem pedido de área e município/UF para cotação individual.

As artes de 4, 10 e 20 kg já estão nos slots ativos. O slot ativo `preco_2kg` aponta para `v2-teste-meio-hectare-2kg.jpg`, que contém o aviso visual “OPÇÃO TESTE”; não pode ser enviado ao cliente. Substituí-lo por uma versão final com o mesmo volume/área, sem faixa de teste e sem preço impresso, mantendo o valor editável no n8n. Conferir visualmente a nova arte e o slot antes de ativar a linha de 2 kg. Caso falhe a publicação da arte, manter a escolha de 2 kg indisponível e preservar o preço em texto para atendimento humano até a mídia ser corrigida.

## Erros, publicação e verificação

- Falha do webhook n8n, do banco ou do provedor não dispara conteúdo local alternativo. A tentativa fica rastreável para retentativa segura pelo cron/watchdog.
- Publicar primeiro bridge e workflow em conjunto, com versão de conteúdo nova para novos acionamentos. Peças já agendadas preservam seu texto e não são alteradas em silêncio.
- Verificar o contrato de idempotência, horários e menus; depois acompanhar um disparo real controlado no 5895 dentro da janela. Medir entrada → `sent` e confirmar no Chatwoot e no aparelho. Se o provedor responder `uncertain`, conciliar antes de reenviar.
- A automação antiga que enviou “Promoção SAFRINHA” na #3527 continua sob investigação fora da fila; localizar e desativar sua origem antes de declarar eliminados todos os envios legados de preço.
