# Encerramento por desinteresse

## Objetivo

Quando o cliente escolher ou escrever uma recusa explícita, nenhuma automação comercial deve continuar enviando mensagens ou recolocar o contato em uma fila.

## Comportamento

- Reconhecer frases explícitas como `Não tenho interesse`, `Não quero`, `Sem interesse`, `Pare de enviar` e `Sair da lista` nos canais WhatsApp oficial e não oficial.
- Preservar a mensagem recebida, marcar a conversa como `lost` e bloquear o contato para novos funis.
- Cancelar mensagens pendentes ou pausadas, sequências ativas e itens pendentes da fila de campanhas.
- Aplicar a mesma operação quando a sincronização do WhatsApp detectar a etiqueta `Não COMPRA`.
- Fazer o consumidor da fila tratar `lost` como encerramento, mesmo que a marcação venha de outro caminho.
- Mensagens manuais do atendente continuam permitidas; a trava vale para automações.

## Arquitetura

`bridge/shared/negative-intent.ts` normaliza e reconhece somente recusas explícitas.

`bridge/shared/stop-contact.ts` concentra o encerramento idempotente por contato, atualizando conversas, filas, sequências, bloqueio durável e evento de auditoria.

Os webhooks chamam o encerramento logo depois de persistir uma entrada negativa, antes de roteamento de catálogo, intenção, funil ou campanha. A sincronização de etiquetas do WhatsApp usa o mesmo serviço. O pump da fila mantém uma trava independente para `lost`.

## Verificação

- Testes unitários para as frases aceitas e para não confundir frases comuns com recusa.
- `deno check` dos handlers alterados.
- Testes existentes de outcome, funil e fila.
- Auditoria somente leitura após deploy: nenhuma fila pendente para conversas `lost` e nenhum novo envio automático após uma recusa.
