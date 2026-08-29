# Retencao de campanhas e logs

**Data:** 29/08/2026  
**Status:** desenho aprovado, aguardando revisao da especificacao

## Objetivo

Evitar que midias de campanha aumentem o armazenamento do Chatwoot e limitar o crescimento de
logs tecnicos, sem remover midias manuais, recebidas de clientes ou registros comerciais.

## Escopo

Incluido:

- campanhas por WhatsApp oficial, hibrido, Facebook e Instagram;
- audio, video, imagem e documento enviados automaticamente;
- prevencao de copias causadas pelo eco do provedor;
- limpeza automatica de registros de campanha apos tres dias;
- retencao e limite de tamanho para logs tecnicos do bridge e Chatwoot;
- observacao separada da retencao do Analytics do Supabase.

Excluido:

- midias enviadas manualmente por atendentes;
- midias recebidas de clientes;
- conversas, etiquetas, pagamentos, pedidos e dados comerciais;
- exclusao direta em tabelas internas ou no bucket `chatwoot-media`;
- exclusao automatica do historico ja existente sem criterio de origem verificavel.

## Fluxo de midia de campanha

1. Todo envio automatico recebe uma marcacao local de origem `campaign`, canal, mensagem do
   provedor, hash de arquivo e data de expiracao de tres dias.
2. Quando o provedor devolver o eco de uma midia ja enviada pelo bridge, a ingestao reconhece a
   marcacao e nao baixa nem anexa o arquivo novamente ao Chatwoot.
3. O atendente ve o registro operacional da campanha durante a janela de tres dias, sem uma nova
   copia binaria criada pelo eco.
4. Um trabalhador de retencao busca somente registros `campaign` vencidos e chama o endpoint
   oficial do Chatwoot para remover a mensagem e seus anexos.
5. O Chatwoot conserva apenas o marcador de mensagem removida; o arquivo deixa de ocupar seu
   armazenamento. O registro tecnico local preserva auditoria sem URL, nome de cliente, telefone
   ou conteudo da conversa.

## Seguranca e idempotencia

- A marcacao de campanha e criada antes do envio, para que um eco rapido tambem seja reconhecido.
- A chave de deduplicacao usa canal, mensagem do provedor quando disponivel e hash da midia.
- Sem marcacao `campaign`, a mensagem segue o fluxo atual: manual e recebida de cliente nunca
  entram na retencao.
- A limpeza usa lote limitado, modo de previa e API autenticada do Chatwoot; nenhuma tabela ou
  objeto e apagado diretamente.
- Falha de API deixa o item pendente, registra somente codigo tecnico e aplica nova tentativa com
  atraso. Falhas repetidas pausam o trabalhador e geram alerta operacional.

## Retencao de logs

### Bridge e Chatwoot

- Rotacao por tamanho e idade, com retencao maxima de 14 dias.
- Teto de volume configurado para impedir que logs preencham o disco.
- Erros e metricas agregadas continuam disponiveis no painel operacional; linhas antigas brutas
  expiram automaticamente.

### Analytics do Supabase

- Meta de retencao: sete dias para eventos tecnicos `_analytics`.
- Antes de alterar a infraestrutura, medir por 24 horas a taxa apos a reducao do loop de sync e
  validar Studio, Auth, Storage, Realtime e bridge.
- A limpeza ou a configuracao de retencao sera feita pelo mecanismo suportado da plataforma, nunca
  por `DELETE` manual na tabela interna de Logflare.

## Observabilidade

O painel deve mostrar, sem dados pessoais:

- midias de campanha evitadas pelo eco;
- itens aguardando expiracao e itens removidos;
- bytes economizados por canal e por tipo de midia;
- tamanho dos logs e dias restantes de retencao;
- alerta quando o disco livre cair abaixo do limite operacional definido.

## Criterios de aceite

1. Um audio ou video automatico devolvido como eco nao cria anexo adicional no Chatwoot.
2. Uma midia manual ou recebida de cliente continua intacta apos mais de tres dias.
3. Apenas mensagem marcada como `campaign` pode ser removida pelo trabalhador de retencao.
4. Cada limpeza e rastreavel por lote, quantidade, bytes, sucesso e falha, sem dados pessoais.
5. Logs do bridge e Chatwoot nao permanecem por mais de 14 dias nem ultrapassam o teto definido.
6. O Analytics do Supabase tem uma politica de sete dias validada antes de qualquer limpeza.
7. Chatwoot, bridge, campanhas e canais continuam saudaveis durante e apos a ativacao.
