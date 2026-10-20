# Ações do funil Soberano em workflows n8n

- Data: 2026-10-10
- Projeto: Hub Soberano (`E:\Projetos_Novos\evohub`)
- Instância n8n: `https://automacao.soberano.pro`
- Canal principal: WhatsApp Oficial 5895

## Objetivo

Permitir que Cícero encontre e edite cada ação comercial em um workflow próprio no n8n, sem perder a entrada automática dos leads de anúncios nem o funil completo fiel a 30/09. A macro manual do Chatwoot e a entrada automática devem usar o mesmo caminho para iniciar esse funil. Um pedido de preço acrescenta a resposta no intervalo apropriado e não encerra a sequência principal.

Esta especificação pertence somente ao Hub Soberano. Workflows e credenciais de outras instâncias não participam dela.

## Estado observado

- As macros atuais adicionam etiquetas `cmd-*` no Chatwoot. O bridge as consulta periodicamente, executa `/funil-control` e remove a etiqueta após sucesso.
- O workflow ativo `Funil Mega Sorgo - Fila (cron 1min)` consulta `scheduled_messages`, chama `/send-outbound` e depois marca a linha como `sent`. Seu nó HTTP aceita respostas de erro e o caminho até a atualização não verifica sucesso. Portanto, `sent` pode ser gravado sem confirmação positiva do bridge.
- O workflow antigo `Funil Mega Sorgo - Apresentacao (cron)` está inativo e não deve voltar a consumir a fila.
- A versão principal restaurada do 5895 é `mega-sorgo-5895-20260930`, com 31 peças em cinco fases. Versões curtas ou antigas não devem iniciar novos envios para esse canal.

## Alternativas consideradas

1. **Um workflow por ação, com uma fila e um emissor compartilhados — escolhido.** O conteúdo e a entrada de cada ação ficam visíveis no n8n; o bridge mantém identidade da conversa, estado e regras comuns. Há um só consumidor de mensagens pendentes.
2. Um workflow por ação, cada um enviando direto ao canal. Isso repetiria regras de intervalo, janela, pausa, confirmação e idempotência em todos os workflows e aumentaria o risco de peças fora de ordem ou duplicadas.

## Arquitetura aprovada

### Entrada e roteamento

Cada ação terá um webhook n8n autenticado e um workflow com nome explícito, prefixado por `Soberano 5895`. O mapeamento entre etiqueta, ação e webhook será mantido em um único registro de configuração, sem URLs ou tokens embutidos no conteúdo das mensagens.

O bridge continuará lendo as etiquetas das macros do Chatwoot. Ao encontrar uma ação, validará a conversa e o canal, gerará uma chave idempotente para aquele comando e encaminhará a solicitação ao webhook correspondente. A etiqueta só será consumida após uma aceitação durável da ação; falhas transitórias manterão a ação elegível para nova tentativa. Falhas definitivas terão uma nota clara para o atendente.

A entrada automática de um novo lead de anúncio no 5895 chamará o mesmo workflow de `funil completo`, com o mesmo identificador de versão e as mesmas regras de deduplicação da macro. O acionamento manual não criará outra sequência se a sequência correta já estiver em andamento ou concluída, salvo uma ação explícita de reenvio prevista no contrato do bridge.

### Workflows separados

1. Funil completo do Mega Sorgo, versão fiel de 30/09.
2. Preço.
3. Vídeo.
4. Plantio.
5. Nutrição.
6. Recuperação 1.
7. Recuperação 2.
8. Recuperação 3.
9. Recuperação 4.
10. Abrir catálogo.
11. Voltar ao Mega Sorgo.
12. Pausar funil.
13. Retomar funil.
14. Parar funil.

As ações de controle terão workflows próprios para dar visibilidade no n8n, mas pedirão ao bridge a transição de estado; não enviarão peças diretamente. Etiquetas de estado, como `bot-off`, e a reconciliação do bot permanecem com o comportamento atual até uma decisão específica sobre elas. O workflow do funil completo possuirá a lista ordenada das 31 peças, seus tipos de mídia, intervalos e cinco fases. Os workflows de conteúdo possuirão seus próprios textos, mídias e parâmetros editáveis. Identificadores de mídia devem ser referências estáveis, sem copiar arquivos nem credenciais para os nós.

### Fila, envio e confirmação

Os workflows submetem um lote ordenado ao bridge. O bridge valida canal, versão, janela de envio, estado da conversa, posição no funil e chave idempotente antes de gravar as peças em `scheduled_messages`. A gravação do lote deve ser atômica ou recuperável sem duplicação. O pedido de preço recebe prioridade apenas no próximo intervalo permitido; não cancela nem reinicia as peças restantes do funil principal.

Haverá um único consumidor ativo da fila. A linha passa de `pending` para `sent` somente após resposta positiva do envio pelo bridge, com registro do identificador/resultado disponível. Resposta HTTP sem confirmação lógica, timeout ou falha explícita não equivale a envio. Nesses casos, a linha fica para nova tentativa controlada ou recebe estado de falha visível após o limite de tentativas. Repetir uma requisição com a mesma chave não pode produzir uma segunda mensagem. `sent` significa confirmação do serviço de envio; entrega ao aparelho, quando disponível, é um evento posterior e não deve ser presumida.

### Observabilidade e correção

Cada execução deve permitir rastrear: origem (`anúncio` ou `macro`), conversa Chatwoot, ação, versão do conteúdo, chave idempotente, peças agendadas, peças confirmadas e erro. O atendente recebe nota de falha acionável; uma nota de sucesso só relata o que foi efetivamente aceito ou confirmado. Preço e demais conteúdos podem ser corrigidos no workflow correspondente sem editar o funil inteiro. Mudanças de conteúdo criam uma nova versão para acionamentos futuros; sequências já agendadas preservam sua versão e não são alteradas silenciosamente.

## Migração sem emissor concorrente

1. Inventariar ações e conteúdo atuais do 5895 e comparar as 31 peças com a versão de 30/09.
2. Criar os workflows novos inativos ou isolados, configurar credenciais pelos mecanismos do n8n e conferir seus contratos sem iniciar envio real.
3. Corrigir o consumidor único da fila para exigir confirmação antes de marcar `sent`, com retentativa idempotente e registro de falha.
4. Conectar uma ação por vez ao roteamento do bridge. Manter o caminho anterior para as demais ações até a respectiva troca. Nunca ativar dois consumidores da mesma fila.
5. Preservar os registros já agendados e a posição das sequências em andamento. Novos inícios passam ao workflow novo somente quando a ação estiver validada.
6. Após verificar cada ação, desativar apenas o caminho antigo equivalente. Manter a versão curta e a apresentação antiga inativas.

## Verificação e critérios de aceite

- O funil completo iniciado por anúncio e o iniciado por macro produzem a mesma versão de 30/09, com 31 peças em cinco fases, na ordem e nos intervalos definidos.
- Um pedido de preço durante o funil produz a resposta no intervalo permitido e as peças seguintes continuam.
- Duas entradas iguais, uma nova tentativa após timeout e a sobreposição entre anúncio e macro não duplicam mensagens.
- Pausar, retomar e parar afetam somente a conversa solicitada e deixam rastros claros.
- Uma falha do `/send-outbound` não transforma a peça em `sent`; a tentativa pode ser recuperada sem duplicação.
- Um disparo real controlado em conversa elegível do 5895 confirma as mensagens na conversa e o retorno do serviço de envio. A verificação não se baseia apenas em notas internas.
- Nenhum workflow da instância CECAPE é lido, modificado ou ativado como parte da implantação.

## Limites

Este trabalho reorganiza as ações comerciais existentes do 5895. Não muda o conteúdo aprovado de 30/09, não adiciona novos argumentos de venda e não faz disparo em massa para contatos antigos. Recuperações e catálogo mantêm suas regras comerciais atuais; só sua entrada e manutenção passam a workflows separados.
