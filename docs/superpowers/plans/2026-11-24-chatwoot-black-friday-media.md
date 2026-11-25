# Black Friday 5895 e espelhamento de imagem no Chatwoot — plano

**Objetivo:** preservar o envio aprovado pela UAZAPI e fazer o Chatwoot mostrar a mesma imagem e legenda, sem duplicar mensagens.

## Escopo

- Substituir o menu antigo do fluxo Black Friday por uma única imagem com legenda aprovada.
- Após enviar a imagem, pausar silenciosamente até uma resposta; responder com a regra de 30% + frete grátis a partir de 20 kg.
- Espelhar futuras imagens de saída como anexo no Chatwoot, marcando a mensagem como já enviada.
- Preservar estados da fila, cadência e destinatários; nenhuma reexecução histórica ou mensagem de teste.
- Limitar o download do espelho a imagens HTTPS do bucket `soberano-out`, com tipo e tamanho validados.

## Alterações

1. Adicionar `reply_wait` ao motor de fluxo para aguardar resposta sem enviar uma bolha vazia.
2. Atualizar `flow-record.ts` para anexar apenas imagens permitidas ao registro já existente no Chatwoot.
3. Publicar a arte corrigida em um caminho novo e alterar somente os fluxos das campanhas Black Friday 5895 afetadas.
4. Atualizar a identificação de build/features e registrar a decisão operacional.

## Verificação

- [x] `deno check --node-modules-dir=none bridge/server.ts` e `git diff --check` passaram; nenhum disparo de teste.
- [x] Publicado fora da janela (23h17 Fortaleza); `/health` = `ok`; `/version` confirmou o build e as features.
- [x] Fila reconsultada: 524 `pending`, 110 `sent`, 177 `skipped`; cadência e `endAt` preservados.
- [x] Fluxo ativo e fluxo antigo revisados: UAZAPI-only, imagem → espera silenciosa → explicação quando o cliente responder.
- [x] Arte no Storage respondeu HTTP 200, `image/png`, 1.802.448 bytes.
- [ ] Conferir visualmente o anexo no Chatwoot após o próximo envio natural; sem teste ou reenvio.
