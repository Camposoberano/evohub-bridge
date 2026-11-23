# Público dos últimos 120 dias — 5895 e 6836

Auditoria somente leitura do público em 23/11/2026, seguida de correção da
fila ainda não enviada. Número válido significa telefone brasileiro único
com mensagem de entrada no canal no período. Etiquetas foram conferidas no
EVO Hub e nos contatos do Chatwoot; cada caixa foi deduplicada por telefone.

## Total por caixa

| Medida | 5895 | 6836 |
|---|---:|---:|
| Números únicos com entrada em 120 dias | 1.753 | 275 |
| Etiqueta `pago` | 116 | 39 |
| Etiqueta `safrinha` | 14 | 0 |
| Etiqueta `não compra` | 196 | 28 |
| Excluídos únicos por qualquer dessas etiquetas | 323 | 66 |
| Após as três etiquetas | 1.430 | 209 |

As três etiquetas podem se sobrepor; por isso a soma das linhas de etiqueta
não é o número de excluídos únicos. Há 35 números nas duas caixas, 240 só no
6836 e **1.993 números únicos na união**.

## Campanhas e risco

- Black Friday anterior do 5895: 629 números marcados `sent`; todos aparecem
  no recorte atual de 120 dias. Dez deles hoje têm uma das três etiquetas.
- Partição sem duplicar do público 5895: 323 com etiqueta de exclusão,
  619 já enviados na Black Friday sem etiqueta, 811 inicialmente enfileirados.
  Total: 1.753.
- Na auditoria cruzada da fila nova, 5 tinham etiqueta em conversa do 6836:
  3 `pago`, 2 `não compra`. Quatro tinham entrada recente no 6836; o quinto
  tinha etiqueta em conversa anterior ao recorte. Foram marcados `skipped`,
  preservando o motivo e sem apagar contato.
- Outros 167 itens tinham `outcome='lost'` no 5895, embora sem a etiqueta
  literal. O preflight da campanha já os bloquearia. Foram marcados `skipped`
  com `last_error='outcome-lost-5895'`, sem envio.
- Fila nova após correção: **639 `pending`, 172 `skipped`, zero `sent`**.
  Nas 639 pendências, a checagem final achou zero etiquetas de exclusão em
  qualquer canal, zero `outcome` `won/lost` e zero números `sent` na Black
  Friday anterior. A validação por contato continua ativa antes de cada envio.
- O ritmo foi recalibrado para 639 pendências: limites de 23 a 30/11 =
  50, 60, 70, 78, 85, 92, 100 e 112; janela 06:00–20:00 Fortaleza.
  A capacidade antes do último dia é 535. Se essa capacidade for usada,
  restam 104 para 30/11, com margem de 8 no limite daquele dia.

Arquivos privados locais, fora do Git:

- `E:/Projetos_Novos/evohub/ops/leads-5895-6836-120d-2026-11-23.private.csv`
  — 1.993 linhas com canal, etiquetas, Black Friday e estado da campanha.
- `E:/Projetos_Novos/evohub/ops/campanha-5895-pendentes-seguros-2026-11-23.private.csv`
  — 639 números ainda pendentes após as exclusões.

Os arquivos completos têm telefone pessoal; não imprimir seu conteúdo em logs
ou commitar no repositório.
