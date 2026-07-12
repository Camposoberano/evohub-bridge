# Historico operacional EvoHub pos-migracao

Ultima revisao: 12/07/2026  
Escopo principal: WhatsApp oficial 5895 + Uazapi em coexistencia.  
Fora do escopo desta fase: Facebook, Instagram e WhatsApp 5895/WhatsApp nao oficial antigo que nao seja o par Uazapi homologado.

Este documento registra o que foi migrado, construido, testado, corrigido, rejeitado e deixado como pendencia. Nao registrar tokens, senhas, chaves privadas ou URLs com segredo neste arquivo.

## Estado atual

- VPS nova Oracle: `136.248.116.231`.
- Sistema operacional: Ubuntu 24.04 com Coolify.
- Aplicacao: `evohub-bridge`.
- Bridge publico: `https://cofre.camposoberano.com.br`.
- Chatwoot: `https://gerenciador.soberano.pro`.
- Supabase/servicos internos: `https://bancortovital.soberano.pro`.
- Canal oficial em teste: `5895`.
- Inbox Chatwoot: `WA Oficial 5895`.
- Instancia Uazapi pareada: `5895`, conectada.
- Ultimo deploy validado: `d996471` (`fix: harden hybrid WhatsApp routing`).
- Health check pos-deploy: HTTP 200 / `ok`.
- Rota hibrida pos-deploy: canal oficial 5895 -> instancia Uazapi 5895.
- Allowlist ativa: `HYBRID_INSTANCE_ALLOWLIST=5895`.
- Nginx local sincronizado com os IPs internos atuais do bridge (8000) e dashboard (3000); o timer `evohub-nginx-upstream.timer` foi ampliado para atualizar os dois.
- Facebook/Instagram: nao devem ser usados como criterio de aprovacao desta fase.

## Linha do tempo

### Migracao de infraestrutura

1. Foi identificada a necessidade de mover o projeto EvoHub/Codify da VPS antiga para a VPS Oracle nova.
2. A VPS nova foi criada e preparada com Ubuntu/Coolify.
3. O acesso inicial por `root` falhou porque a Oracle exigia a chave publica correta; o acesso operacional foi reorganizado pelo usuario `ubuntu` com chave SSH dedicada.
4. Foram validados os servicos da nova VPS: Coolify, Chatwoot, Supabase, n8n, Postgres separado e volumes legados.
5. DNS de painel/cofre foi ajustado para a nova infraestrutura. O apontamento temporario para a VPS antiga foi mantido como referencia durante a observacao.
6. A VPS antiga nao deve ser apagada enquanto a janela de observacao e o inventario de dados nao forem encerrados.

### Descoberta e correcoes do WhatsApp

- `8b48829`: download/descriptografia de midia Uazapi antes do envio ao Chatwoot.
- `6798799`: primeiro auto-enrollment de saudacoes Uazapi; depois restringido porque saudacao generica nao deve iniciar funil.
- `4e43a4e`: entrada automatica de leads de anuncio no funil principal.
- `47ecc77`: classificacao de intencao em audio Uazapi.
- `f0b23f6`: enriquecimento apontado para a instancia ativa `5895`.
- `2039a69`: notas de voz classificadas antes da regra generica de midia.
- `b8a5785`: transcricao Gemini para audios recebidos.
- `a340289`: retry controlado para falhas transitorias da transcricao.
- `c330e40`: roteamento de cliques interativos para preco, plantio e nutricao.
- `61341fd`: cliques processados antes da sincronizacao lenta do Chatwoot.
- `add2fbb`: pedidos repetidos de intencao permitidos com deduplicacao por mensagem.
- `a34ca31`: funil automatico limitado a origem de anuncio/referral.
- `c752d7e`: frases de anuncio em portugues e espanhol, incluindo a variacao espanhola recebida.
- `d996471`: endurecimento final do piloto, redacao de segredos, allowlist fail-closed, remoção de debug e limite de retry.

### Incidentes e o que foi aprendido

1. **Aparelho enviava, Chatwoot recebia, mas Chatwoot nao enviava:** havia problemas combinados de rota, identidade e sincronizacao. Acoes corretivas separaram API oficial, Uazapi e fallback, com deduplicacao atomica.
2. **Mensagens e audios repetidos:** concorrencia entre webhook Chatwoot, polling e echo do aparelho. Foi adotada claim atomica por `cw-out-*`, `wamid` e chaves de clique.
3. **Audio indisponivel no historico:** links antigos de midia expiraram ou foram removidos; o binario nao podia ser recuperado do Chatwoot. A regra nova baixa a midia no recebimento.
4. **Botoes demorados:** o polling atrasava a resposta. O clique passou a ser processado antes da sincronizacao geral.
5. **Funil iniciado por saudacao comum:** corrigido para aceitar somente referral de anuncio ou frases de anuncio reconhecidas.
6. **Midia 20590 em retry:** falha HTTP 403 do canal de teste foi encerrada como `terminal_failed`; o retry automatico agora permite apenas uma tentativa adicional.
7. **Segredo em payload:** eventos Uazapi traziam campos sensiveis. A ingestao agora redige chaves sensiveis e o historico foi saneado.
8. **Instancia nova entrando no hibrido:** allowlist vazia era permissiva. Agora o hibrido desliga sem allowlist e o piloto declara explicitamente `5895`.
9. **Dashboard 404/502 apos redeploy:** o alias `cofre.2` apontava para o painel corretamente, mas o Nginx mantinha o dashboard no IP interno antigo `10.0.2.9`. O upstream foi atualizado para o container novo e o sincronizador passou a cuidar das portas 8000 e 3000.

## O que foi testado com sucesso

- Cliente -> Chatwoot: texto, audio e imagem.
- Aparelho -> Chatwoot: texto, audio e imagem como echo na mesma conversa.
- Chatwoot -> aparelho: texto, audio e imagem.
- Recebimento de audio e transcricao Gemini para intencao de preco/nutricao/plantio.
- Botoes de preco, tamanho/outra area, plantio e nutricao.
- Funil iniciado por lead de anuncio.
- Variacao de abertura em espanhol.
- Pausar, retomar e parar funil durante os testes.
- Limpeza das conversas de teste do inbox 5895.
- Health do bridge e pareamento oficial/Uazapi no deploy final.
- BSUID/LID nao e enviado ao Uazapi como se fosse telefone brasileiro.

## O que nao deve ser considerado pronto

- Homologacao de BSUID do primeiro contato ate o compartilhamento do telefone.
- Botao oficial de solicitacao de telefone e vinculacao `BSUID -> telefone`.
- Migracao de segredo em query string para assinatura HMAC de webhook.
- Configuracao de hibrido por canal no banco/painel, sem depender de redeploy.
- Reconciliacao completa de conversas Chatwoot apagadas externamente.
- Facebook e Instagram.
- Garantia de que coexistencia Uazapi ficara fora de toda cobranca ou de toda politica futura da Meta.

## Regras oficiais que orientam o desenho

### Meta/WhatsApp

- Webhook publico deve ser HTTPS, autenticado e idempotente.
- Mensagens possuem tipos e IDs; o ID da mensagem e a base da deduplicacao.
- Estados de envio, entrega, leitura e falha devem ser registrados.
- Midia recebida deve ser baixada usando a credencial adequada e armazenada com retencao definida.
- Referral de Click-to-WhatsApp identifica entrada de anuncio/free entry point.
- A janela de atendimento continua sendo 24 horas a partir da mensagem do usuario.
- A comunicacao recebida em julho de 2026 anuncia cobranca futura do Meta Business Agent por token a partir de 01/08/2026 e cobranca por mensagens de servico/utilidade a partir de 01/10/2026. Conferir a tarifa BRL vigente antes de precificar campanhas.
- Nome de usuario/BSUID exige identidade sem telefone e fluxo oficial para solicitar o numero quando necessario.

### Uazapi e coexistencia

- Uazapi e rota complementar, nao substituto automatico de conformidade Meta.
- Instancia deve ser conectada, pareada pelo numero e incluida na allowlist.
- Templates, BSUID e destinatarios nao telefonicos seguem pela API oficial.
- Falha Uazapi pode usar fallback oficial somente quando a janela/categoria oficial permitir.
- Toda falha de provedor precisa terminar em estado observavel, sem polling infinito.

### PDF Whats Simultaneo

O PDF local `MANUAL WHATS SIMULTANEO V4 (com FAQ).pdf` foi analisado. Ele descreve aplicativo WhatsApp modificado instalado por assinatura externa e reconhece risco de banimento. Nao e documento normativo da Meta, nao autoriza automacao e nao deve ser usado como garantia comercial.

## Configuracao segura

Variaveis relevantes, sem valores secretos:

```env
HYBRID_INSTANCE_ALLOWLIST=5895
HYBRID_CHANNEL_ALLOWLIST=
AUTO_LOOPS_ENABLED=true
SYNC_OUT_ENABLED=true
MEDIA_RETENTION_ENABLED=false
MEDIA_RETENTION_DAYS=365
```

Nao versionar `OPENAI_API_KEY`, `GEMINI_API_KEY`, tokens Meta, tokens Uazapi, tokens Chatwoot ou chave SSH. Qualquer token que apareceu em chat, print, URL ou payload deve ser rotacionado.

## Procedimento de retomada

1. Ler este documento e `auditoria-mensageria-hibrida-e-replicacao.md`.
2. Confirmar branch/commit implantado e health do bridge.
3. Verificar que existe apenas uma inbox para o canal e uma conversa aberta por canal/contato.
4. Consultar `/hybrid-routes` e confirmar o pareamento esperado.
5. Conferir logs dos loops por pelo menos dois ciclos.
6. Executar teste curto de texto, audio, imagem e botao.
7. Fazer teste de entrada por anuncio e confirmar uma unica matricula no funil.
8. Conferir eventos de falha, duplicacao, segredo e retry.
9. So depois ativar uma nova instancia, uma por vez.

## Rollback

Em suspeita de bloqueio, duplicacao ou falha de entrega:

1. Remover o numero da `HYBRID_INSTANCE_ALLOWLIST` ou deixar a lista vazia.
2. Fazer redeploy; o envio passa a usar somente a rota oficial quando permitido.
3. Pausar o funil e a fila do canal afetado.
4. Preservar eventos, IDs e horario; nao apagar evidencias antes da analise.
5. Rotacionar tokens se houver exposicao.
6. Reabrir o hibrido somente apos teste isolado e registro do incidente.

## Referencias oficiais

- WhatsApp Business Platform pricing: https://whatsappbusiness.com/products/platform-pricing/
- Meta Business Agent: https://developers.facebook.com/documentation/meta-business-agent/overview
- Precos de mensagens sem template: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages
- Meta WhatsApp Webhooks: https://www.postman.com/meta/whatsapp-business-platform/folder/lboq68h/webhooks
- Meta payloads de webhook: https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-83ff049c-d89c-4d54-904c-c77964653d6d
- Meta mensagens: https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-ba8d099d-007e-4b52-b9f2-3cf3c60e4fbc
- Meta botoes interativos: https://www.postman.com/meta/whatsapp-business-platform/request/ne00kt6/send-reply-button
- Meta anuncios Click-to-WhatsApp: https://www.facebook.com/business/ads/click-to-message-ads
- Uazapi: https://docs.uazapi.com/

## Proximo marco

O proximo marco nao e duplicar cinco numeros de uma vez. E homologar BSUID no 5895, criar a configuracao hibrida por canal no banco/painel, observar o piloto por 24 horas sem duplicacao/retry infinito e entao ativar somente um numero piloto adicional. Os demais seguem a mesma matriz, um por vez.
