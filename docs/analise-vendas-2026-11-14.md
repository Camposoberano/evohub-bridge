# 2ª análise de vendas — EVO Hub agro (14/11/2026)

> Dado vivo do banco self-host (`public`), 4.316 conversas (todos os canais da conta, não só o
> funil mega-sorgo). Complementa a 1ª análise (que olhou só as 1.194 do funil).

## Números-chave
| Métrica | Valor | Leitura |
|---|---|---|
| Conversas | 4.316 | base total |
| **Open** | **3.699 (85,7%)** | **97% paradas >7 dias, idade mediana 49 dias** |
| Lost | 463 | 268 "não-compra" (etiqueta WA), 162 auto-silêncio, 22 recusa explícita |
| **Won** | **154 (3,6%)** | 144 por etiqueta WhatsApp, 10 por label; **0 pela instrumentação do funil** |
| Receita | **R$ 0 gravado** | `outcome_value_cents` zerado — ROI impossível |
| Open com humano | **180/3.699 (4,9%)** | o resto apodrece sem ninguém |

## O cemitério: 3.596 leads parados >7 dias, sem humano
Maior ativo e maior vazamento ao mesmo tempo. O funil **gera conversa que apodrece**: 85,7% ficam
`open`, 97% delas há mais de uma semana (mediana 49 dias), e só 4,9% têm atendente. Esse é o gargalo
nº1 das vendas — muito maior do que a 1ª análise mostrou (ela via só o subconjunto do funil).

## Tendência mensal (conversas criadas / vendas no mês)
```
Jul  382 / 0      Ago 1244 / 40     Set 993 / 68
Out 1455 / 34     Nov 242 / 12 (meio do mês)
```
**Outubro é o alerta:** MAIS conversas (1.455, recorde) e MENOS vendas (34, caiu de 68). Volume subiu,
fechamento caiu → escalar disparo sem consertar o fechamento só **engorda o cemitério**.

## Por canal (quem converte)
| Canal | Conversas | Won | Taxa |
|---|---|---|---|
| **6836** | 678 | 39 | **5,8%** ← melhor |
| 5895 | 2.726 | 115 | 4,2% |
| 0595 | 271 | 0 | 0% (canal parado) |
| campo soberano | 256 | 0 | 0% |
| Atendimento IG | 241 | 0 | **0%** |
| sorgo brasileiro / MT / outros | ~130 | 0 | 0% |

- **6836 converte melhor que 5895** (5,8% vs 4,2%) — entender por quê (público/quem trabalha) e
  deslocar esforço/volume pra lá.
- **IG + "campo soberano" + sociais = 0 venda** apesar de ~500 conversas. Lead social entra e não
  converte (sem funil/automação em FB/IG — furo conhecido). Dinheiro de anúncio entrando sem retorno.

## Resposta e atendimento
- 1ª resposta: mediana **0,3 min** (bot instantâneo) — topo é rápido.
- Mas **p90 = ~24h** e **40,9% das conversas (1.767) não têm `first_response_at`** registrado —
  buraco de instrumentação ou lead realmente sem resposta. Nos dois casos, cegueira.

## Onde melhorar (ranqueado por impacto)
1. **Trabalhar o cemitério** — 3.596 `open` parados. Fila de re-engajamento + atribuição ao Cícero
   (com SLA). É onde está a maior reserva de venda já paga (o lead já respondeu um dia).
2. **Fechamento/handoff** (1ª análise): só 3,6% chegam no humano; 64 das 76 vendas do funil fecharam
   fora do sistema. Gatilho de handoff em todo sinal de compra (já corrigido no 7d — ver
   [[funil-7d-desenho]] seções 0 e 6).
3. **Social (IG/FB) = 0 venda** — ou liga automação/funil no social, ou para de pagar anúncio que
   entra e morre. Decisão de verba.
4. **Realocar pra 6836** (converte 38% melhor que 5895) e entender a diferença.
5. **Não escalar disparo antes de fechar o fundo** — Out provou: +volume, −venda.
6. **Instrumentar receita** (`outcome_value_cents`) e `first_response_at` — sem isso toda decisão de
   verba é no escuro.

## Ressalvas de leitura
- Win = etiqueta "Pago" do WhatsApp (o time marca lá). `label`/`whatsapp-label` são a verdade; a
  instrumentação estruturada do funil não registra venda. Ver [[relatorio-funil-instrumentacao]].
- 0595 (0 venda) é canal compartilhado com outro projeto e foi parado em 02/11 — ver
  [[canal-0595-suspenso]].
- Conversão real pode ser subcontada onde o time esquece de etiquetar.
