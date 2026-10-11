# Jev na triagem de mensagens do WhatsApp 5895

Data: 11/10/2026  
Projeto: Hub Soberano / evohub-bridge  
Estado: desenho aprovado verbalmente; aguardando revisão deste documento antes da implementação.

## Objetivo

Usar o Jev da TypeSafe uma vez para interpretar cada nova mensagem livre recebida no WhatsApp 5895 e escolher a ação comercial correspondente no n8n. A abertura automática do funil para leads de anúncio continua imediata e independente da resposta do Jev. Botões, macros explícitas, preços, horários de envio e prevenção de duplicidade continuam sob regras determinísticas.

O mesmo Jev pode apoiar análises semânticas feitas neste chat quando houver uma decisão classificatória útil; não substitui inspeção de código, consulta a registros ou verificação de entregas.

## Escopo e limites

- Canal: somente o inbox oficial 5895. Outros números e projetos não entram nesta alteração.
- Entrada elegível: texto livre do cliente e texto de áudio já transcrito, uma avaliação por `message_id`. Mensagens do operador, eventos de sistema, botões com comando exato e macros manuais não precisam de inferência.
- Saída: uma escolha tipada e sua confiança. O bridge produz um código de motivo a partir da escolha e das regras aplicadas; Jev não precisa gerar texto explicativo, não envia mensagens ao cliente nem edita conteúdo dos funis.
- Ações possíveis: preço, vídeo, plantio, nutrição, catálogo, atendimento humano, resposta genérica/nenhuma ação e demais ações comerciais já mapeadas em `n8n-action-contract.ts`. A lista final deve ser fechada no contrato do código, sem aceitar nomes arbitrários vindos do modelo.
- Recuperações programadas e etapas do funil seguem a fila existente. A classificação de uma mensagem não cria nova sequência do funil principal.

## Fluxo proposto

1. Os caminhos de entrada do 5895 (Chatwoot, Uazapi e sincronização de anúncios do Facebook) convergem para uma chave idempotente com origem, canal e ID estável da mensagem. Quando a origem não fornece ID, o adaptador deve produzir uma chave estável antes da triagem, em vez de usar uma chave nova por tentativa.
2. Se a mensagem veio de anúncio, a inscrição no funil principal é enfileirada imediatamente, antes da chamada ao Jev. O primeiro envio mantém o caminho rápido do n8n e a janela diária de 06h a 21h.
3. Regras exatas tratam seleção de botão, comando manual, pedido de humano, comprovante, opt-out e outras condições que exigem decisão determinística. Elas podem impedir ações comerciais inadequadas, sem impedir a inscrição legítima do anúncio.
4. Para texto livre restante, o bridge chama Jev uma vez com um contexto mínimo: mensagem normalizada, origem do anúncio, ação/fase atual, sinal de janela aberta e opções permitidas. Evitar enviar histórico integral ou dados pessoais não necessários.
5. Uma requisição TypeSafe agrupa perguntas de escolha tipada para a ação e, quando necessário, o pacote. O bridge valida a resposta, aplica o limiar de confiança configurado e produz o código de motivo antes de encaminhar a ação ao webhook n8n correspondente.
6. O n8n enfileira a peça da ação na fila única de envio. A fila mantém ordem, horário permitido e controle de duplicidade; uma resposta de preço pode entrar entre as pausas do funil sem cancelá-lo.
7. O bridge registra a decisão e o resultado do despacho com `message_id`, `conversation_id`, modelo, ação, confiança, duração, consumo de tokens disponível e motivo de fallback. Conteúdo completo da mensagem e chaves de acesso não entram no log de decisão.

## Falha, baixa confiança e tempo de resposta

- A chamada ao Jev terá prazo curto e não bloqueará a abertura do funil de anúncio. Um timeout ou erro registra `jev_unavailable` e usa as regras atuais de intenção como fallback para pedidos explícitos de preço, vídeo, plantio e nutrição.
- Uma resposta fora do esquema ou uma ação inexistente registra `invalid_decision`; nenhuma ação n8n é chamada com valor não validado.
- Abaixo do limiar de confiança configurado, a decisão não dispara automaticamente conteúdo potencialmente inadequado. Regras explícitas ainda podem reconhecer o pedido; caso contrário a conversa segue para atendimento humano ou permanece sem ação adicional conforme o estado atual.
- A meta de até 15 segundos para a primeira resposta de um novo lead de anúncio mede o caminho de inscrição e enfileiramento, sem incluir a latência do Jev. A latência de Jev e o tempo até a ação complementar são medidos separadamente.
- Após 21h, decisões podem ser registradas e ações enfileiradas, mas a fila só entrega a partir de 06h, conforme a proteção de horário já aplicada aos fluxos.

## Observabilidade e contagem de uso

Cada mensagem elegível deve produzir no máximo um registro de decisão com estado `succeeded`, `low_confidence`, `timeout`, `failed` ou `skipped`, correlacionado com a tentativa n8n quando existir. Reprocessamentos reutilizam a mesma chave e não cobram nem disparam novamente sem um comando de reprocessamento explícito. O relatório operacional deve permitir responder, por período: mensagens elegíveis, chamadas ao Jev, decisões por ação, falhas, latência, tokens e custo quando o provedor fornecer esses dados, e quantas ações chegaram à fila e ao WhatsApp. Não inferir custo a partir de tokens sem tarifa confirmada.

O código atual já contém um cliente TypeSafe e tabelas `llm_tasks`/`llm_runs`; a implementação deve avaliar reutilizá-los para telemetria, preservando uma chave única por mensagem e consultas simples. A integração de orquestração Sol/Jev existente não é prova de uso efetivo nesta triagem: o levantamento anterior encontrou zero execuções `typesafe_jev` registradas.

## Implantação e retorno

1. Preparar a classificação e os registros em uma mudança isolada, preservando os fluxos de anúncio e preço ativos.
2. Ativar inicialmente apenas para mensagens livres do inbox 5895; conferir decisões e ações na fila antes de ampliar o uso.
3. Manter uma chave de configuração que devolva a triagem às regras atuais caso o provedor ou o contrato de resposta falhe.
4. Não reenviar retroativamente mensagens de clientes ao habilitar Jev. Qualquer recuperação histórica exige seleção e revisão próprias para evitar duplicatas.

## Critérios de aceite

- Novo lead de anúncio recebe inscrição no funil independentemente de sucesso, demora ou falha de Jev.
- Uma mensagem livre elegível aciona no máximo uma chamada Jev e uma ação n8n validada; repetição do webhook não duplica a ação.
- Pedido de preço reconhecido durante o funil gera a ação de preço sem cancelar a sequência principal.
- Seleção de botão e macro explícita seguem as regras exatas existentes.
- Conteúdo não é enviado fora de 06h–21h; uma decisão após 21h fica para a janela seguinte.
- É possível consultar o total real de chamadas Jev, latência, tokens e desfecho por período, inclusive chamadas com falha.
- Desativar a chave de Jev restaura a classificação anterior sem alterar os workflows n8n publicados.
