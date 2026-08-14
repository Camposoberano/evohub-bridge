# Motor de fluxo conversacional

Manda, espera a resposta e ramifica. Construído em 12–14/08/2026 e validado ponta a ponta
em produção.

O que existia antes era linear: `resumeCampaign` percorria `camp.steps` num `for` e mandava
tudo de uma vez. Serve para uma sequência de apresentação; não serve para conversa.

---

## As peças

| Arquivo | Responsabilidade |
|---|---|
| `bridge/shared/flow.ts` | **Regra**: tipos de step, ramificação, validação. Puro — sem rede, sem banco. |
| `bridge/shared/flow-runner.ts` | **Envio**: executa até a espera, híbrido→oficial. Não escreve no banco. |
| `bridge/shared/flow-state.ts` | **Estado**: onde cada contato parou (`campaign_flow_state`). |
| `bridge/shared/flow-inbound.ts` | **Retomada e timeout**: a resposta continua o fluxo; a espera vencida segue sozinha. |
| `web/app/fluxos/page.jsx` | **Painel**: monta, desenha, valida e dispara. |

A separação entre `flow.ts` (decide para onde ir) e `flow-runner.ts` (envia) é proposital: a
regra é testável sem rede, e é o formato que o editor visual produz.

---

## Tipos de step

```ts
{
  id: string,
  kind: "text" | "media" | "buttons" | "list" | "wait" | "end",
  text?: string,
  media?: { type: "image"|"video"|"audio"|"document", url, fileName? },
  buttons?: [{ id, title }],        // máx. 3 (limite do WhatsApp)
  sections?: [{ title, rows }],     // máx. 10 linhas por seção
  imageUrl?: string,                // imagem acima dos botões
  minutes?: number,                 // kind=wait
  next?: string,                    // próximo quando não há ramificação
  branches?: { [botaoId]: stepId }, // resposta escolhe o caminho
  fallbackNext?: string,            // texto livre ou botão desconhecido
  timeoutMin?: number, onTimeout?: string,
  outcome?: "won" | "lost"          // kind=end
}
```

Áudio sai como **bolha de voz** (`ptt`): o runner converte para OGG/opus antes. Arquivo de
áudio comum tem taxa de escuta muito menor.

---

## As regras que não são óbvias

### Step alvo de ramificação começa um RAMO

Sem `next` declarado, o fluxo segue a **ordem da lista** — é o que o editor produz ao
empilhar mensagens. Mas para antes de um step que é destino de `branches`, `fallbackNext`
ou `onTimeout`.

Sem essa regra os ramos vazam. Aconteceu no primeiro teste real: num fluxo
`[oi, p, ok, ops, lembrete]`, quem clicou "Sim" recebeu `ok`, depois `ops` (a resposta do
"Não") e ainda o `lembrete` do timeout — três mensagens contraditórias juntas.

**Consequência ao montar:** um step de ramo que precisa continuar tem que declarar `next`
explicitamente. Foi o erro seguinte que cometi — os três textos de "necessidade" do fluxo de
reativação não tinham `next` e o lead nunca chegaria na isca.

### Texto livre não pode travar

Todo step de pergunta deve ter `fallbackNext`. No funil medido, o cliente **escreve 22×
mais do que clica** — quem digita não pode ficar preso esperando um clique.

### Ciclo sem pergunta é recusado

`A→B→A` sem pergunta no meio mandaria mensagem até a conta cair. `validateFlow` recusa ao
salvar, e `stepsUntilWait` para de qualquer jeito se um fluxo antigo já gravado tiver o
defeito.

### Espera sem saída é recusada

`timeoutMin` sem `onTimeout` deixaria o lead esperando para sempre. Quem não responde é a
maioria — o funil mede de 19% a 79% de resposta por fase.

---

## Como disparar

`POST /campaign` com JWT do painel:

```json
{
  "action": "start-fluxo",
  "channel_id": "<uuid do canal>",
  "instance": "<instância uazapi, opcional>",
  "numbers": ["5511999999999"],
  "delayMin": 5, "delayMax": 12,
  "flow": { "steps": [ ... ] }
}
```

Antes de falar com qualquer contato, o endpoint faz três coisas:

1. **`validateFlow`** — recusa o fluxo inteiro se houver ciclo ou destino órfão
2. **`checarProntidao`** — instância conectada e conta com permissão de iniciar conversa
   (é o `provider_code: 463`, que apareceria só no meio da lista)
3. **grava a campanha** — se o lead responder rápido, o webhook precisa achar o fluxo

Teto de 200 por chamada; `start-fluxo` é síncrono.

---

## O ciclo em produção

```
start-fluxo  →  runFlow até a pergunta  →  campaign_flow_state (waiting)
                                                    ↓
                         lead responde  →  webhook (hub OU uazapi)
                                                    ↓
                                       continueFlowOnReply
                                                    ↓
                                    resolveNext → runFlow → (waiting | done)

              lead NÃO responde  →  pumpFlowTimeouts (2min) → onTimeout
```

A retomada roda nos **dois** webhooks: fluxo que sai pela rota híbrida recebe a resposta
pelo uazapi, não pelo hub.

`continueFlowOnReply` **consome** a mensagem — o webhook não segue para as respostas
automáticas de intenção. Sem isso o lead responderia à pergunta do fluxo e receberia a
tabela de preço por cima.

O estado sai de `waiting` **antes** de enviar: cliques repetidos entravam todos como
válidos, e no primeiro teste real quatro toques viraram quatro execuções do mesmo ramo.

---

## Armadilhas de teste

**Clicar do número que RECEBE.** Clicar pelo WhatsApp da conta que envia gera
`fromMe: true`, e o bridge ignora — corretamente. Perdi um diagnóstico inteiro achando que
era bug do motor.

**Uma campanha em `waiting` por vez.** `findWaitingFlow` pega a mais recente; disparos
repetidos para o mesmo número deixam as anteriores órfãs.

---

## Estado e persistência

`public.campaign_flow_state`, uma linha por (campanha, contato), com `unique` — o upsert é
atômico, então respostas simultâneas não se atropelam.

> **Nome com prefixo de propósito.** `flow_state` colide com a tabela interna do Supabase
> Auth (`auth.flow_state`, estado de PKCE). `create table if not exists flow_state` sem
> qualificar schema encontra aquela pelo `search_path` e **não cria nada, em silêncio** — a
> migration "roda com sucesso" e a tabela nunca existe. Qualificar schema sempre.

---

## O que não existe ainda

- **Editor drag-and-drop.** O painel monta por JSON e desenha os caminhos; arrastar caixas
  exigiria biblioteca de canvas (React Flow) como dependência nova do painel.
- **Carrossel como step.** `hybridSendCarousel` existe (`shared/hybrid-extra.ts`), mas não
  há `kind: "carousel"` no fluxo.
- **Enquete como step.** Mesma situação — `hybridSendPoll` existe; a resposta chega como
  **voto**, não como clique de botão, então a retomada precisaria tratar esse formato.
- **Regra para campanhas concorrentes** no mesmo contato.
