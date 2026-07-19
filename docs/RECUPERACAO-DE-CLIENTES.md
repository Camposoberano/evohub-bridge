# Recuperação de clientes

## Objetivo

Retomar conversas que esfriaram sem repetir o funil principal nem pressionar o
cliente. A primeira versão é manual e opera inicialmente no canal híbrido 5895.

## Cadência recomendada

| Momento | Macro | Peça principal | Objetivo |
| --- | --- | --- | --- |
| 18 a 24 h sem resposta | Recuperação 1 | imagem + botões | descobrir a dúvida principal |
| 24 h após a anterior | Recuperação 2 | vídeo + botões | mostrar resultado no campo |
| 48 h após a anterior | Recuperação 3 | áudio + botões | tratar objeção com proximidade |
| 72 h após a anterior | Recuperação 4 | imagem + botões | pedir uma decisão simples |

Aplicar somente entre 06:00 e 22:00. Se o cliente responder, interromper a
cadência e assumir a conversa. Não disparar as quatro variações no mesmo dia.

## Macros do Chatwoot

- `Recuperar 1 - Imagem`: adiciona `cmd-recuperar-1`.
- `Recuperar 2 - Video`: adiciona `cmd-recuperar-2`.
- `Recuperar 3 - Audio`: adiciona `cmd-recuperar-3`.
- `Recuperar 4 - Decisao`: adiciona `cmd-recuperar-4`.

O bridge remove a etiqueta de comando depois de processá-la. Cada variação só
pode ser enviada uma vez por conversa. Uma tentativa que falhar é liberada para
novo clique.

## Etiquetas de acompanhamento

- `recuperacao-1-enviada` a `recuperacao-4-enviada`: histórico das peças.
- `recuperacao-aguardando`: cliente ainda não respondeu à última recuperação.
- `recuperacao-respondeu`: houve mensagem após a recuperação.

Uma resposta recebida troca automaticamente `recuperacao-aguardando` por
`recuperacao-respondeu`.

## Entrega híbrida

Texto e mídia saem pela UazAPI quando existe rota híbrida válida. Botões usam
`POST /send/menu`. Se o formato interativo for recusado, o bridge tenta uma
versão textual numerada. Se a rota híbrida inteira falhar e a janela oficial
estiver fechada, a entrega é bloqueada e registrada, sem criar falso sucesso.

## Regra comercial

O operador escolhe a variação conforme o estágio exibido nas etiquetas. A
recuperação não deve reenviar automaticamente preço, plantio, nutrição ou a
sequência completa de vídeos; esses materiais só são entregues quando o cliente
seleciona uma opção.
