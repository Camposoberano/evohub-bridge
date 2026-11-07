# Mega Sorgo 7 dias — desenho aprovado em 07/11/2026

## Objetivo e limite de ativação

Preparar uma versão nova do funil para os canais WhatsApp 5895 e 6836, com conteúdo dos documentos `21`–`27` de `E:/Projetos_Novos/analise-agro-sorgo`. Os dois canais continuam na versão `mega-sorgo-5895-20260930` até uma ordem posterior de troca. Nenhuma conversa atual é migrada ou reinscrita. Um teste isolado pode usar a versão nova sem alterar o roteamento dos anúncios.

## Arquitetura

Criar o identificador `mega-sorgo-7d-v1` como versão de conteúdo, sem adicionar `funnel_queue` ou `contact_funnel_state`. O bridge usa `scheduled_messages`, `sales_sequences`, `conversations`, a biblioteca `funnel_media` e os claims de envio existentes. O n8n recebe a versão nova em workflows separados e inativos para tráfego comum até a virada; a fila e o provedor resolvem o número pela conversa, não pelo nome da versão. O material novo usa chaves e caminhos de mídia próprios; não sobrescrever arquivos ou registros usados pelo funil vigente.

## Cadência e conteúdo

O dia 1 envia as peças 01–12; o dia 2 envia 13–23 e prova social; o dia 3 envia 24–31 e oferece os cinco vídeos oficiais. O dia 4 não agenda nada. O dia 5 envia PDF Embrapa e lembrete; o dia 6 pergunta sobre dúvidas; o dia 7 faz a última chamada. Cada peça tem posição e intervalo próprios dentro do dia: nunca compartilhar o mesmo `send_at` de todas as peças. A janela de envio é 08:00–20:00 America/Fortaleza, inclusive após reagendamento. A validade da condição é calculada em cinco dias úteis a partir do primeiro contato, separada do número ordinal do dia do funil; o texto de última chamada só afirma vencimento se o prazo calculado for naquele dia. O preço é a escada do documento 20, com valor final e frete grátis.

Os cinco vídeos oficiais só são enfileirados quando o cliente confirmar o convite. A ordem é `VIDEO 01 INICIO 1X1.mp4`, `video 02_HORIZONTAL.mp4`, `video 03_HORIZONTAL.mp4`, `video 04_VERTICAL.mp4`, `video 05_HORIZONTAL.mp4`. Os cinco ganchos das fases são peças distintas. A mídia é cadastrada em storage e em `funnel_media` sob a nova versão, com validação de existência, tipo e acesso antes de habilitar. Em 07/11 o dono autorizou usar as dez gravações existentes mesmo com variações de fala: a peça 15 diz “muito superior” onde o texto diz “bem superior”; a peça 25 foi cortada em 51,15 s para retirar o final incompleto e ainda menciona “subir o preço”. Nenhuma peça que dependa de mídia ausente entra em envio real.

## Travas

Uma sequência pertence à conversa e ao canal. Texto livre, áudio, foto, pedido de preço ou vídeo, compra, CEP/CPF, reclamação ou tomada por atendente pausam os agendados antes de uma nova reserva de envio; clique de botão segue o ramo próprio. Opt-out cancela o restante; pagamento confirmado encerra o aquecimento e libera o pós-venda. Pedido antecipado de preço ou vídeo dispara a ação imediata existente e marca a peça equivalente como concluída **somente após confirmação do provedor**. Falha ou recibo incerto mantém a peça bloqueada para reconciliação, sem duplicar. A retomada após atendimento humano é explícita, pelo ponto restante; nenhuma retomada automática em horário fixo. Revalidar estado, interação recente, janela de horário e claims imediatamente antes de enviar. Chaves idempotentes incluem conversa, versão e peça.

## Preparação, teste e troca

Implementar atrás de seleção explícita da nova versão para contatos de teste, com n8n sem acionamento por anúncios. Validar fila, mídia, botões, preços, cronologia, fins de semana, pausa, opt-out, compra, antecipação, reconciliação e retomada. Executar um ensaio acelerado em conversa de teste e conferir recibos; o teste não habilita campanha em massa. A troca futura exige escolha explícita dos dois canais, confirmação de estoque/condição e mídia completa, mudança de roteamento para novos ingressos somente, verificação de saúde e plano de reversão para a versão anterior. Conversas já iniciadas terminam na versão em que entraram.
