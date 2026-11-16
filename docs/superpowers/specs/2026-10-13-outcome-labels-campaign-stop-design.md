# Etiquetas comerciais e exclusão de disparos — 5895

## Objetivo

Uma recusa explícita no WhatsApp 5895 aplica **Não COMPRA** no WhatsApp e **nao-compra** no Chatwoot, encerra o funil de todas as conversas do contato e marca seus itens ainda não enviados nas campanhas como ignorados. A etiqueta **pago** continua sendo uma confirmação humana; quando aplicada, produz a mesma exclusão de automações e campanhas sem classificar o comprador como desinteressado.

## Situação observada em 13/10

- A conversa #3403 disse “No momento não irei adquirir, obrigado” às 06h15. `isNegativeIntent` devolve `false`; sete peças seguintes do funil foram enviadas. O estado continuou `open`, sem etiqueta ou bloqueio.
- A conversa #3509 tem `wa:Pago`, `outcome=won` e `contacts.attributes.automation_excluded=true`. A entrada de etiqueta pelo WhatsApp funciona neste caso.
- `stopContactAutomation` cancela `scheduled_messages` e marca `campaign_queue` como `skipped`, mas não cria etiquetas visíveis. O comando manual de `funil-control` cancela apenas a conversa atual e não limpa campanhas. O sincronizador de etiquetas do Chatwoot atualiza `outcome`, mas não invoca a exclusão durável.

## Regras

1. Reconhecer recusas explícitas, inclusive “não irei adquirir no momento” e “não quero comprar agora”, sem transformar dúvidas (“não sei o preço”) em recusa. Expressões ambíguas não bloqueiam automaticamente.
2. Executar a exclusão durável antes de tentar escrever etiquetas externas. Falha em Chatwoot ou WhatsApp não pode deixar peças agendadas ou campanhas elegíveis; deve gerar erro consultável e permitir nova tentativa idempotente.
3. Em toda entrada — mensagem livre, etiqueta do WhatsApp, etiqueta do Chatwoot e comando manual — usar as mesmas operações para todas as conversas do contato: `contacts.attributes.blocked=true` ou `automation_excluded=true`, `scheduled_messages` pendentes/pausadas canceladas, `sales_sequences` ativas canceladas, `campaign_queue` pendente/pausada/em processamento marcada `skipped`. Itens já enviados não são apagados.
4. Para recusa, preservar as etiquetas existentes e adicionar `nao-compra` no Chatwoot e `Não COMPRA` no WhatsApp. Para pagamento, só uma etiqueta aplicada por pessoa confirma a venda; nunca inferir `pago` de texto, áudio, comprovante ou link.
5. Quando ambas as etiquetas de recusa forem removidas deliberadamente após terem sido sincronizadas, limpar o bloqueio `nao-compra` e reabrir apenas desfechos originados dessa recusa. Filas já ignoradas não são reativadas automaticamente.
6. A chave de deduplicação é contato/canal/desfecho. Consultar etiquetas antes de acrescentar; repetir a mesma entrada não pode duplicar etiquetas, eventos de resultado ou mensagens ao cliente. Nenhuma etapa desta mudança envia mensagem ao cliente.

## Estrutura

- `negative-intent.ts`: detector conservador, testado com frases reais e contraexemplos.
- `stop-contact.ts`: operação comum de exclusão e operação explícita de reativação; erros do banco propagam ao chamador.
- Um adaptador de etiquetas comerciais reutiliza as APIs existentes do Chatwoot e da Uazapi, preserva etiquetas e informa o resultado de cada destino. O bloqueio interno acontece primeiro.
- Webhooks de entrada e `funil-control` invocam a operação comum; sincronizadores do Chatwoot e WhatsApp reconciliam etiquetas e desfechos, inclusive a remoção deliberada.
- `campaign-preflight` permanece como segunda barreira antes de cada envio.

## Verificação

Testes dirigidos cobrem recusa da #3403, frases que não são recusa, `pago` humano, deduplicação, cancelamento de todas as conversas, exclusão da fila de campanha, falha em um dos destinos de etiqueta e remoção posterior de ambas. Depois do deploy, conferir os estados no Supabase e as etiquetas nas duas interfaces usando um contato de teste; não disparar campanha nem mensagens para clientes reais nessa verificação.
