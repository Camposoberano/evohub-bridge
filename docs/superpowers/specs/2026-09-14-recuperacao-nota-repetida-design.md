# Recuperação sem nota repetida — design

## Objetivo

Impedir que a cadeia automática de recuperação publique repetidamente no Chatwoot
a nota privada "Recuperação N não repetida" quando o envio já foi feito no passado.

## Contexto confirmado

A conversa Chatwoot `1342` recebeu a recuperação 1 em 19/08/2026. A trava
persistente `deliveries.recovery-<conversation>-1` permaneceu correta, mas o evento
analítico `recovery_sent` não estava mais disponível. A cadeia automática usa eventos
para decidir a variação pendente; por isso tentou a variação 1 em cada ciclo de cinco
minutos. `dispatchRecovery` encontrou a trava, não reenviou ao cliente e publicou a
nota privada em todas as tentativas.

## Decisão

A trava persistente de `deliveries` é a fonte de verdade para idempotência. Quando
`dispatchRecovery` encontrar uma trava de recuperação já existente:

1. não enviará conteúdo ao cliente;
2. não publicará nota privada no Chatwoot quando o chamador for a cadeia automática;
3. registrará novamente o evento `recovery_sent`, marcado como reconciliação histórica;
4. devolverá um resultado explícito de reconciliação, distinto de um envio novo.

A cadeia automática tratará a reconciliação como progresso de estado, sem contar como
novo envio no seu limite por rodada. Na rodada seguinte, o evento recomposto fará a
cadeia avançar para a variação correta, ou parar se não houver nova variação devida.

As macros manuais preservam o aviso útil de conteúdo já enviado, mas esse aviso continua
fora da execução automática. A correção não remove mensagens já existentes no Chatwoot e
não altera entregas reais ao cliente.

## Interfaces e dados

- `dispatchRecovery` passará a aceitar uma opção que identifica a execução automática.
- O retorno terá estado explícito: `sent`, `reconciled` ou `failed`.
- O evento reconciliado terá `source: recovery`, `event_type: recovery_sent`, os mesmos
  identificadores da recuperação e `reconciled_from_delivery: true` no payload.
- A consulta de eventos continuará limitada à janela de recuperação de 30 dias; a
  reconciliação só ocorre quando existe uma tentativa automática elegível.

## Tratamento de erro

- Se a gravação do evento de reconciliação falhar, a rotina retorna falha e não cria nota.
  Assim, não finge estado resolvido nem reintroduz ruído no Chatwoot.
- Uma trava inexistente continua permitindo o envio normal.
- Uma falha terminal de envio continua usando o bloqueio já existente (`recovery_blocked`).

## Testes de aceitação

1. Uma entrega histórica sem `recovery_sent` é reconciliada sem chamada de envio e sem
   nota privada automática.
2. A reconciliação cria exatamente um evento compatível com a leitura normal da cadeia.
3. Uma segunda rodada não tenta a mesma variação novamente.
4. O resultado reconciliado não consome o teto de novos envios da rodada.
5. O fluxo manual continua informando ao atendente que a recuperação já foi enviada.
