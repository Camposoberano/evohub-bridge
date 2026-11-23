# Correção da fila Mega Sorgo 7d — 22/11/2026

## Causa

`darRespiro7d` adiava uma peça pendente sem manter os horários das próximas em
ordem. O `due()` escolhia a peça com `send_at` mais antigo, que podia ter `step`
posterior. `send-outbound` recusava essa peça com `previous-step-not-sent`.
O canal oficial 6836 tinha token inválido; fallback da rota híbrida gerou 401.

## Aplicado

- Commit `3c5ac17` no `main`; deploy do servidor Coolify
  `eadtkllnhqclzaetms8frbds` terminou com saúde HTTP 200.
- `due()` do 7d agora escolhe a menor etapa pendente por conversa e só a entrega
  ao despachante quando o horário dela chegou. A consulta pagina em blocos de
  1.000 peças (até 5.000); havia 1.235 pendentes na implantação.
- O respiro passa a preservar pelo menos cinco minutos e a ordem das etapas
  seguintes, sem mudar dias futuros quando já estão suficientemente espaçados.
- O envio automático 7d do 6836 só usa a rota híbrida. Na indisponibilidade,
  a peça permanece pendente com novo horário, sem tentar o token oficial 401.
- Horários das peças pendentes das conversas 5172, 5175, 5183, 5189 e 5200
  foram reorganizados. 5172 e 5175 voltam a partir de 23/11 às 08h BRT.
  Nenhuma peça foi marcada como enviada ou reenviada nessa operação.

## Pendente de reconciliação

25 conversas do 6836 seguem com peça `failed`: 21 respostas 500 de resultado
incerto e 4 respostas 401. Não reencaminhar em lote. Conferir recibo de cada
tentativa incerta antes de decidir se a peça foi entregue ou se a sequência
deve seguir sem ela. As sequências antigas pausadas/canceladas não entram nesta
correção.
