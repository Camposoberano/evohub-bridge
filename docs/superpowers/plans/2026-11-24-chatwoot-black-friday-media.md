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

- Executar `deno check bridge/server.ts` e `git diff --check`; não disparar mensagens de teste.
- Publicar fora da janela de campanha (06h–20h Fortaleza), confirmar `/health` e `/version`.
- Reconsultar os totais da fila e conferir a configuração final sem listar contatos.
- Confirmar a imagem no Chatwoot apenas quando ocorrer um envio natural da fila.
