# Auditoria de mensageria hibrida e replicacao

Data da auditoria: 11/07/2026; revisao de estado: 12/07/2026  
Escopo: EvoHub Bridge, Chatwoot, Meta WhatsApp Cloud API, Uazapi, Facebook Messenger, Instagram Messaging, funis, midia e operacao na VPS Oracle.

## Parecer executivo

O numero oficial 5895 esta apto para continuar os testes controlados: texto, audio, imagem, mensagens do aparelho, mensagens do cliente, Chatwoot, botoes e entrada automatica por anuncio foram validados. A arquitetura esta protegida para o piloto, mas **ainda nao deve ser duplicada sem a homologacao BSUID e a configuracao por canal**.

Os P0 de seguranca e retry foram corrigidos no deploy `d996471`. Permanecem como gates de escala a homologacao BSUID, a configuracao por canal e a reconciliacao do Instagram, que esta fora do escopo atual. Duplicar sem esses gates copiaria comportamentos nao homologados para cada numero novo.

O PDF `MANUAL WHATS SIMULTANEO V4 (com FAQ).pdf` nao e documentacao oficial da Meta. Ele ensina instalacao de aplicativo WhatsApp modificado e reconhece risco de suspensao temporaria ou definitiva. Portanto, ele pode servir somente como referencia operacional de aparelho; nao pode ser usado como base de conformidade ou garantia contra banimento.

## Arquitetura aprovada

1. A API oficial da Meta permanece como identidade principal do numero, origem de templates, estados de entrega, qualidade e campanhas fora da janela de atendimento.
2. O Uazapi e uma rota complementar de coexistencia para texto e midia quando o mesmo numero esta conectado e explicitamente autorizado.
3. O Chatwoot e a caixa unica por canal. Uma conversa local deve apontar para uma unica conversa Chatwoot ativa por `canal + contato`.
4. O Supabase guarda canais, contatos, conversas, mensagens, eventos, deduplicacao e estado dos funis.
5. O bridge recebe webhooks, reconcilia as identidades, aplica regras, envia mensagens e executa os loops de sincronizacao.
6. Facebook e Instagram usam o mesmo nucleo de contatos/conversas, mas nao usam a regra hibrida do WhatsApp. A entrada depende de webhook e do fallback `sync-facebook`.

## Fronteira do modelo hibrido

- **Sempre oficial:** templates aprovados, campanhas iniciadas pela empresa fora da janela, leitura da qualidade do numero e estados da Meta.
- **Pode usar Uazapi:** texto e midia de atendimento quando houver rota hibrida explicitamente habilitada.
- **Fallback:** se o Uazapi falhar, o bridge tenta a rota oficial; a janela oficial ainda deve ser respeitada.
- **Nunca assumir:** coexistencia nao significa imunidade a bloqueio. Aplicativo modificado, automacao agressiva, conteudo repetitivo e falta de consentimento continuam sendo risco.
- **Opt-in e opt-out:** guardar origem e horario do consentimento; reconhecer pedidos de parada; impedir novo disparo ate novo consentimento valido.

## Mudanca de precos anunciada para 2026

Esta auditoria distingue o regime vigente do regime futuro comunicado oficialmente pela Meta:

- A partir de 1 de agosto de 2026, o Meta Business Agent passa a ser cobrado por tokens, segundo a comunicacao da Meta.
- A partir de 1 de outubro de 2026, a Meta retoma a cobranca por mensagem de servico entregue.
- A partir de 1 de outubro de 2026, mensagens de utilidade enviadas dentro da janela de atendimento tambem voltam a ser cobradas por mensagem.
- A janela de 24 horas continua existindo e reinicia quando o usuario envia uma mensagem; ela define permissao de resposta livre, mas deixa de significar gratuidade depois da mudanca.
- O valor e a categoria devem ser confirmados na tabela oficial aplicavel ao Brasil/BRL no momento do envio.

O modelo hibrido e uma estrategia experimental de custo e continuidade, nao uma autorizacao para burlar cobranca ou politica. Nao ha garantia de que mensagens enviadas pelo aplicativo/coexistencia ficarao permanentemente fora da tarifacao, nem de que automacao nao oficial sera tolerada pela Meta. O sistema deve medir separadamente `via=official` e `via=uazapi`, custo estimado e falhas/bloqueios para permitir desligamento rapido da rota complementar.

Referencias oficiais identificadas nos redirecionamentos do e-mail:

- Meta Business Agent: https://developers.facebook.com/documentation/meta-business-agent/overview
- Precos de mensagens sem template: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages

## Nomes de usuario e BSUID

- Um cliente novo pode chegar pelo webhook com BSUID, sem numero de telefone.
- O BSUID deve ser a identidade externa primaria da conversa; nunca inventar telefone nem fundir contatos apenas por nome.
- O bridge ja aceita identificadores que nao parecem telefone e impede que BSUID/LID seja enviado pelo Uazapi.
- Enquanto houver somente BSUID, a resposta deve seguir pela API oficial.
- Para migrar a conversa para uma rota baseada em telefone, o cliente precisa compartilhar o numero por um mecanismo oficial de solicitacao/consentimento.
- Ao receber o telefone, manter o vinculo `BSUID -> telefone` auditavel e mesclar contatos somente com regra deterministica.
- Antes de duplicar, falta homologar: primeiro contato com BSUID, resposta oficial, botao para solicitar telefone, webhook da resposta, vinculo de identidade e ausencia de conversa duplicada.

## Evidencias funcionais

- O 5895 recebeu e enviou texto, audio e imagem nos tres sentidos testados.
- Cliques de preco, plantio e nutricao sao roteados pelo bridge.
- Audio pode ser transcrito com Gemini antes da classificacao da intencao.
- O funil automatico foi restringido a lead de anuncio, por `referral` da Meta ou saudacao reconhecida de anuncio.
- Variacoes atuais incluem portugues e espanhol, como `Ola! Posso ter mais informacoes sobre isso?` e `Hola! Me gustaria conseguir mas informacion sobre esto.`
- Saudacao generica, como `bom dia`, nao deve iniciar funil.
- O funil manual ignora a faixa de horario para executar imediatamente; os passos posteriores preservam a sequencia configurada.
- Deduplicacao por ID de mensagem/entrega existe para webhooks e fila.

## Achados e prioridade

### P0 - estado atual: resolvidos no piloto

1. **Segredo Uazapi:** redacao recursiva implantada e payloads historicos saneados; contagem observada de eventos com token no topo: zero.
2. **Rota aberta por padrao:** allowlist vazia agora desliga o hibrido. Em producao, `HYBRID_INSTANCE_ALLOWLIST=5895` e o pareamento confirmado com a instancia `5895` conectada.
3. **Retry de midia:** a mensagem de teste `20590` foi movida para `terminal_failed`; o polling ganhou uma claim de retry unico e nao deve repetir a mesma falha indefinidamente.
4. **Diagnostico temporario:** `debug-audio-dup` foi removido do codigo e os eventos historicos foram apagados. Eventos que apareceram imediatamente apos a virada foram tratados como terminacao de tarefas antigas; devem permanecer em zero em novas observacoes.

### P1/P2 - pendentes ou fora do escopo atual

1. **Instagram possui erro recorrente:** permanece fora do escopo WhatsApp e deve ser corrigido na etapa Facebook/Instagram.
2. **Webhook Chatwoot usa segredo na URL:** ainda recomendado migrar para assinatura HMAC em header.
3. **Conversas Chatwoot orfas:** a reconciliacao deve ser generalizada antes de ativar novos canais em escala.
4. **BSUID:** precisa de homologacao de primeiro contato e solicitacao oficial do telefone.

### P1 - corrigir antes de liberar producao em escala

1. **Webhook Chatwoot usa segredo na URL.** `?token=` pode aparecer em proxy, historico e logs. Preferir assinatura HMAC em header; durante transicao, aceitar o token antigo apenas por prazo curto.
2. **Webhooks Uazapi tambem usam segredo na URL.** Aplicar a mesma migracao para header/assinatura e rotacao dos segredos ja expostos.
3. **Instrumentacao temporaria permanece ativa.** Eventos `debug-audio-dup` e logs detalhados de midia devem ser removidos ou protegidos por `DEBUG=false` antes da clonagem.
4. **Referencias Chatwoot orfas.** O loop de janela ainda encontra conversas locais `329` e `330` inexistentes no Chatwoot. Criar reconciliacao que marque a conversa local como resolvida/orfa e pare novas tentativas.
5. **Deduplicacao nao tem politica de retencao.** `deliveries` cresce indefinidamente. Algumas chaves baseadas em conteudo podem impedir para sempre a repeticao legitima de uma mensagem. Definir TTL conforme a classe: webhook por prazo longo; comando interativo e envio por janela limitada.
6. **Retencao de midia nao esta explicitamente configurada.** `MEDIA_RETENTION_ENABLED` e `MEDIA_RETENTION_DAYS` nao apareceram no container. Definir periodo de negocio/LGPD, executar primeiro em modo de relatorio e manter backup.
7. **Health check de Facebook/Instagram e superficial.** Hoje a verificacao detalhada de qualidade/status existe apenas para WhatsApp. Adicionar token, permissao, assinatura webhook, page/IG ID, ultima entrada, ultima saida e idade do ultimo sucesso.

### P2 - melhoria operacional

1. Criar dead-letter queue para mensagens que excederem o limite de tentativas.
2. Medir latencia por etapa: webhook, Chatwoot, classificacao, fila, provedor e confirmacao.
3. Completar metricas de primeira resposta e valor ganho, ainda marcadas como pendentes.
4. Versionar funis e macros. Uma conversa iniciada deve continuar na revisao em que entrou.
5. Criar teste automatizado de contrato para payloads reais de WhatsApp, Uazapi, Facebook e Instagram, sem guardar dados pessoais.

## Auditoria por canal

### WhatsApp oficial

- Webhook publico HTTPS: arquitetura presente.
- Assinatura do webhook EVO Hub: validada no handler.
- Deduplicacao por ID: presente.
- Estados `sent`, `delivered`, `read` e `failed`: tratados.
- Midia recebida: download e armazenamento implementados.
- Entrada Click-to-WhatsApp: campo `referral` tratado.
- Janela de atendimento: 24 horas; o sistema tambem usa 72 horas quando a conversa tem origem de anuncio.
- Fora da janela: usar template aprovado, nao texto livre.
- Pendente: registrar consentimento, opt-out e categoria/finalidade do template de forma auditavel.

### Uazapi / coexistencia

- Descoberta por correspondencia de numero funciona.
- Texto e midia possuem fallback oficial.
- Cliques e audio entram no mesmo roteamento de intencao.
- Pendente obrigatorio: allowlist, redacao de segredos, limite de retry, monitor de conexao e procedimento de desligamento imediato.
- Nao usar o canal nao oficial para burlar template, consentimento ou bloqueio de janela em campanhas.

### Chatwoot

- Uma inbox por canal e o modelo correto.
- Criacao duplicada deve ser bloqueada por identificador externo do canal e do contato.
- Mensagem enviada pelo aparelho deve aparecer como saida na mesma conversa, nunca abrir uma segunda caixa.
- Conversas apagadas no Chatwoot precisam ser reconciliadas no Supabase.
- Pendente: assinatura segura do webhook e limpeza dos registros orfaos existentes.

### Facebook Messenger

- Validar `page_id`, token de pagina, permissoes, webhook de mensagens/echoes e inbox Chatwoot.
- Testar texto, imagem, audio/anexo, eco de mensagem enviada pela pagina e resposta do Chatwoot.
- O fallback por pull funciona, mas nao deve esconder webhook quebrado.
- Comentarios e respostas privadas precisam de fluxo e consentimento separados das mensagens diretas.

### Instagram Messaging

- Validar conta profissional ligada a pagina, `ig_id`, permissoes e assinatura dos eventos.
- Testar DM, resposta a story/mencao quando suportada, midia, eco e Chatwoot.
- Corrigir primeiro o `404` recorrente de `Atendimento IG`.
- Nao duplicar inbox se o mesmo `ig_id` ja existir.

## Regras do funil

1. Entrada automatica somente por evidencia de anuncio: `referral` ou frase de abertura reconhecida.
2. Frases devem ser normalizadas por caixa, acento e pontuacao, mas a correspondencia nao pode aceitar qualquer saudacao generica.
3. O primeiro passo deve ser idempotente por `canal + contato + campanha/anuncio + revisao do funil`.
4. Preco, video e outros ativos marcados como envio unico nao podem ser repetidos automaticamente na mesma jornada.
5. Clique em botao deve responder em segundos. O polling e apenas contingencia, nao caminho principal.
6. Pausar, retomar e parar devem alterar um unico estado atomico e deixar evento de auditoria.
7. Resposta humana ou do cliente deve seguir a politica definida para pausa do funil; nao depender de comportamento implicito.
8. Falha em uma etapa nao pode liberar etapas seguintes fora de ordem.

## Checklist obrigatorio para cada nova instancia

### Antes

- Criar inventario: numero, WABA, phone number ID, nome da instancia, canal, inbox e responsavel.
- Confirmar consentimento e finalidade das mensagens.
- Adicionar canal e instancia nas duas allowlists hibridas.
- Confirmar que nao existe canal/inbox com o mesmo identificador.
- Configurar secrets sem expor valor em URL, print ou log.
- Validar template, idioma e variaveis.
- Registrar revisao do funil que sera usada.

### Teste isolado

- Cliente envia texto, audio e imagem; apenas uma conversa e criada.
- Aparelho envia texto, audio e imagem; tudo aparece como saida na mesma conversa.
- Chatwoot envia texto, audio e imagem; o cliente recebe uma unica vez.
- Botao de preco, outra area, plantio e nutricao responde em menos de 15 segundos.
- Lead de anuncio inicia o funil uma vez.
- Saudacao comum nao inicia o funil.
- Pausar, retomar e parar funcionam.
- Falha Uazapi aciona fallback sem duplicar.
- Fora da janela oficial, texto livre e bloqueado e template aprovado funciona.
- Cliente novo com BSUID abre uma unica conversa e recebe resposta pela rota oficial.
- BSUID nunca e encaminhado ao Uazapi como se fosse telefone.
- Compartilhamento consentido do telefone vincula as identidades sem duplicar contato/conversa.

### Liberacao

- Zero erro recorrente durante 30 minutos.
- Zero conversa duplicada.
- Zero segredo em evento/log.
- Fila sem item preso e sem retry infinito.
- Dashboard mostra canal conectado e ultimo sucesso.
- Plano de rollback testado: retirar allowlist, pausar loops do canal e manter a API oficial.

## Definicao de pronto para duplicar

O sistema pode ser duplicado quando todos os P0 estiverem fechados, os P1 de seguranca/reconciliacao estiverem aplicados e a matriz de teste passar para 5895 por pelo menos 24 horas sem duplicidade, retry infinito, midia perdida ou conversa orfa. Facebook e Instagram devem ter homologacao propria; o sucesso do WhatsApp nao os aprova automaticamente.

## Ordem recomendada de execucao

1. Redigir e limpar segredos dos eventos Uazapi.
2. Ativar allowlists apenas para 5895.
3. Encerrar o retry da midia 20590 e criar limite/dead-letter.
4. Reconciliar conversas Chatwoot orfas e corrigir `Atendimento IG`.
5. Migrar autenticacao de webhook para assinatura em header.
6. Remover debug e configurar retencao.
7. Rodar a matriz completa no 5895 por 24 horas.
8. Criar uma unica instancia piloto adicional e repetir o checklist.
9. So depois expandir para os demais numeros e homologar Facebook/Instagram individualmente.

## Referencias oficiais

- Meta WhatsApp Business Platform - Webhooks: https://www.postman.com/meta/whatsapp-business-platform/folder/lboq68h/webhooks
- Meta WhatsApp Business Platform - Payload de webhook: https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-83ff049c-d89c-4d54-904c-c77964653d6d
- Meta WhatsApp Business Platform - Mensagens: https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-ba8d099d-007e-4b52-b9f2-3cf3c60e4fbc
- Meta WhatsApp Business Platform - Botoes interativos: https://www.postman.com/meta/whatsapp-business-platform/request/ne00kt6/send-reply-button
- Meta - Anuncios Click-to-Message: https://www.facebook.com/business/ads/click-to-message-ads
- Uazapi - Documentacao: https://docs.uazapi.com/
