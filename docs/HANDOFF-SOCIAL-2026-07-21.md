# Handoff operacional - Facebook, Instagram e funis

Data de fechamento: 21/07/2026 (America/Fortaleza)

## Ponto estavel em producao

- Aplicacao: `evohub-bridge`
- Dominio: `https://cofre.camposoberano.com.br`
- Healthcheck: `GET /health` retornou `ok`
- Build ativo: `2026-07-21-facebook-list-buttons`
- Ultimo commit publicado: `520f29a`
- Branch de producao: `main`

Este e o ponto de retorno validado ao encerrar a sessao. Nao voltar para builds
anteriores sem uma regressao comprovada.

## Commits desta etapa

1. `86dd67a feat: add social sales contact flow`
   - Resposta inicial para pedidos de informacao em Facebook e Instagram.
   - Cartao comercial com imagem e botao para o WhatsApp do Cicero.
   - Convite para o cliente deixar WhatsApp com DDD.
   - Etiquetas de lead e nota privada no Chatwoot.

2. `c0ac92a feat: complete social technical funnels`
   - Plantio e nutricao adaptados para Facebook e Instagram.
   - PDF entregue por link publico.
   - Menus e respostas para dez temas de plantio e dez de nutricao.
   - Compatibilidade com cliques recebidos por webhook ou como texto pelo sync.
   - Etiquetas `canal-facebook` e `canal-instagram` nos novos leads sociais.

3. `520f29a fix: render Facebook lists as persistent buttons`
   - Facebook deixou de usar quick replies nas listas longas.
   - Dez opcoes sao divididas em quatro blocos de ate tres botoes persistentes.
   - Instagram continua usando quick replies, sem alteracao.
   - WhatsApp oficial e hibrido nao foram alterados.
   - Espelho do Chatwoot ficou resumido, sem a lista longa entre colchetes.

## Estado funcional por canal

### Facebook

- Entrada de mensagens: funcionando.
- Resposta manual pelo Chatwoot: funcionando dentro da janela Meta.
- Pedido de informacao: menu comercial automatico funcionando.
- Preco: funcionando, incluindo area, pagamento e `Quero garantir`.
- Cinco videos: funcionando.
- Cartao de contato do Cicero: imagem, texto e botao funcionando.
- Plantio: explicacao por tema funcionando.
- Lista longa de plantio: botoes persistentes chegaram ao cliente.
- Nutricao: implementada com PDF, dez temas e retorno ao menu.
- Comentarios: integracao existente preservada.

### Instagram

- Entrada por webhook/sincronizador: funcionando.
- Pedido de informacao e contato: implementados.
- Preco e cinco videos: implementados e preservados.
- Plantio e nutricao: implementados com quick replies (maximo usado: 10).
- Cliques que chegam apenas como texto sao reconhecidos pelo sincronizador.
- O sync pode levar ate cerca de 30 segundos para refletir uma resposta.

### WhatsApp

- Nenhuma rota do WhatsApp foi alterada na correcao dos botoes do Facebook.
- Oficial 5895, preco, pagamento, videos e funis permanecem no fluxo anterior.
- A regra de nao repetir conteudo comercial no mesmo dia foi preservada.

## Funil e midias sociais

- A fila `scheduled_messages` continua sendo a fonte de verdade.
- O consumidor `funnel-queue-pump` entrega pelo `send-outbound` conforme o canal.
- Texto, imagem, video, audio, interativo e lista possuem adaptacao social.
- No Facebook, listas viram blocos de botoes persistentes.
- No Instagram, listas viram respostas rapidas.
- Audio social e enviado como anexo reproduzivel pela Meta, nao como bolha PTT.
- Audio nao recebe legenda; textos relacionados permanecem em mensagens separadas.
- A protecao de duplicidade continua compartilhada entre webhook e sync.

## Qualificacao comercial

- `Quero garantir` adiciona:
  - `lead-quente`
  - `qualificado`
  - `fechamento-pendente`
- Pedido direto de contato adiciona:
  - `lead-quente`
  - `pediu-contato`
- Pedido inicial de informacao adiciona:
  - `lead-novo`
  - `pediu-informacao`
- Novos leads sociais recebem tambem `canal-facebook` ou `canal-instagram`.
- Uma nota privada alerta o atendimento quando o lead esta pronto para fechar.

## Homologado pelo usuario nesta sessao

- Mensagem de informacao disparou o menu comercial.
- Botao para chamar o Cicero no WhatsApp funcionou.
- Etiqueta `lead-quente` apareceu na conversa.
- Opcao digitada `A semente` retornou a explicacao correta.
- A primeira lista textual do Facebook nao exibiu botoes e foi rejeitada.
- A correcao por botoes persistentes foi aplicada.
- Usuario confirmou: `agora chegou os botao`.

## Validacao automatizada

- `deno check bridge/server.ts`: aprovado.
- Suite completa: 67 testes aprovados e zero falhas.
- Cobertura relevante:
  - deduplicacao de saida;
  - preco e pagamentos;
  - funil e horarios comerciais;
  - recuperacoes;
  - canais hibridos;
  - comentarios Facebook/Instagram;
  - listas e botoes sociais;
  - reconhecimento de cliques por payload e texto;
  - intencao comercial em portugues e espanhol.

## Retomada recomendada

Executar nesta ordem:

1. Facebook - clicar em um dos novos botoes de plantio.
   - Esperado: explicacao do tema e reapresentacao dos quatro blocos de botoes.

2. Facebook - disparar `Nutrição`.
   - Esperado: link do laudo, botoes persistentes, resposta do tema e novo menu.

3. Instagram - repetir plantio e nutricao.
   - Esperado: quick replies; aceitar espera de ate 30 segundos no sync.

4. Rodar um funil completo de teste em cada canal social.
   - Confirmar ordem de texto, imagem, dois audios, video e menu final.
   - Confirmar que nao houve duplicacao.

5. Fazer a auditoria de etiquetas de origem.
   - Separar claramente Facebook, Instagram, WhatsApp oficial e WhatsApp hibrido.
   - Nao alterar regras de janela durante os testes de conteudo.

## Cuidados para nao regredir

- Nao substituir os botoes persistentes do Facebook por quick replies nas listas longas.
- Nao remover o fallback de reconhecimento por texto do Instagram.
- Nao remover `meta_message_id` nem `chatwoot_message_id` dos registros de saida.
- Nao reduzir as travas compartilhadas de deduplicacao entre webhook e sync.
- Nao misturar a regra diaria de conteudo com a trava curta por clique.
- Nao alterar WhatsApp ao corrigir apresentacao exclusiva de Facebook/Instagram.

## Arquivos locais preservados

Estes arquivos ja estavam modificados ou nao rastreados e nao foram incluidos nos
commits desta etapa:

- `HANDOFF.md`
- `bridge/scripts/check-prod.ts`
- `deno.lock`
- `RELATORIO-CONVERSAS-10-DIAS-2026-07-19.md`
- `tmp_is0_postgres.sql`
- `tmp_qu18_postgres.sql`

Nenhuma credencial, token ou chave foi registrada neste documento.
