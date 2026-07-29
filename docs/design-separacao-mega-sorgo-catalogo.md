# Separacao entre o funil Mega Sorgo e o catalogo geral

Data: 2026-07-29

## Objetivo

Impedir que a jornada comercial do Mega Sorgo envie conteudo do catalogo geral e
que o catalogo envie preco, plantio, nutricao ou midias do Mega Sorgo.

No primeiro momento, Mega Sorgo continua sendo a jornada padrao. O catalogo de
mais de 60 produtos somente pode ser iniciado manualmente por um atendente.

## Problema confirmado

Atualmente uma mensagem recebida pode passar por dois roteadores:

1. o autoenrolamento do funil Mega Sorgo;
2. a deteccao de intencao do catalogo.

O detector do catalogo aceita palavras amplas como "produto", "sementes" e
"quero comprar". Essas palavras tambem aparecem naturalmente em conversas sobre
Mega Sorgo. Alem disso, o catalogo pausa a mesma sequencia comercial usada pelo
funil. O resultado e uma conversa com estado e conteudos misturados.

## Regra de negocio aprovada

- Toda conversa comeca no contexto `mega_sorgo`.
- O catalogo nao abre automaticamente por texto livre.
- O catalogo abre pelo macro manual `Abrir Catalogo`.
- Ao selecionar um produto, esse produto passa a ser o contexto comercial da
  conversa.
- Dentro do catalogo, "preco" sempre significa o preco do produto selecionado.
- Sem produto selecionado, o sistema pede a selecao do produto e nao usa o preco
  do Mega Sorgo como alternativa.
- O atendente ou o cliente pode encerrar o catalogo por `Voltar ao Mega Sorgo`.
- Enquanto o catalogo estiver ativo, o funil Mega Sorgo fica pausado.
- Encerrar o catalogo nao deve duplicar nem reiniciar automaticamente o funil.

## Estado da conversa

O estado deve ser explicito e persistido por conversa:

- `journey`: `mega_sorgo` ou `catalogo`;
- `selected_product_id`: produto atual do catalogo ou `null`;
- `level`: nivel atual da navegacao;
- `updated_at`: ultima alteracao de contexto.

O estado existente em `catalog_nav_state` pode ser ampliado para guardar
`journey`. Alternativamente, `journey` pode ficar em uma tabela propria de
contexto. A implementacao deve evitar duas fontes de verdade.

## Prioridade do roteamento

Cada mensagem recebida deve ser consumida por no maximo um dominio:

1. respostas de uma qualificacao ativa do catalogo;
2. cliques explicitos do catalogo (`grp_*`, `cat_*`, `prod_*`, `acao_*`,
   `pg_*`, `quali_obj_*`);
3. conversa no contexto `catalogo`;
4. cliques e respostas explicitas do Mega Sorgo (`menu_*`, `preco_*`, `tam_*`,
   `pag_*`, `plantio_*`, `nutricao_*`);
5. intencoes de texto do Mega Sorgo;
6. autoenrolamento do funil Mega Sorgo quando elegivel.

Quando uma etapa consumir a mensagem, as seguintes nao podem executar.

## Macros e controles

### Abrir Catalogo

- pausa o funil Mega Sorgo com motivo `catalogo_manual`;
- define `journey = catalogo`;
- limpa qualquer produto selecionado anteriormente;
- envia a raiz do catalogo;
- registra nota privada com atendente, data e canal.

### Voltar ao Mega Sorgo

- encerra qualificacao incompleta do catalogo de forma controlada;
- define `journey = mega_sorgo`;
- limpa a navegacao e o produto selecionado;
- nao retoma nem reinicia uma sequencia automaticamente;
- oferece ao atendente uma acao separada para retomar o funil, quando aplicavel.

## Precos por produto

O banco atual nao possui preco comercial no cadastro dos produtos. O campo
`quotes.price_cents` representa um orcamento individual e nao deve ser usado como
tabela geral.

Para enviar preco exato, deve existir uma fonte comercial valida contendo:

- produto;
- variante ou embalagem;
- unidade de venda;
- preco;
- regiao, quando houver diferenca;
- inicio e fim da validade;
- status de aprovacao;
- data da ultima atualizacao.

Enquanto o produto nao possuir preco aprovado e vigente, a resposta correta e
informar que o valor sera confirmado pelo consultor. O sistema nunca deve usar o
preco de outro produto como fallback.

## Compatibilidade

- O comportamento atual do Mega Sorgo permanece inalterado fora do catalogo.
- Os IDs existentes do Mega Sorgo continuam validos.
- Os IDs do catalogo permanecem em namespace separado.
- A mudanca vale primeiro para os canais hibridos em que o catalogo esta ativo.
- WhatsApp oficial, Facebook e Instagram nao devem receber automaticamente o
  catalogo sem homologacao especifica.

## Testes de aceitacao

1. Escrever "preco", "sementes" ou "produto" fora do catalogo nao abre o
   catalogo.
2. O macro `Abrir Catalogo` abre apenas a raiz do catalogo e pausa Mega Sorgo.
3. Selecionar Milho e depois escrever "preco" nunca envia preco do Mega Sorgo.
4. Selecionar outro produto troca corretamente o contexto.
5. Escrever "preco" no catalogo sem produto selecionado pede a selecao.
6. Um clique do catalogo nao executa nenhum handler do Mega Sorgo.
7. Um clique do Mega Sorgo nao executa nenhum handler do catalogo.
8. `Voltar ao Mega Sorgo` limpa o contexto sem duplicar sequencias.
9. Redeploy nao perde o contexto persistido.
10. Reentrega do mesmo webhook nao duplica mensagens.

## Implantacao

1. aplicar a migracao de estado;
2. publicar o roteador com o catalogo automatico desativado;
3. criar os macros de abrir e sair do catalogo;
4. testar em uma conversa controlada;
5. validar ausencia de mistura nos logs e no Chatwoot;
6. liberar para os atendentes;
7. cadastrar e homologar precos antes de ativar respostas exatas por produto.

