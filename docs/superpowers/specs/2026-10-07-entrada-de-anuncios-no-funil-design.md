# Entrada de leads de anúncios no funil — design

## Revisão de comportamento aprovada em 08/10/2026

Esta decisão substitui qualquer trecho abaixo que peça para omitir a abertura por causa de uma intenção ou pergunta inicial. Todo contato identificado como lead de anúncio recebe primeiro as duas mensagens do funil principal, qualquer que seja o texto recebido. A intenção inicial fica numa etapa da fila, depois do menu: preço, vídeo, plantio, nutrição ou atendimento só são acionados quando as duas mensagens principais estiverem confirmadas como enviadas. Uma resposta posterior durante a abertura não cancela esse trecho; se ela já acionar diretamente uma rota, a etapa adiada correspondente deve ser cancelada para evitar duplicidade.

A conversa 3485 exemplifica a falha: a pergunta de preço enviou os pacotes, mas nenhuma mensagem principal saiu, e a sequência ficou concluída sem registro de envio. Quando uma nova mensagem chegar a uma conversa com sequência terminal e sem evidência de nenhuma das duas mensagens principais, o sistema pode recriar a abertura uma vez. A correção não faz reenvio histórico em massa.

## Objetivo

Fazer cada conversa identificada como originada de anúncio entrar uma única vez no funil comercial, mesmo quando a primeira mensagem usa uma pergunta ou frase diferente do texto pré-configurado. A pergunta inicial do produtor deve continuar sendo tratada, sem competir com uma saudação ou menu genérico duplicado.

## Contexto confirmado

- Na auditoria de 05 e 06/10/2026, foram encontradas 58 conversas abertas; 30 tinham `origem=anuncio` (14 no dia 5 e 16 no dia 6). As primeiras mensagens variaram entre preço, custo por hectare, entrega, quantidade por pacote, interesse e outras perguntas.
- As 30 conversas marcadas como anúncio tinham uma sequência comercial e ao menos uma mensagem de saída do funil. Portanto, essa amostra não comprova que todas as entradas de anúncio ficaram sem inscrição; o problema observado inclui abertura inadequada ou duplicada e perguntas iniciais sem resposta.
- Na conversa 3461, “Você entrega em todo Brasil?” recebeu saudação e menu genéricos, repetidos, sem resposta à pergunta de entrega.
- No recorte dessas conversas, 478 mensagens agendadas tinham os estados `sent=310`, `pending=98`, `failed=37` e `cancelled=33`. Os itens pendentes ainda não estavam vencidos no momento da consulta. Das 37 falhas, 36 eram vídeos e uma era uma lista. A correção da inscrição não deve ser tratada como correção dessas falhas de entrega.
- No fluxo atual, `uazapi-webhook` chama `autoEnrollFunil` antes de `handleUazapiIntent`. Em `autoEnrollFunil`, a classificação de intenção comercial retorna antes de verificar `fromAd` ou a mensagem padrão de anúncio. Assim, um pedido classificado como comercial pode impedir a inscrição mesmo quando existe um sinal de anúncio.
- As entradas sociais usam `handleMessenger` (webhook do Messenger) e `sync-facebook` (consulta periódica, necessária para Instagram). Nenhum desses caminhos chamava `autoEnrollFunil`, embora a função já tivesse o reconhecedor de abertura comercial social. Respostas sociais de preço/entrega podiam ser enviadas sem criar sequência.
- `ingestInbound` marcava qualquer sequência ativa como `replied` e cancelava a fila antes do roteador aplicar a pausa com prazo. A manutenção também não distinguia pausa temporária de handoff humano sem prazo.
- A inscrição atual consulta a sequência existente antes de chamar o endpoint do funil. O comportamento precisa continuar idempotente também quando webhooks repetidos ou simultâneos processam a mesma conversa.

## Decisão de produto

O sinal confiável de origem do anúncio tem precedência sobre a classificação textual para decidir a inscrição. Ele não substitui a resposta à intenção do produtor. A inscrição e o tratamento da pergunta inicial devem cooperar para que exista uma única abertura relevante.

## Comportamento proposto

### 1. Determinar a origem

- Considerar evidência autoritativa de anúncio o `referral` da Meta recebido no webhook ou a origem persistida da conversa como `origem=anuncio`.
- Se houver evidência autoritativa, inscrever a conversa independentemente da frase, da intenção classificada ou de o texto coincidir com a mensagem padrão do anúncio.
- Aplicar a mesma decisão no webhook Messenger e na consulta social usada pelo Instagram, preservando a idempotência entre os dois caminhos.
- Se não houver metadados de origem, manter os reconhecedores de texto existentes somente como fallback nos canais e condições já delimitados. Não converter toda pergunta comercial em evidência de anúncio.
- Guardar o sinal de origem e o motivo da decisão para permitir distinguir inscrição por metadado, fallback textual, duplicidade e bloqueio operacional.

### 2. Inscrever uma vez

- Inscrever no máximo uma sequência `mega-sorgo` por conversa ativa, mesmo com reentrega ou processamento concorrente do mesmo webhook.
- Reutilizar as proteções atuais contra contato bloqueado ou excluído da automação.
- Não usar o modo `force` no fluxo automático nem limpar uma sequência ou fila já existente.
- Se a inscrição falhar, registrar o erro e permitir recuperação idempotente. Não relatar sucesso ao cliente com base apenas na tentativa de inscrição.

### 3. Tratar a primeira mensagem sem duplicidade

- Executar o roteamento da intenção explícita mesmo quando a conversa também for elegível para o funil.
- Para uma pergunta com resposta automática existente, enviar essa resposta como abertura e suprimir a saudação/menu genérico que repetiria a abertura. Se já houver sequência ativa, pausá-la pelo prazo configurado para dar espaço à resposta e retomá-la automaticamente quando não houver nova atividade. Apenas perguntas encaminhadas a uma pessoa mantêm a sequência pausada sem prazo.
- Respostas do cliente pausam e renovam o prazo de inatividade; não cancelam as etapas futuras. Handoff humano e pausa manual permanecem sem retomada automática.
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
- Abertura comercial social sem referral é reconhecida no primeiro inbound e inscrita pelo caminho Messenger/Instagram que recebeu a mensagem.
- Resposta do cliente renova a pausa temporária; handoff humano não é retomado automaticamente.
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

O usuário aprovou a regra de precedência da origem de anúncio e a abertura sem duplicidade em 07/10/2026. Em 09/10/2026, o escopo de ativação foi limitado a novos leads de anúncio no WhatsApp 5895.

### Resultado da implementação

- A inscrição automática e a recuperação são limitadas ao canal 5895; a recuperação cobre apenas conversas abertas nos últimos 15 minutos e com no máximo uma mensagem inbound.
- Referral/origem persistida prevalecem. Respostas específicas e handoff humano substituem a abertura genérica; perguntas de custo seguem para preço e logística para atendimento humano.
- A implementação foi integrada sobre a `main` atual para preservar as correções recentes de recuperação e entrega.
- No worktree de release: 31 testes focados passaram, sem falhas, e `deno check` passou nos handlers e no servidor.
- Auditoria somente de leitura: serviço HTTP 200, canal 5895 ativo, zero leads de anúncio abertos no recorte dos últimos 15 minutos e 173 mídias ativas em 39 combinações dia/slot. As URLs individuais das mídias e a fila histórica completa não foram verificadas.
- Nenhuma mensagem de teste foi enviada. O commit `d148d10` foi publicado em `main`, implantado pelo Coolify e confirmado em produção: `/health` respondeu HTTP 200 e o processo reiniciou após o deploy. O rótulo explícito em `/version` está sendo publicado para tornar esse release identificável externamente.
