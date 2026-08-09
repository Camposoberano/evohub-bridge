# Templates de reativação — lista do Sul (2.368 números)

## Por que estes textos

A lista não é fria nem é base própria ativa: são pessoas que já falaram com a Campo Soberano,
mas por **outro número**. A divisão real (dono do WhatsApp de onde a lista foi exportada):

| Dono | Números do Sul | Situação do número |
|---|---|---|
| `5519998750595` (0595) | 1.719 (73%) | seu, mas **parado** — precisa aquecer antes de volume |
| `5519999715895` (5895) | 328 (14%) | ativo, já tem os 4 templates aprovados |
| sem dono no `raw` | 321 (13%) | origem desconhecida → tratar como primeiro contato |
| `5519971596836` (6836) | — | é quem **atende hoje**; só tem `boa_noite` aprovado |

**Regra de roteamento: cada lead recebe do número que ele conhece.** Trocar de número entre
toques é o que destrói a confiança — o próprio dono da operação apontou isso.

Os 321 sem dono e qualquer disparo pelo 6836 caem na variante **"primeiro contato"**, que se
apresenta em vez de fingir intimidade.

Botões escolhidos para casar com `bridge/shared/intent.ts` (`PRECO_RE`, `VIDEO_RE`,
`PLANTIO_RE`) — assim o toque do lead é roteado pelo bot sem depender de atendente.

---

## Variante A — para quem já conversou (0595 e 5895)

### A1. `retomada_sul` — primeiro toque
```
Fala meu amigo, aqui é o Cicero Sobreira, da Campo Soberano.

Faz um tempo que a gente conversou sobre o Mega Sorgo pra garantir trato no
cocho na seca. Passando pra saber se o senhor chegou a plantar ou se ficou
alguma duvida.

Me diz aqui embaixo o que faz mais sentido pro senhor agora.
```
Botões: `Ver preço` · `Ver vídeos` · `Falar com Cícero`

### A2. `convite_videos_sul` — segundo toque
```
Meu amigo, gravamos uns videos na lavoura mostrando o Mega Sorgo cortado,
a rebrota e o gado comendo. Da pra ver melhor do que eu explicar.

Quer que eu mande?
```
Botões: `Quero ver os vídeos` · `Ver preço` · `Não tenho interesse`

### A3. `duvida_tecnica_sul` — terceiro toque
```
Amigo, muita gente me pergunta do espacamento, de quantas sementes por
hectare e se da pra plantar a lanco.

Se ficou alguma duvida dessas ai na sua area, me fala que eu te explico
direitinho.
```
Botões: `Como plantar` · `Ver preço` · `Não tenho interesse`

### A4. `ultima_chamada_sul` — quarto toque
```
Meu amigo, é o Cicero da Campo Soberano. Nao quero ficar incomodando.

Se ainda fizer sentido pro senhor garantir silagem pra proxima seca, me
responde aqui que eu te ajudo. Se nao for a hora, sem problema nenhum.
```
Botões: `Ainda tenho interesse` · `Qual o preço` · `Não tenho interesse`

---

## Variante B — primeiro contato por este número (6836 e os 321 sem dono)

Mesmos ângulos, mas **se apresentando**. Não afirma conversa anterior — quem não lembra não
se sente enganado, e quem lembra reconhece o nome.

### B1. `apresentacao_sul`
```
Bom dia meu amigo, aqui é o Cicero Sobreira, da Campo Soberano.

Trabalho com a semente do Mega Sorgo, que passa de 5 metros e garante
silagem no cocho mesmo no ano seco. Estou falando com os produtores da
regiao que trabalham com gado.

O senhor mexe com leite ou com corte?
```
Botões: `Leite` · `Corte` · `Ver preço`

> A pergunta fechada no fim é de propósito: é a que mais gera resposta, e resposta abre a
> janela de 24h — daí todo o resto do funil sai sem custo.

---

## Como submeter

O bridge já tem o endpoint (`bridge/handlers/meta-templates.ts`), mas atenção: o default de
categoria é `MARKETING`, e é o correto para estes — são promocionais. Não rotular como
`UTILITY` para pagar menos: a Meta reclassifica e pode sinalizar a conta.

**Template é por WABA.** Cada número precisa dos seus:

| Número | WABA |
|---|---|
| 5895 | `743886211614541` |
| 6836 | `100191609666845` |
| 0595 | **descobrir** — `SELECT phone_number, waba_id FROM channels` |

Exemplo de submissão (repetir por template e por WABA):

```powershell
$body = @{
  name     = "retomada_sul"
  language = "pt_BR"
  category = "MARKETING"
  body     = "Fala meu amigo, aqui é o Cicero Sobreira, da Campo Soberano.`n`nFaz um tempo que a gente conversou sobre o Mega Sorgo pra garantir trato no cocho na seca. Passando pra saber se o senhor chegou a plantar ou se ficou alguma duvida.`n`nMe diz aqui embaixo o que faz mais sentido pro senhor agora."
  buttons  = @(@{text="Ver preço"}, @{text="Ver vídeos"}, @{text="Falar com Cícero"})
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Method POST -Uri "https://cofre.camposoberano.com.br/meta-templates?waba=100191609666845" `
  -Headers @{ "Content-Type" = "application/json" } -Body $body
```

Confirmar a aprovação (leva de minutos a horas):

```
GET /{waba_id}/message_templates?fields=name,language,status
```

---

## Depois de aprovado — o que muda no código

`bridge/shared/recovery-template.ts`, mapa `TEMPLATES_BY_WABA`: hoje o 6836 repete
`boa_noite` nas quatro variações, o que manda a mesma frase quatro vezes. Trocar por:

```ts
"100191609666845": {           // 6836
  1: "apresentacao_sul",
  2: "convite_videos_sul",
  3: "duvida_tecnica_sul",
  4: "ultima_chamada_sul",
},
```

E acrescentar a entrada da WABA do 0595 quando ela for descoberta.

## Ordem de execução

1. Submeter os templates (leva horas para aprovar — começar por aqui)
2. Descobrir a WABA do 0595 e se ele é canal oficial
3. **Aquecer o 0595** antes de qualquer volume: ele está parado, e número parado que dispara
   1.719 mensagens é o padrão que o WhatsApp bane. Subir devagar, priorizando quem responde
4. Começar pelos 328 do 5895 — número ativo, templates prontos, dono correto. É o lote que
   mede a taxa de reativação real sem arriscar nada
5. Escalar para 6836 e 0595 conforme a resposta do lote 1

## Aberto

- Texto exato do `boa_noite` e dos templates atuais do 5895 não foi verificado no WhatsApp
  Manager — pode haver sobreposição com o que está aqui
- Não há histórico de disparo desse tipo, então a taxa de resposta do lote 1 é o primeiro
  dado real; não estimar antes disso
