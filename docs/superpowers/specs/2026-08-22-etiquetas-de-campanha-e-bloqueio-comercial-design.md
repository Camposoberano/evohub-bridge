# Etiquetas de campanha e bloqueio comercial

## Objetivo

Aplicar uma etiqueta de campanha, inicialmente `SUL`, quando uma sequência terminar com sucesso, mantendo a etiqueta no WhatsApp e/ou no Chatwoot conforme a configuração da campanha. Ao mesmo tempo, impedir novos disparos para contatos com `Não COMPRA` ou `Pago`.

## Regras de negócio

- `Não COMPRA` bloqueia o contato permanentemente. O contato sai das filas atuais e futuras, e tentativas de iniciar funil ou campanha retornam bloqueio.
- `Pago` encerra e cancela todos os disparos atuais e exclui o contato das campanhas normais. Uma campanha explícita de pós-venda poderá optar por incluir pagos no futuro.
- `SUL` é uma etiqueta de segmentação e não altera `outcome`.
- Etiquetas `Pago`, `Não COMPRA`, `SUL` e outras etiquetas de origem devem coexistir sem substituição indevida.
- A etiqueta de conclusão é idempotente: uma mesma sequência não aplica a mesma etiqueta mais de uma vez.

## Configuração

Cada campanha/funil terá uma regra opcional de conclusão:

```json
{
  "completion_label": "SUL",
  "completion_label_targets": ["whatsapp", "chatwoot"],
  "include_paid": false,
  "include_blocked": false
}
```

Os destinos válidos são `whatsapp`, `chatwoot` e `both` (normalizado internamente para os dois destinos). A ausência da regra não aplica etiqueta.

## Fluxo de execução

1. O reconciliador identifica que todas as peças elegíveis da sequência foram enviadas e marca a sequência como `completed`.
2. Uma operação idempotente registra uma entrega por sequência, etiqueta e destino.
3. No Chatwoot, a etiqueta é adicionada preservando as etiquetas atuais da conversa.
4. No WhatsApp, a etiqueta existente é localizada pelo nome e adicionada ao chat sem remover outras etiquetas.
5. Falha em um destino não desfaz o outro; a operação fica registrada para retry e auditoria.
6. Antes de qualquer novo enrolamento ou envio, o bloqueio comercial é verificado por contato, não apenas por conversa.

## Segurança contra novos disparos

O bloqueio é aplicado em quatro pontos: ingestão de mensagem de recusa, sincronização de etiquetas do WhatsApp, enrolamento de funil/campanha e fila de envio. Assim, uma corrida entre loops não consegue enviar uma peça depois de `Pago` ou `Não COMPRA`.

## Auditoria e testes

- Registrar eventos de bloqueio, cancelamento e aplicação de etiqueta com sequência, contato, destino e resultado.
- Testar conclusão idempotente, coexistência de etiquetas, falha isolada de um destino, bloqueio antigo e tentativa de novo enrolamento.
- Validar primeiro em uma conversa de teste antes de habilitar `SUL` para toda a campanha.

