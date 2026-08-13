# Envio pela uazapi — referência conferida

Extraído de `docs.uazapi.com/openapi-bundled.json` (uazapiGO — WhatsApp API, 132 endpoints)
em 12/08/2026. Cada campo abaixo foi lido do schema, não de memória.

Base: a instância responde em `camposoberano.uazapi.com`; autenticação por header
`token: <token da instância>` (helpers em `bridge/shared/uazapi.ts`: `instGet`, `instPost`).

---

## 1. Antes de disparar — verificar a instância

Duas perguntas diferentes, as duas derrubam campanha:

| Endpoint | Responde |
|---|---|
| `GET /instance/status` | conexão: `disconnected` / `connecting` / `connected` / `hibernated` |
| `GET /instance/wa_messages_limits` | se a conta **pode iniciar novas conversas** |

O segundo é o que evita o erro `provider_code: 463`, que só aparece no meio do disparo —
quando metade da lista já foi queimada. Implementado em `checarProntidao()`
(`shared/hybrid-extra.ts`).

Relacionado: `POST /instance/updateDelaySettings` configura o intervalo entre mensagens da
fila assíncrona da própria uazapi.

---

## 2. Texto

`POST /send/text`

| Campo | Obrigatório | Nota |
|---|---|---|
| `number` | sim | só dígitos, com DDI |
| `text` | sim | aceita placeholders `{{name}}` |
| `linkPreview` | não | **liga o preview do link** |
| `linkPreviewTitle` / `linkPreviewDescription` / `linkPreviewImage` | não | preview personalizado |
| `linkPreviewLarge` | não | card grande com upload da imagem |
| `delay` | não | ms antes de enviar; mostra "digitando…" durante |

**Texto com link** é o mesmo endpoint: basta `linkPreview: true`. Os campos `linkPreview*`
permitem controlar título, descrição e imagem do card em vez de deixar o WhatsApp adivinhar.

---

## 3. Mídia — atenção ao áudio

`POST /send/media`

`type` aceita: `image` · `video` · `videoplay` · `document` · `audio` · `myaudio` · **`ptt`** ·
`ptv` · `sticker`

**`ptt` é a bolha de voz** (Push-To-Talk) — é o que faz parecer que o Cícero gravou na hora,
e tem taxa de escuta muito maior que arquivo de áudio. `audio` manda como arquivo anexado.
O bridge já converte para OGG/opus antes (`shared/audio.ts`, `toVoiceOgg`) e envia com
`type: "ptt"` (`hybridSendMedia`, quando `isVoice`).

| Campo | Nota |
|---|---|
| `file` | URL **ou** base64 |
| `text` | legenda (não se aplica a `ptt`) |
| `docName` | nome do arquivo — **só para `document`** |
| `thumbnail` | miniatura personalizada de vídeo/documento |
| `mimetype` | opcional, detectado sozinho |
| `viewOnce` | visualização única |

> **Corrigido em 12/08:** o bridge mandava `fileName` para documento. O campo correto é
> `docName` — com o nome errado o documento chegava sem nome.

---

## 4. Menus interativos — os quatro tipos

`POST /send/menu` cobre os quatro num endpoint só, mudando `type`:

| `type` | Formato | Campo das opções |
|---|---|---|
| `button` | até 3 botões de resposta rápida | `choices: ["Sim","Não"]` |
| `list` | menu com seções | `choices: ["[Seção]","texto\|id\|descrição"]` |
| `poll` | enquete com votação | `choices` + `selectableCount` |
| `carousel` | cartões horizontais com botões | `choices` (formato próprio) |

Campos comuns: `number`, `text` (obrigatórios), `footerText`, `listButton` (rótulo do botão
que abre a lista), `imageButton`, `delay`.

**Com e sem imagem:** `imageButton` é a URL da imagem exibida acima dos botões — recomendada
para `type: button`. Omitir manda sem imagem. No carrossel, a imagem é por cartão.

**Sintaxe de `choices` em lista** (confirmada em `shared/hybrid-list.ts`):
`"[Título da Seção]"` abre uma seção; `"texto|id|descrição"` é uma linha, com `id` e
`descrição` opcionais. Limite do WhatsApp: **10 linhas por seção**.

**Enquete** (`poll`): `selectableCount: 1` é escolha única. A resposta chega como **voto**,
não como clique de botão — quem consome precisa tratar os dois formatos.

### Carrossel — endpoint alternativo

`POST /send/carousel` faz o mesmo que `type: carousel`, com payload mais legível:

```json
{
  "number": "5549...",
  "text": "Nossos produtos",
  "carousel": [
    { "text": "Mega Sorgo 2kg\nRende 1 hectare",
      "image": "https://.../saco2kg.jpg",
      "buttons": [{ "id": "preco_2kg", "text": "Ver preço" }] }
  ]
}
```

Cada cartão aceita `image` **ou** `video` **ou** `document` (+ `filename`), e tem os
**próprios botões** — é o formato certo para catálogo, onde a lista obriga o contato a abrir
um menu antes de ver qualquer coisa.

---

## 5. Pagamento

| Endpoint | Uso |
|---|---|
| `POST /send/pix-button` | botão PIX simples: recebedor, chave, valor no app |
| `POST /send/request-payment` | fluxo "Revisar e pagar" com valor, item e nota |

**`pix-button`** exige `pixType` (`CPF`/`CNPJ`/`PHONE`/`EMAIL`/`EVP`), `pixKey`, e aceita
`pixName` (padrão "Pix" se vazio).

**`request-payment`** exige `amount`; aceita `title`, `text`, `footer`, `itemName`,
`invoiceNumber`, e combina formas de pagamento: PIX (`pixKey`+`pixType`), boleto
(`boletoCode`, com `fileUrl`/`fileName` para anexar o PDF) e link de checkout
(`paymentLink`).

> `paymentLink` **só funciona com domínio homologado na Meta**. Link de gateway qualquer é
> recusado — vale conferir antes de montar o fluxo em cima disso.

---

## 6. Campos comuns a todos os envios

Valem em `/send/*`: `delay` (ms, mostra "digitando…"), `readchat`, `readmessages`,
`replyid` (responder mensagem específica), `mentions`, `forward`, `async` (enfileira em vez
de enviar na hora), `track_source` e `track_id` (rastreamento — o projeto usa `chatwoot`
como origem).

`async: true` é relevante para disparo: entrega para a fila interna da uazapi em vez de
esperar o envio, o que evita segurar a request. O contrapeso é que o resultado real não
volta na resposta.

---

## 7. O que existe no bridge hoje

| Função | Arquivo | Endpoint |
|---|---|---|
| `hybridSendText` | `shared/hybrid.ts` | `/send/text` |
| `hybridSendMedia` | `shared/hybrid.ts` | `/send/media` (áudio → `ptt`) |
| `hybridSendMenu` | `shared/hybrid.ts` | `/send/menu` type `button` |
| `hybridSendList` | `shared/hybrid.ts` | `/send/menu` type `list` |
| `hybridSendPoll` | `shared/hybrid-extra.ts` | `/send/menu` type `poll` |
| `hybridSendCarousel` | `shared/hybrid-extra.ts` | `/send/carousel` |
| `hybridSendPixButton` | `shared/hybrid-extra.ts` | `/send/pix-button` |
| `hybridRequestPayment` | `shared/hybrid-extra.ts` | `/send/request-payment` |
| `checarProntidao` | `shared/hybrid-extra.ts` | `/instance/status` + `/instance/wa_messages_limits` |

**Diferença importante entre os dois arquivos:** em `hybrid.ts` tudo tem fallback para o
canal oficial da Meta, porque texto, mídia, botões e lista existem nos dois lados. Em
`hybrid-extra.ts` **não há fallback** — a Meta não tem equivalente a enquete, carrossel nativo,
botão PIX nem solicitação de pagamento. Sem rota uazapi, essas funções devolvem `null` e o
chamador decide se pula o contato ou manda outro formato.

---

## 8. Não coberto aqui

- **Presença** (`/message/presence`, `/instance/presence`): existe, ficou de fora por decisão.
- **Envio em massa nativo** (`/sender/simple`, `/sender/advanced`): a uazapi tem motor de
  campanha próprio. O projeto usa o seu, que já tem as travas de horário, teto e
  bot-off — migrar significaria perder isso.
- **Localização, contato, status/stories**: existem, sem uso previsto.
