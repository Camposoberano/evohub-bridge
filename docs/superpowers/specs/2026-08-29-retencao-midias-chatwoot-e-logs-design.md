# Retencao de midias do Chatwoot e logs do Supabase

**Data:** 29/08/2026  
**Status:** aprovado para planejamento e implementacao controlada

## Contexto e objetivo

A VPS tem capacidade de disco limitada. A auditoria de 29/08 encontrou dois consumos independentes:

- `chatwoot-media`: aproximadamente 22 GB; videos ocupam cerca de 19 GB.
- `_analytics` do Supabase/Logflare: aproximadamente 66 GB em uma unica tabela de eventos tecnicos.

Dos videos do Chatwoot, cerca de 17 GB pertencem a mensagens de saida da empresa; videos recebidos dos clientes somam aproximadamente 206 MB. Os videos de campanha ja existem em origem controlada e publica no bucket `soberano-out`; as copias no Chatwoot nao sao necessarias para a operacao.

O objetivo e impedir novas copias de campanha, remover com seguranca as copias historicas da empresa e conter o crescimento de logs tecnicos, sem apagar midias de clientes, sem SQL direto no banco de producao e sem interromper atendimento ou campanhas.

## Causa raiz confirmada

1. O bridge envia a campanha ao provedor e registra uma mensagem textual no Chatwoot.
2. O provedor devolve um eco da propria saida com o anexo original.
3. A ingestao trata esse eco como uma nova mensagem de saida e publica o anexo no Chatwoot.
4. O Active Storage grava outra copia no bucket `chatwoot-media`.

Portanto, a correcao preventiva deve reconhecer o eco de uma mensagem ja registrada pelo bridge antes de criar anexo no Chatwoot.

## Escopo aprovado

Incluido:

- videos de saida da empresa em conversas do Chatwoot;
- videos de campanha antigos, independentemente da idade;
- bloqueio de novas duplicacoes do mesmo fluxo;
- relatorio de previa e de execucao por lote;
- diagnostico e plano separado para os logs `_analytics` do Supabase.

Excluido:

- videos, imagens, audios ou documentos enviados por clientes;
- exclusao direta de objetos do bucket `chatwoot-media`;
- SQL direto para alterar mensagens, anexos ou tabelas internas;
- alteracao de funis, canais, campanhas ou dados comerciais;
- desativacao imediata de Analytics/Vector sem validacao explicita do impacto no Studio.

### Adendo: audios repetidos de campanha

A auditoria encontrou 794 mensagens de audio `outgoing` repetidas, equivalentes a cerca de
487 MB. Elas sao mensagens publicas da empresa, sem `source_id`; 793 nao possuem atributos
adicionais e uma possui atributos adicionais, que fica fora de qualquer limpeza.

O Chatwoot historico nao registra um marcador confiavel que diferencie, entre essas mensagens
antigas, um audio automatico de campanha de um audio manual com o mesmo arquivo. A tentativa de
correlacionar os hashes com o bucket `soberano-out` tambem nao foi conclusiva: os dois sistemas
registram copias com hashes diferentes. Portanto, **nao se pode excluir automaticamente esses
audios antigos com seguranca suficiente ainda**.

Para audios, o escopo seguro passa a ser:

- impedir novas copias pelo mesmo mecanismo de eco descrito nesta especificacao;
- registrar daqui em diante a origem `campaign` no evento local antes de publicar no Chatwoot;
- manter os 794 candidatos historicos intactos ate existir um criterio verificavel por campanha
  (por exemplo, lista de IDs gerada no momento do disparo);
- nunca incluir mensagens `incoming`, privadas, com mais de um anexo ou com atributos adicionais.

### Registro do piloto de audio - 29/08/2026

Com autorizacao operacional explicita para tratar os candidatos tecnicos como audio de campanha,
foi executado um unico piloto de 25 mensagens. A selecao preservou a primeira copia de cada
arquivo e incluiu somente mensagens `outgoing`, publicas, de usuario, sem `source_id`, sem
atributos adicionais e com exatamente um anexo.

- 25 mensagens removidas pelo endpoint oficial do Chatwoot;
- 0 falhas; aproximadamente 17,6 MB de anexos removidos;
- Chatwoot, Sidekiq, Postgres e bridge permaneceram saudaveis;
- 769 candidatas tecnicas, aproximadamente 470 MB, permanecem sem alteracao.

Nesta versao do Chatwoot, a API de mensagens exige o `display_id` da conversa, e nao o ID
interno armazenado na tabela. O relatorio tecnico do lote esta protegido na VPS. Nenhum lote
adicional sera executado sem nova autorizacao apos a observacao do piloto.

### Fechamento da limpeza autorizada - 29/08/2026

Depois da homologacao do piloto, a operacao foi concluida em lotes de no maximo 100 mensagens.
Foram removidas 793 copias repetidas, aproximadamente 486 MB de anexos, sempre pelo endpoint
oficial do Chatwoot. Um audio repetido de 256 kB permaneceu preservado por possuir atributos
adicionais e, portanto, estar fora do escopo autorizado.

Um reinicio do bridge interrompeu automaticamente um lote intermediario; a rotina nao continuou
enquanto o novo container nao foi verificado como saudavel. A contagem final do escopo limpo e
zero. Chatwoot, Sidekiq e Postgres permaneceram saudaveis durante toda a operacao.

## Solucao escolhida

### 1. Prevencao no bridge

Antes de `ingestInbound` publicar uma mensagem de saida com anexo no Chatwoot, o bridge deve procurar uma mensagem local ja registrada para o mesmo canal e `meta_message_id`. Quando ela existir como saida do bridge, o eco apenas atualiza metadados necessarios e encerra o processamento. Nenhum arquivo sera reenviado ao Chatwoot.

Mensagens de saida digitadas manualmente no aparelho e sem correspondente local permanecem no comportamento atual. O ajuste tambem deve manter a protecao anti-duplicidade ja existente para texto.

### 2. Limpeza historica pelo contrato oficial do Chatwoot

Criar uma rotina administrativa de previa e execucao que:

1. Lista mensagens candidatas via API autenticada do Chatwoot.
2. Seleciona somente mensagens `outgoing`, publicas, com anexo cujo MIME comeca por `video/`.
3. Exclui a **mensagem e seus anexos** pelo endpoint oficial do Chatwoot. Esse contrato remove o Active Storage associado e evita referencias quebradas no bucket.
4. Registra somente dados tecnicos de auditoria: momento, lote, total de mensagens, bytes estimados, sucesso, falha e motivo. Nomes, telefones, conteudos e URLs de clientes nao entram no log.

Como apagar a mensagem oficial remove tambem seu cartao da conversa, nao sera feita exclusao bruta de objetos no Storage. O registro local do bridge pode continuar como auditoria comercial, sem midia armazenada pelo Chatwoot.

### 3. Execucao em etapas

1. **Previa:** produzir contagem, espaco estimado, distribuicao por canal e lista tecnica interna de candidatos; nao altera dados.
2. **Piloto:** apagar no maximo 25 mensagens candidatas, fora de horario de campanha; conferir saude do Chatwoot, entrega de mensagens e espaco liberado.
3. **Lotes:** executar em blocos pequenos e idempotentes, com pausa automatica ao primeiro erro repetido ou degradacao do Chatwoot.
4. **Fechamento:** emitir relatorio com selecionadas, removidas, ignoradas, falhas, bytes liberados e verificacao de que nenhuma mensagem `incoming` foi atingida.

Cada etapa mutavel exige autorizacao operacional explicita antes de rodar em producao.

## Logs do Supabase

O crescimento de `_analytics` e independente das conversas: a tabela principal de Logflare cresceu de cerca de 55 GB para 66 GB em seis dias. Analytics/Vector e opcional na instalacao self-hosted; banco, Auth, Storage e Realtime continuam funcionando sem ele.

Fase posterior, separada da limpeza de midias:

1. Capturar uma previa do compose e das necessidades reais do Logs Explorer.
2. Escolher explicitamente entre manter logs com retencao externa/observabilidade dedicada ou desativar Analytics/Vector local.
3. Testar a configuracao fora do horario comercial e confirmar que Studio, Storage, Auth, Realtime e Bridge seguem saudaveis.
4. Somente depois definir a remocao controlada do historico antigo conforme o caminho escolhido.

Nao sera executado `DELETE` direto nas tabelas `_analytics`.

## Seguranca e rollback

- A rotina usa token administrativo ja configurado, nunca exposto em codigo, logs ou documentacao.
- O backup validado de 23/08 permanece preservado fora da VPS.
- Nenhuma exclusao ocorre sem modo `confirm` e identificador de lote.
- Falhas isoladas ficam registradas e nao sao repetidas cegamente.
- A prevencao de duplicacao tem feature flag para retorno imediato ao comportamento anterior caso a homologacao detecte perda de mensagens manuais.
- A limpeza historica e irreversivel para os anexos removidos; por isso existe previa, piloto e lote limitado.

## Criterios de aceite

1. Um video de campanha enviado pelo bridge nao cria nova copia em `chatwoot-media` quando chega o eco do provedor.
2. Um video recebido de cliente continua aparecendo e armazenado normalmente.
3. Um video manual de atendente continua sendo entregue e registrado conforme o fluxo atual.
4. A previa nao altera mensagens, anexos ou Storage.
5. O piloto remove somente mensagens de video `outgoing` e o espaco liberado e mensuravel.
6. Chatwoot, bridge, Supabase DB, Storage, Auth, Realtime e campanhas permanecem saudaveis apos cada lote.
7. O relatorio final nao contem dados pessoais ou conteudo de conversas.

## Referencias tecnicas

- Chatwoot API: `DELETE /api/v1/accounts/{account_id}/conversations/{conversation_id}/messages/{message_id}` remove a mensagem e seus anexos.
- Supabase self-hosted: Analytics/Logflare e Vector sao componentes opcionais; a decisao sobre eles sera tratada como mudanca de infraestrutura independente.
