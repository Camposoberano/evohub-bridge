# contactAuth — contrato do `/ai-gate`

Endpoint do bridge que o agente fazer.ai ("Vendedor Agro") consulta **antes de cada
resposta**. É o `contactAuth` do fazer.ai: o agente só fala se o gate autorizar.

- **Rota:** `POST https://cofre.camposoberano.com.br/ai-gate`
- **Implementação:** [`bridge/handlers/ai-gate.ts`](../bridge/handlers/ai-gate.ts)
- **Registro:** `server.ts` rota `"/ai-gate"` + feature `ai-lane-contact-auth-gate` em `version.features`.

## Autenticação

O fazer.ai injeta o `credentialRef` do vault como `Authorization: Bearer <segredo>`.
O bridge aceita **Bearer** ou **`?token=<segredo>`** na query, conferidos em **tempo
constante** (`confereSegredo`, `ai-gate.ts:48-52`) contra a env `AI_GATE_SECRET`.

- Sem `AI_GATE_SECRET` configurado, ou token errado → **HTTP 401** (fazer.ai lê como negado).
- Um `/ai-gate` aberto deixaria qualquer um soltar o bot, por isso nunca libera sem autenticar.

## Request

`POST application/json`:

```json
{
  "contact":      { "phone", "name", "email", "identifier", "chatwootContactId" },
  "conversation": { "id", "inboxId", "channel" },
  "message":      { "text" }
}
```

`message` só chega com `includeMessageText` ligado no agente. O gate usa hoje
`conversation.id`, `conversation.inboxId` e `contact.phone` (ou `contact.identifier`).

## Response

`2xx application/json`:

```json
{ "authorized": true }
{ "authorized": false, "reason": "<code>" }
```

`reason` é sempre um **código curto** (`/^[a-z0-9][a-z0-9._-]{0,63}$/i`) — o fazer.ai
descarta prosa.

## Regra de liberação

`authorized:true` **somente** quando as três condições valem:

1. O `inboxId` resolve para um canal no Supabase (`channels.chatwoot_inbox_id`).
2. O contato **não** está calado à mão — sem label `bot-off` (mesmo gate do
   determinístico, `isBotMutedForContact` / `bot-mute.ts`).
3. A conversa tem a label **`ai-vendas`** no Chatwoot (o estado da lane de IA).

## Códigos de negação

| `reason` | Situação |
|---|---|
| `no_conversation` | `conversation.id`/`inboxId` ausentes ou não numéricos → HTTP 400 lógico via `deny` |
| `no_channel` | `inboxId` não casa com nenhum canal |
| `bot_off` | contato com label `bot-off` (bot silenciado) |
| `not_in_ai_lane` | conversa sem a label `ai-vendas` |

## Fail-closed

Qualquer exceção (Supabase, Chatwoot, etc.) → **HTTP 500**. O fazer.ai conta 500 /
timeout / status inesperado como **ERRO**, não como negação: o agente **não responde** e
avisa o operador. A escolha é deliberada — silêncio é melhor que liberar/negar errado
numa falha transitória (`ai-gate.ts:88-93`).

Ver também: [`ai-lane-funil-agro.md`](ai-lane-funil-agro.md) (a feature que usa este gate).
