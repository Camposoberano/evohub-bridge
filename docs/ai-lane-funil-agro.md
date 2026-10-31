# Lane de IA (fazer.ai) no funil agro

> Feature introduzida no commit `1d3d103`. **Desligada por padrão** (`AI_LANE_ENABLED`).

## O que é

O funil agro é **determinístico**: templates, botões, campanha, recovery e fechamento
são donos de tudo. Sobra um caso que o funil fixo não converte — **texto livre** do lead
que não casa com nenhuma porta determinística (preço, vídeo, plantio, nutrição, fluxo,
menu). A lane de IA entrega **só esse texto livre** ao agente fazer.ai "Vendedor Agro".

Decisão de boundary (2026-10-28): a IA **não** toca no determinístico. Ela só assume o
texto livre órfão; botão/fluxo/campanha/fechamento continuam exatamente como eram.

## Estado = label `ai-vendas` no Chatwoot

O estado da lane é a label **`ai-vendas`** numa conversa do Chatwoot — fonte da verdade,
visível pro operador (`ai-lane.ts:19`). Entrar na lane = adicionar a label; sair = remover.
Não há flag/coluna paralela.

- `enterAiLane` / `exitAiLane` — set/unset da label, preservando as demais. **Não lançam**:
  falhar aqui não pode derrubar o atendimento (`ai-lane.ts:42,61`).
- `routeContactToAiLane` — resolve a conversa ativa (não resolvida) do contato e entra na
  lane (`ai-lane.ts:104`).

## Fluxo

```
Lead manda texto livre
   → webhook (oficial hub-webhook / não-oficial uazapi-webhook)
   → casou com porta determinística?  SIM → funil fixo (sem mudança)
                                      NÃO → AI_LANE_ENABLED?  NÃO → nada
                                                             SIM → routeContactToAiLane → label ai-vendas
   → agente fazer.ai consulta POST /ai-gate antes de responder
   → gate: canal existe + não bot-off + tem label ai-vendas  → authorized:true → agente responde
Fechamento/handoff humano (Cícero) → exitAiLane (tira a label)
```

## Pontos de integração (boundary)

| Local | O que faz |
|---|---|
| `bridge/handlers/hub-webhook.ts:645-651` | Oficial: texto livre sem `detectedIntent` + flag ON → `routeContactToAiLane` |
| `bridge/handlers/hub-webhook.ts:638` (contexto fechamento) | Fechamento → `exitAiLane` (daqui é humano) |
| `bridge/handlers/uazapi-webhook.ts:479-489` | Não-oficial: mesmo boundary — `!intent` + flag ON → `routeContactToAiLane` |
| `bridge/handlers/ai-gate.ts` | `/ai-gate` (contactAuth) — ver [`contact-auth.md`](contact-auth.md) |
| `bridge/shared/ai-lane.ts` | Core: label, flag, helpers puros, enter/exit/route |

## Flag de deploy

```
AI_LANE_ENABLED   # "1" ou "true" liga; qualquer outra coisa (default) = OFF
```

Com a flag OFF o funil determinístico fica **idêntico** ao de antes — a lane é inerte.

## Wiring externo pendente (pra ligar de verdade)

Ligar só `AI_LANE_ENABLED` **não basta** — sem o agente respondendo, a label é setada e
ninguém fala ("lead no vácuo", alerta em `ai-lane.ts:21-22`). Antes de ligar:

1. Conectar o Chatwoot do agro ao fazer.ai (instância/inbox).
2. Bindar o agente **"Vendedor Agro"** na inbox do funil agro.
3. Setar `AI_GATE_SECRET` no env do bridge (Coolify) — ver [`contact-auth.md`](contact-auth.md).
4. Configurar o `contactAuth` do agente apontando pra `https://cofre.camposoberano.com.br/ai-gate`
   com o mesmo segredo (credentialRef do vault → Bearer).
5. Só então `AI_LANE_ENABLED=1` + restart do bridge (respeitar a janela: **não** reiniciar 8-20h BRT).

## Gaps conhecidos

- `routeContactToAiLane` devolve **`false` silencioso** se a conversa ainda não tem
  `chatwoot_conversation_id` (`ai-lane.ts:111`) — se o texto livre chega antes de a conversa
  ter id do Chatwoot, o contato não entra na lane naquele turno.
- Testes (`bridge/tests/ai-lane.test.ts`) cobrem **só os helpers puros** e a leitura da flag.
  `enterAiLane`/`exitAiLane`/`/ai-gate` (I/O Chatwoot/Supabase) não têm cobertura.
- Sem o wiring externo acima, a feature é inerte mesmo com a flag ligada.

## Env vars

Ver `.env.example`:

```
AI_LANE_ENABLED=0
AI_GATE_SECRET=
```
