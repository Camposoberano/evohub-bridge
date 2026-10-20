# Entrada de leads de anúncios no funil — design

## Objetivo

Fazer cada conversa identificada como originada de anúncio entrar uma única vez no funil comercial, mesmo quando a primeira mensagem usa uma pergunta ou frase diferente do texto pré-configurado. A pergunta inicial do produtor deve continuar sendo tratada, sem competir com uma saudação ou menu genérico duplicado.

## Contexto confirmado

- Na auditoria de 05 e 06/10/2026, foram encontradas 58 conversas abertas; 30 tinham `origem=anuncio` (14 no dia 5 e 16 no dia 6). As primeiras mensagens variaram entre preço, custo por hectare, entrega, quantidade por pacote, interesse e outras perguntas.
- As 30 conversas marcadas como anúncio tinham uma sequência comercial e ao menos uma mensagem de saída do funil. Portanto, essa amostra não comprova que todas as entradas de anúncio ficaram sem inscrição; o problema observado inclui abertura inadequada ou duplicada e perguntas iniciais sem resposta.
- Na conversa 3461, “Você entrega em todo Brasil?” recebeu saudação e menu genéricos, repetidos, sem resposta à pergunta de entrega.
- No recorte dessas conversas, 478 mensagens agendadas tinham os estados `sent=310`, `pending=98`, `failed=37` e `cancelled=33`. Os itens pendentes ainda não estavam vencidos no momento da consulta. Das 37 falhas, 36 eram vídeos e uma era uma lista. A correção da inscrição não deve ser tratada como correção dessas falhas de entrega.
- No fluxo atual, `uazapi-webhook` chama `autoEnrollFunil` antes de `handleUazapiIntent`. Em `autoEnrollFunil`, a classificação de intenção comercial retorna antes de verificar `fromAd` ou a mensagem padrão de anúncio. Assim, um pedido classificado como comercial pode impedir a inscrição mesmo quando existe um sinal de anúncio.
- A inscrição atual consulta a sequência existente antes de chamar o endpoint do funil. O comportamento precisa continuar idempotente também quando webhooks repetidos ou simultâneos processam a mesma conversa.

## Decisão de produto

O sinal confiável de origem do anúncio tem precedência sobre a classificação textual para decidir a inscrição. Ele não substitui a resposta à intenção do produtor. A inscrição e o tratamento da pergunta inicial devem cooperar para que exista uma única abertura relevante.

## Comportamento proposto

### 1. Determinar a origem

- Considerar evidência autoritativa de anúncio o `referral` da Meta recebido no webhook ou a origem persistida da conversa como `origem=anuncio`.
- Se houver evidência autoritativa, inscrever a conversa independentemente da frase, da intenção classificada ou de o texto coincidir com a mensagem padrão do anúncio.
- Se não houver metadados de origem, manter os reconhecedores de texto existentes somente como fallback nos canais e condições já delimitados. Não converter toda pergunta comercial em evidência de anúncio.
- Guardar o sinal de origem e o motivo da decisão para permitir distinguir inscrição por metadado, fallback textual, duplicidade e bloqueio operacional.

### 2. Inscrever uma vez

- Inscrever no máximo uma sequência `mega-sorgo` por conversa ativa, mesmo com reentrega ou processamento concorrente do mesmo webhook.
- Reutilizar as proteções atuais contra contato bloqueado ou excluído da automação.
- Não usar o modo `force` no fluxo automático nem limpar uma sequência ou fila já existente.
- Se a inscrição falhar, registrar o erro e permitir recuperação idempotente. Não relatar sucesso ao cliente com base apenas na tentativa de inscrição.

### 3. Tratar a primeira mensagem sem duplicidade

- Executar o roteamento da intenção explícita mesmo quando a conversa também for elegível para o funil.
- Para uma pergunta com resposta automática existente, enviar essa resposta como abertura e suprimir a saudação/menu genérico que repetiria a abertura. A sequência continua inscrita para os próximos passos compatíveis com as proteções de resposta, pausa, horário e atendimento humano.
- Para uma mensagem sem intenção específica, usar a abertura normal do funil uma única vez.
- Para uma pergunta sem resposta automática aprovada, preservar o encaminhamento humano/fallback existente e não substituí-lo por uma abertura genérica que deixe a pergunta sem tratamento.
- Registrar qual caminho produziu a primeira resposta, para diagnosticar duplicações e perguntas sem resposta.

### 4. Recuperação e operação

- A rotina de recuperação pode inscrever conversas recentes sem sequência quando a conversa persistida tem `origem=anuncio`, respeitando bloqueios, estado da conversa e idempotência.
- Não reenviar em massa mensagens antigas nem reiniciar sequências já existentes como parte desta mudança.
- Separar nos registros e relatórios: conversa elegível, sequência criada, sequência já existente, bloqueio, erro de inscrição, abertura enviada e falha de entrega de etapa agendada.
- Falhas de vídeo/lista e estado de mídia permanecem visíveis como problema operacional separado; esta especificação não altera mídia, conteúdo ou retentativas de entrega.

## Fora de escopo

- Reinscrever ou reenviar mensagens para a base histórica de 500 contatos sem auditoria e autorização operacional específica.
- Alterar conteúdo, preço, imagens, vídeos, horários ou etapas do funil.
- Mudar a regra que distingue leads orgânicos de leads de anúncio quando os metadados estão ausentes.
- Publicar ou fazer deploy da mudança, ou escrever dados de produção.

## Verificação planejada para a implementação

- Sinal `fromAd`/referral com mensagem classificada como preço, entrega ou outra intenção comercial cria uma sequência e ainda encaminha a intenção.
- Origem persistida `anuncio` permite inscrição pela recuperação mesmo sem nova mensagem padrão.
- Reentrega do mesmo evento e eventos concorrentes não criam duas sequências nem duas filas iniciais.
- Uma pergunta respondida diretamente não recebe também saudação/menu genérico; mensagem sem intenção específica ainda recebe a abertura normal do funil uma única vez.
- Pergunta sem resposta automática continua no fallback/atendimento humano existente.
- Lead sem metadado de anúncio não entra no funil apenas por fazer uma pergunta comercial; o fallback textual continua limitado aos canais e critérios configurados.
- Contatos bloqueados, sequência existente, erro de inscrição e falha de entrega mantêm seus resultados distinguíveis nos registros.

## Critérios de aceite

- Toda conversa ativa com origem autoritativa de anúncio é elegível para uma única sequência, independentemente do texto inicial.
- Uma resposta específica à primeira pergunta não é duplicada por saudação ou menu genérico do funil.
- Respostas posteriores, pausa, horário, encerramento, atendimento humano e bloqueios continuam respeitados.
- O sistema permite identificar por registro por que uma conversa foi inscrita, ignorada, bloqueada ou falhou.
- Nenhuma conversa histórica recebe mensagem como consequência automática desta correção.

## Estado

O usuário aprovou a regra de precedência da origem de anúncio e a abertura sem duplicidade em 07/10/2026. Esta especificação aguarda revisão do usuário antes da implementação. Nenhum código, dado de produção ou envio foi alterado como parte deste documento.
