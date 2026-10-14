# Resposta digitada na oferta Embrapa 5895

## Contexto

A campanha Embrapa do 5895 está pronta para retomar em 14/10/2026, das 08h às 20h. O passo `oferta` oferece botões `quero` e `nao`, mas possui `fallbackNext: "nao"`. Nos webhooks UAZAPI e Hub, texto livre chega a `continueFlowOnReply` com `replyId=null`; assim, até `Quero` digitado segue para a recusa.

## Comportamento aprovado

Somente quando o estado aguardando pertence à campanha `isca-embrapa-sul-sudeste-5895-2026-09-25` e ao passo `oferta`:

- Clique em `quero` continua para o PDF; clique em `nao` continua para a recusa.
- Texto afirmativo explícito, como `Quero`, `Quero o material` e `Pode enviar o PDF`, equivale ao clique `quero`.
- Texto de recusa explícita, como `Não` e `Agora não`, equivale ao clique `nao`. Pedidos de parar a automação continuam sob a proteção global de desinteresse.
- Texto ambíguo não reserva o passo, não envia o PDF e mantém o estado aguardando. As demais rotinas podem tratar a mensagem normalmente.
- Nenhum outro fluxo muda sua interpretação de texto livre.

## Implementação e validação

Adicionar uma função pequena e pura para classificar a resposta da oferta, com normalização de acentos, maiúsculas e pontuação e lista restrita de frases. Passar o conteúdo da mensagem dos dois webhooks ao continuador de fluxo. Antes de reservar o passo, aplicar a classificação apenas à campanha e ao passo acima; respostas ambíguas retornam sem alterar o estado. Manter o fluxo salvo e seu `fallbackNext` intactos para evitar reescrever a configuração de produção.

Testar afirmação, recusa, ambiguidade, botões e isolamento dos demais fluxos. Depois de implantar, conferir a versão da ponte, o estado da fila e um teste controlado de resposta sem enviar PDF a contatos reais.
