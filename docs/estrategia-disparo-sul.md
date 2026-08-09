# Disparo para a base do Sul — auditoria e estratégia

Levantado em 08–09/08/2026. Tudo aqui saiu de consulta ao banco de produção; onde não há
dado, está dito que não há.

---

## 1. O que é a base

**2.372 números no Sul**, 2.368 com WhatsApp confirmado. A UF vem do DDD — `clientes` não
tem coluna de estado.

| UF | Total | Com WhatsApp |
|---|---|---|
| RS | 1.061 | 1.060 |
| PR | 720 | 718 |
| SC | 591 | 590 |

> O plano anterior (handoff de 07/08) falava em "RS+SC, 1.643 alvos". **Faltava o Paraná** —
> 720 números, 30% da base, fora do radar.

### Cuidado ao classificar por DDD

`substring(phone, 3, 2)` **está errado**. `bridge/shared/ddd.ts:20` explica: o código do país
é removido **por tamanho**, não assumindo prefixo `55`, porque *DDD 55 é Rio Grande do Sul* e
um número de RS sem código de país também começa com 55. Qualquer query de região precisa
replicar `ufFromPhone`:

```sql
CASE WHEN length(digitos) IN (12,13) THEN substring(digitos, 3) ELSE digitos END
-- depois: DDD = primeiros 2; válido só se o resto tiver 10 ou 11 dígitos
```

---

## 2. Quem são essas pessoas

### Relacionamento: existe, mas fora do sistema

| Situação (cruzando com `contacts`/`conversations`) | Números |
|---|---|
| Sem conversa registrada no bridge | 2.291 (97%) |
| Conversou pelo 5895 | 72 |
| Conversou pelo 6836 | 4 |

**"Sem conversa registrada" não significa "nunca falamos".** Significa que nada passou pelo
bridge. O dono da operação confirma que já conversou com essa gente — foi antes do sistema
existir, pelo celular. Não existe registro digital consultável disso.

Consequência prática: **não é lista fria** (tolerância e taxa de resposta maiores), mas
**não há dado que prove quem conhece qual número**.

### O dono do WhatsApp de origem

O campo `raw->>'owner'` diz de qual aparelho a lista foi exportada — é o melhor proxy de
"quem essa pessoa conhece":

| Dono | Números do Sul | Situação |
|---|---|---|
| `5519998750595` (0595) | **1.719 (73%)** | é da casa, mas **parado** |
| `5519999715895` (5895) | 328 (14%) | ativo, 4 templates aprovados |
| sem `owner` no raw | 321 (13%) | origem desconhecida |
| `5519971596836` (6836) | — | **é quem atende hoje**; só `boa_noite` aprovado |

`source_number = 6836` aparece em 2.291 registros, mas **é rastro de enriquecimento** (qual
instância uazapi checou se o número tem WhatsApp), **não de conversa**. Não usar como prova
de relacionamento — foi o erro que quase mandou 1.719 mensagens do número errado.

### Qualidade e janela de contato

- 100% com WhatsApp, ~86% com foto — lista já filtrada na origem
- `common_groups` é **NULL em todos os 2.372**: nunca foi medido, e como a foto veio da mesma
  fase do enriquecimento, provavelmente a uazapi não devolve esse campo. Tratar como
  indisponível, não como zero.
- Nomes são **mistos**: uns reais com etiqueta do WhatsApp Business (`TALIMAQ`, `Jonas📍`,
  `wa_label: ["5519999715895:7"]`), outros genéricos (`cliente 72312 -`). Etiqueta indica
  atendimento real; nome genérico indica contato salvo em massa.
- **Ninguém está no balde "falamos há mais de 60 dias"** — todo contato registrado é recente.
  Não existe grupo morno para reabordar; a operação é nova demais.

---

## 3. Modelo de custo da Meta

Cobrança **por mensagem** (modelo vigente desde 2025). Da mais barata para a mais cara:

| Tipo | Custo |
|---|---|
| Service (resposta dentro da janela aberta) | grátis |
| Free entry point — clique em anúncio CTWA abre **72h** | grátis dentro da janela |
| Utility template | mais barato; grátis com janela de serviço aberta |
| Marketing template | sempre cobrado |

Valores exatos não estão documentados aqui de propósito: mudam por país e por data. O número
vigente está em **Business Manager → WhatsApp Manager → Insights**.

### O princípio que baixa a conta

**Você paga o template, não a conversa que vem depois.** O template não deve carregar
conteúdo — deve comprar uma resposta. Resposta abre 24h de janela, e dentro dela áudio,
imagem, tabela de preço e o funil inteiro saem de graça.

Padrão caro: mandar as 5 fases por template = 5 cobranças por lead.
Padrão barato: 1 template curto com botão → toque → tudo o mais grátis.

### O que o projeto já acerta

`bridge/shared/window.ts` implementa 24h/72h corretamente, e o funil de 5 fases roda em
~45,6h úteis (`GAPS = [0, 1800, 21600, 43200, 43200]` segundos úteis) — **cabe dentro das 72h
do CTWA**. Para lead de anúncio, o funil inteiro é gratuito.

### Onde ainda se paga à toa

1. `bridge/handlers/meta-templates.ts:48` — `category` default é `MARKETING`, o mais caro.
   Templates genuinamente transacionais (rastreio, confirmação) deveriam ser `UTILITY`.
   **Não** rotular marketing como utility para pagar menos: a Meta reclassifica e pode
   sinalizar a conta.
2. `bridge/handlers/funil-control.ts:496` — quando a janela fecha, `dispatchRecovery` vai
   **direto para o template pago**, sem tentar a rota híbrida (ver abaixo).

---

## 4. Infraestrutura que já existe

Nada disso precisa ser construído.

### Rota híbrida (`bridge/shared/hybrid.ts`)

Auto-discovery: cruza o `phone_number` do canal oficial com instâncias conectadas no uazapi.
Mesmo número nos dois → mensagem de serviço sai pelo não-oficial; template sempre pela
oficial; fallback automático para `sendMeta` se o uazapi cair. Monta botões e listas
(`hybrid-menu.ts`, `hybrid-list.ts`).

**Ganho real:** canal não-oficial **não tem janela** (`window.ts` devolve `sem-janela` sem
`phone_number_id`). Fora da janela, em vez de template pago, a mensagem sai de graça.

**Provavelmente desligado** — exige `HYBRID_CHANNEL_ALLOWLIST` ou `HYBRID_INSTANCE_ALLOWLIST`;
sem isso loga `hybrid: rota desativada`.

**Risco:** coexistência põe o mesmo número no oficial e no não-oficial. Ban atinge o número e
derruba o canal oficial junto.

### Cadeia de recuperação (`bridge/shared/recovery-chain.ts`)

Já é um motor de disparo inteligente, apontado para a base interna:

| Componente | Onde |
|---|---|
| Teto por rodada | `RECOVERY_CHAIN_MAX_PER_ROUND` (5) |
| Janela de horário | `withinRecoveryHours`, 8h–20h BRT |
| Gap entre toques | `GAP_MINIMO_MS`, 20h |
| 4 variações | `RECOVERY_CHAIN_DAYS = [1,2,4,7]` |
| Para quando o lead responde | `emAtendimento`, `isClosedOutcome` |
| Não insiste em quem sumiu | `IDADE_MAXIMA_MS`, 30 dias |

Generalizar para consumir lista externa é adaptação, não construção.

### Templates com botão

`bridge/shared/recovery-template.ts` — o 5895 (WABA `743886211614541`) tem os quatro ângulos
aprovados, com botões que casam com `PRECO_RE`, `VIDEO_RE` e `PLANTIO_RE` do `intent.ts`. O
toque do lead é roteado pelo bot **sem atendente**.

O 6836 (WABA `100191609666845`) tem **um só**, `boa_noite`, repetido nas quatro variações —
mandaria a mesma frase quatro vezes.

---

## 5. Estratégia

### Regra que não se negocia

**Cada lead recebe sempre do número que o conhece.** Rotacionar entre toques destrói a
confiança, que é o que faz essa lista valer mais que uma comprada. Roteamento por
`raw->>'owner'`.

### Sequência

1. **Submeter os templates** (`docs/templates-reativacao-sul.md`) — aprovação leva horas, é o
   caminho crítico
2. **Lote 1: os 328 do 5895** — número ativo, templates prontos, dono correto. Mede a taxa
   real de reativação sem arriscar nada
3. **Aquecer o 0595 em paralelo** — carrega 73% da base mas está parado; número parado que
   dispara 1.719 mensagens é o padrão que o WhatsApp bane. Subir devagar, priorizando quem
   responde
4. **6836 leva os 321 sem dono**, com a variante que se apresenta
5. **Escalar** conforme a resposta do lote 1

### Excluir sempre

- 4 que já compraram (todos RS) — template frio em cliente queima a relação
- 1 que disse não
- 70 com conversa nos últimos 60 dias — são conversas vivas; se há o que fazer, é atendimento
  humano, não template

### Volume

Não usar os 300/dia do plano antigo. Começar pequeno e medir. A cadeia de recuperação está
ligada desde 08/08 consumindo os mesmos números — disparo soma na mesma nota de qualidade.

---

## 6. Riscos

| Risco | Mitigação |
|---|---|
| 0595 parado + volume alto = ban | aquecimento gradual antes de qualquer lote grande |
| Coexistência (híbrido) derruba o oficial junto | usar híbrido só no principal com volume humano; frio por instância separada |
| Repetir `boa_noite` 4× no 6836 | aprovar os quatro templates antes de usá-lo |
| Nota de qualidade já pressionada pela recuperação | conferir no Business Manager antes de somar disparo |
| Lead recebe de número que não conhece | roteamento por `owner`, variante "primeiro contato" para os sem dono |

---

## 7. Aberto

- **WABA do 0595** — `SELECT phone_number, waba_id FROM channels`. Se não tiver
  `phone_number_id`, não é canal oficial e não manda template.
- **Texto real dos templates aprovados** (5895 e `boa_noite`) — só o nome está no código; o
  conteúdo precisa ser lido no WhatsApp Manager antes de duplicar.
- **Nota de qualidade atual** dos números, pós-recuperação.
- **Custo vigente** de template marketing no Brasil.
- **Não existe código de disparo em massa.** A recuperação usa o canal da conversa existente
  (`resolveChannelAndContact`); para os 2.291 sem conversa, é preciso criar a conversa já
  apontando para o número certo, com teto diário por número.

---

## Anexo — erros cometidos nesta auditoria

Registrados porque cada um quase virou decisão errada:

1. **Filtrei só RS e SC** porque o handoff dizia isso. Faltava o PR (720 números).
2. **Usei `substring(phone,3,2)`** para o DDD, que quebra em número sem código de país — o
   próprio `ddd.ts` documenta a armadilha.
3. **Conclui "zero contatos em comum = lista fria sem conexão"** quando `common_groups` era
   simplesmente NULL. Contagem com `FILTER (WHERE col > 0)` não distingue "zero" de "nunca
   medido".
4. **Afirmei que o bot só ouve clique.** Falso no WhatsApp: `isPrecoIntent` já trata texto e
   áudio. `fb-ig-sem-automacao` fala de FB/IG — generalizei indevidamente.
5. **Recomendei número secundário** para o disparo, até o dono apontar que trocar de número
   destrói a confiança. Ele estava certo.
6. **Tratei `source_number` como prova de relacionamento**; é rastro de enriquecimento. O
   `raw->>'owner'` é que aponta o dono real — e mostrou um terceiro número (0595) com 73%
   da base.
