# Codex handoff — consertar PDF duplicado da isca + rodar a sequência

Brief auto-contido. Você (Codex) não tem o histórico do chat anterior; está tudo aqui.

## Stack (essencial)
- **Bridge**: Deno HTTP server em `bridge/server.ts`. Deploy via Coolify (`cofre.camposoberano.com.br`).
  Trabalha em `master`; deploy = `git push origin <branch>:master` **e depois** `POST {COOLIFY_URL}/deploy?uuid=<SERVIDOR_UUID>` (push NÃO dispara deploy sozinho).
  - `COOLIFY_URL=https://painelgeral.camposoberano.com.br/api/v1`, token em `.env` (`$COOLIFY_TOKEN`), **SERVIDOR_UUID=`m8qf6ru2x75gukzozpsrssrm`**.
  - Confirmar deploy por `uptime_s` baixo em `https://cofre.camposoberano.com.br/version` (bumpar `build` em `server.ts` p/ ter prova).
- **DB**: Supabase self-host (PostgREST). Credenciais em `E:\Projetos_Novos\evohub\.env` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, schema `public`). **Nunca commitar segredo.**
- **Canal 5895** = **híbrido**: WhatsApp oficial (Meta, `phone_number_id=956105997592428`, `waba_id=743886211614541`) **+** instância uazapi (`owner=5519999715895`, connected) **+** Chatwoot nativo. É a origem da duplicação.
- **Teste**: `deno test --allow-all --node-modules-dir=none bridge/tests/` (362 passando hoje).
- **`deno check --node-modules-dir=none <arquivo>`** antes de commitar.

## O bug (PRIORIDADE 1)

A isca digital ("Quer o material grátis da Embrapa? [Quero o material][Agora não]") entrega um **PDF** quando o lead toca "Quero o material". No **canal híbrido 5895 o PDF chega 2–3×** e com ~2 min de atraso.

**Evidência (teste real ao 5511910363320 em 23/09 04:26 UTC), tabela `messages`:**
```
04:26:31 out document  sent  meta=wamid.HBgN...              content="[isca silagem] Silagem-de-Sorgo-Embrapa.pdf"   <- envio OFICIAL (correto, 1×)
04:26:32 in  interactive     meta=5519999715895:A5AAF77E    content="Quero o material 📩"                          <- o toque, via uazapi
04:26:44 out document  sent  meta=5519999715895:CEE8EF70    content="📚 *Material gratuito*..."                    <- RE-ENVIO uazapi
04:26:51 out document  sent  meta=5519999715895:3EB0D679    content="📚 *Material gratuito*..."                    <- RE-ENVIO uazapi
```
Log do bridge no mesmo instante:
```
uazapi-webhook: clique processado menu_isca_silagem …3320
hybrid-media-req: /send/media {"number":"5511910363320","file":"https://gerenciador.soberano.pro/rails/active_storage/blobs/.../documento.pdf","type":"document","text":"📚 *Material gratuito*...","docName":"arquivo"}
```

**Causa:** `handleIscaSequence` (em `bridge/handlers/hub-webhook.ts`) manda o PDF por `sendMeta` cru (rota oficial) e cria a mensagem no Chatwoot. Como o 5895 é híbrido, o **`sync-chatwoot-out`** (pull-loop, `bridge/handlers/sync-chatwoot-out.ts` / `bridge/shared/`) vê o documento no Chatwoot e **re-envia pela uazapi** (`hybridSendMedia` → `/send/media`, usando o blob ActiveStorage do Chatwoot) — e disparou **2×**. O `claimDailyTag` que existe no `handleMenuClick` só protege o lado oficial; o relay do Chatwoot-out passa por fora.

Regra do projeto (CLAUDE.md): *toda mensagem registrada no Chatwoot DEVE capturar `chatwoot_message_id` do response e gravar em `messages` p/ prevenir duplicação pelo pull-loop.* Investigar por que a dedup não cobriu o documento aqui (o `messages` de :31 tem content `[isca silagem]`, mas os re-envios têm content = a legenda — o pull-loop casa por `chatwoot_message_id`, não por content; ver se o attachment do Chatwoot gerou uma msg SEM linha correspondente em `messages`, ou se o `sync-chatwoot-out` reenvia por não achar o par).

## A correção (o que fazer)

Objetivo: **1 cópia só** do PDF no híbrido, e sem os 2 min de atraso.

1. Ler `handleIscaSequence` em `bridge/handlers/hub-webhook.ts` (função async que envia `type:"document"` via `sendMeta`). Ler também `bridge/shared/iscas.ts` (registro `ISCAS`, `matchIsca`), `bridge/shared/hybrid.ts` (`getHybridRoute`, `hybridSendMedia`, `isHybridRecipient`) e `bridge/handlers/sync-chatwoot-out.ts`.
2. Fazer a isca **entregar pela rota híbrida quando o contato é híbrido** (mesma lógica que o funil já usa p/ mídia): resolver `getHybridRoute`/`isHybridRecipient`; se híbrido → `hybridSendMedia` (uma via, uazapi, sem janela → mata o atraso); senão → `sendMeta` oficial. E **garantir que o registro no Chatwoot/`messages` não seja re-disparado** pelo `sync-chatwoot-out` (capturar `chatwoot_message_id` OU marcar a saída como já-enviada, seguindo o padrão das outras saídas do funil que NÃO duplicam).
3. Conferir se `handleNutricaoSequence` e `handlePlantioSequence` (mesmo arquivo, mesmo padrão `sendMeta` cru de PDF) têm o mesmo furo no híbrido — provavelmente sim. Corrigir junto se for barato.

## Como testar (obrigatório antes de escalar)
1. `deno check` + `deno test --allow-all --node-modules-dir=none bridge/tests/` (verde).
2. Deploy no SERVIDOR (bump `build` em `server.ts`, push, `POST /deploy`, confirmar `/version`).
3. Enviar a **oferta** pela uazapi 5895 ao número de teste **5511910363320** (endpoint uazapi `POST {UAZAPI_URL}/send/menu`, header `token:<instância 5895>`, body `{"number":"5511910363320","type":"button","text":"<pergunta>","choices":["Quero o material 📩","Agora não"],"imageButton":"<url capa>","readchat":true}`). Token da instância: `GET {UAZAPI_URL}/instance/all` header `admintoken:$UAZAPI_ADMIN_TOKEN`, achar `owner=5519999715895`.
4. Tocar "Quero o material 📩". **Conferir em `messages` que saiu 1 (UM) documento só** (não 3), rápido. Query: `messages` where content ilike `%isca%` OR msg_type=document, últimos min, na conversa do 3320.

## Sequência / campanha (PRIORIDADE 2 — só depois do fix testado)

Combinado com o dono: distribuir o PDF da Embrapa pros **1.253 leads frios Sul+Sudeste** do 5895, **SEM template** (via uazapi 5895), ritmo **50/dia, +5/dia, só 8h–20h BRT**. Depois testar o **template** oficial no 6836.

- Lista: `5895-sul-sudeste-1253.csv` (telefone E.164 + nome + UF; já sem pago/não-compra/safrinha). SP 371, MG 368, RS 153, PR 127, RJ 106, SC 87, ES 41.
- Mecanismo que faz 50/dia+5 e 8h–20h **sozinho** = fila/fluxo: `bridge/shared/campaign-queue.ts` (`enfileirar`) + `bridge/shared/campaign-pace.ts` (`dentroDaJanela`, `capDoDia`) + o loop de 1min em `server.ts`. Campanha mora em `campaigns.json` no Storage `soberano-config`. Montar um `flow` (`bridge/shared/flow.ts`: kinds text/media/buttons/list/end) = oferta (buttons, imageUrl=capa, [Quero o material][Agora não]) → branch "quero"=media document (PDF) → end; "nao"=text ack → end. Criar campanha com `pace {capInicial:50,capIncremento:5,capMaximo:1253,horaInicio:8,horaFim:20}` e `enfileirar` os 1.253 no canal 5895. O loop só dispara dentro de 8h–20h; enfileirar de madrugada NÃO dispara — começa 8h.
- ⚠️ o `flow` NÃO aplica etiqueta Chatwoot (só o `handleIscaSequence` aplica `interesse-silagem`) — decidir com o dono se precisa.

## ⛔ Regras que não podem ser violadas
- **Disparo SÓ entre 8h e 20h BRT.** O disparo oficial (`/campanhas` ação `start`, `bridge/handlers/campaign.ts`) é síncrono e **NÃO checa horário** — nunca disparar frio de madrugada. (23/09 saíram 33 templates à 1h por engano; foi cortado com restart do SERVIDOR.)
- **Gate comercial**: quem tem etiqueta `pago`/`não compra` NÃO recebe. O loop da fila já checa `bloqueioPorContato`. Manter.
- **Nada de disparo em massa novo sem o dono autorizar o lote.** Testar sempre num número (3320) antes de escalar.
- Não commitar segredo; ler tudo de `.env`.

## Estado atual do repo
- Branch de trabalho: `claude/isca-digital` = `origin/master` = `8e6eb01`. Árvore limpa.
- Build no ar: `2026-09-21-isca-oferta-rota` (features `isca-digital-fim-funil`, `isca-oferta-imagem-sim-nao`).
- A isca (oferta com imagem + Sim/Não) já está no ar e a oferta funciona; **só a entrega do PDF duplica** — é o que consertar.
