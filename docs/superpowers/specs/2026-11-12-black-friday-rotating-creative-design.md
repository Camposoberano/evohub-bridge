# Black Friday Mega Sorgo: artes rotativas e botões

## Objetivo

Corrigir a campanha de Black Friday no WhatsApp para que cada contato pendente receba uma das três artes aprovadas, uma legenda curta e opções de resposta clicáveis. Preservar os filtros comerciais e o ritmo de envio aprovado.

## Público e estado

- Público aprovado: 641 contatos que tiveram mensagem de entrada nos últimos 60 dias, excluídos os rótulos `pago`, `safrinha` e `não compra`.
- A fila real contém 13 itens `sent` e 628 `paused`. Nunca reenviar os 13 enviados.
- A fila fica pausada até o conteúdo e o despachante estarem prontos.

## Conteúdo aprovado

As três imagens anexadas pelo dono devem ser hospedadas em `soberano-out` com novos caminhos, sem sobrescrever arquivos existentes:

1. `Promoção Black Friday Mega Sorgo.png`
2. `Mega Sorgo Santa Elisa Black Friday.png`
3. `124e2cef-9658-4a99-8e34-4c4aca022c55.png`

Enviar uma imagem por contato, em rotação estável e determinística. Repetições para o mesmo contato devem selecionar a mesma imagem.

Legenda:

> Black Friday Mega Sorgo Santa Elisa 🌱 Safra 27: sementes novas e até 30% de desconto. A condição varia conforme sua área de plantio. Escolha uma opção abaixo e consulto para você.

Botões:

- `Consultar desconto` → perguntar a área em hectares e encaminhar ao atendimento humano.
- `Tenho dúvidas` → convidar a enviar a pergunta e encaminhar ao atendimento humano.
- `Deixar para depois` → encerrar sem novas mensagens da campanha.

O terceiro título é exclusivo para evitar colisão com o `Agora não` da isca PDF no parser de botões da UAZAPI.

## Ritmo

- Primeira retomada: 13/11/2026, 07:00 BRT.
- 50 contatos no primeiro dia, acréscimo de 10 por dia, no máximo 641.
- Janela diária: 07:00–19:00 BRT.
- Preservar o limite global do público; as variantes não podem multiplicar o limite diário.

## Limites de implantação

- Não usar templates Meta nesta campanha.
- Não alterar canais nem outras filas.
- Publicar o bridge somente depois das 20:00 BRT, conforme `AGENTS.md`.
- Manter os 628 itens pausados até o código e as URLs das artes estarem disponíveis.
