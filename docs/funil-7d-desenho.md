# Funil mega-sorgo de 7 dias — desenho pra ocupar o funil principal (v2)

> Base: banco self-host (`bancortovital.soberano.pro`, schema `public`), lido 2026-11-14.
> Objetivo: o funil de 7 dias (`mega-sorgo-7d-v1`) assumir o lugar do funil principal (jornada
> `mega-sorgo`), **cobrindo os gargalos do principal**.
> Decisões do dono (2026-11-14): (1) manter ~33 peças, espalhadas em 7 dias reais; (2) o funil
> **quota pacote fixo** (2/4/10/20 kg); (3) handoff em **todo sinal de compra, na hora**; (4) espinha
> de conteúdo **prova → medo → oferta**.

## 0. FALHAS ENCONTRADAS no funil atual (bloqueiam o go-live) — auditoria 2026-11-14
Auditoria do comportamento real (código + payloads do 7d-v1 no banco). O funil **parece** fechado,
mas tem buracos que deixam o cliente sem resposta:

1. **Botões de avanço do funil não têm handler → clique no vazio (FURO Nº1).**
   Os botões `f1_sim`/`f1_olhando`/`f1_continuar`, `f2_leite`/`f2_corte`/`f2_ambos`/`f2_continuar`,
   `f3_milho`/`f3_capim`/`f3_nao`/`f3_continuar`, `f4_ja`/`f4_nunca`/`f4_continuar` **não existem em
   nenhum lugar do código**. `handleUazapiClick` (`uazapi-webhook.ts:435-437`) só trata
   `menu_`/`preco_`/`tam_`/`pag_`/`plantio_`/`nutricao_`/catálogo; o resto cai em
   `"clique sem handler" → return`. O 2º caminho (`continueFlowOnReply`, `flow-inbound.ts:199,212`)
   lê `campaign_flow_state` — e o 7d-v1 é drip em `sales_sequences`, **não tem esse estado** → false.
   **Efeito:** cliente clica "Quero saber mais ✅" / "Leite 🥛" / "Já sim 😔" → **silêncio**, e a
   resposta de qualificação é jogada fora. **Só os botões `menu_*` respondem.**

2. **Resposta do lead NÃO para o drip (nome do funil não casa).** `inbound.ts:531-549` marca
   `replied` + cancela as peças pendentes — mas filtrado por `funnel="mega-sorgo"`. O funil é
   `mega-sorgo-7d-v1` → **não casa** → as 33 peças seguem vindo por cima da resposta do cliente.

3. **Preço: comportamento diferente conforme como o cliente pede.**
   - Por **texto/áudio** → `handleUazapiIntent` (`uazapi-webhook.ts:469-499`) chama `autoPauseFunil`
     (pausa o drip — funciona por `conversation_id`) **e** dispara o preço. ✅
   - Por **botão `menu_preco`** → dispara o preço **mas NÃO pausa o drip** (`handleMenuClick` não
     chama `autoPause`, e o cancel do inbound não casa o nome). → **preço sai + funil continua**.
   - **2º pedido de preço no mesmo dia** → `handleMenuClick` devolve `already-sent-today` e o retorno
     é **ignorado** no caminho uazapi (`uazapi-webhook.ts:420`) → **silêncio** (sem o fast-track pro
     Cícero que a memória prometia — `preco-sem-numero-fast-track`; conferir se o commit sobreviveu).

4. **Janela = 06:00–21:55 BRT, não 08-20.** `business-hours.ts:5-17`. Peça fora da janela é
   **segurada** e deslocada pra dentro do expediente (anti-lote `funnel-queue.ts:39-95`) — isso está
   OK. Mas o número diverge do desenho; e a recovery-chain usa OUTRA janela (08-20). **Fixar uma.**

5. **Turbo:** no teste (09/11) as 33 peças saíram em **40 min** (modo turbo). Confirmar turbo OFF em
   produção, senão "7 dias" vira 40 minutos.

**Único CTA 100% são:** `menu_humano` → `handleMenuClick`→`handleHumanRequest`+`registrarPedidoHumano`
+ pausa (`hub-webhook.ts:3259-3268,3377-3385`), nos dois canais.

**Correções mínimas antes do go-live:** (a) dar handler aos botões `f*_` (ou trocar o 7d pro motor de
fluxo com `campaign_flow_state`/branches, em vez de drip linear); (b) o cancel/engaged do inbound tem
que casar o nome do funil novo (ou renomear pra `mega-sorgo`); (c) `menu_preco` por clique também
pausar o drip; (d) 2º preço cair no fast-track humano, não no silêncio; (e) fixar a janela; (f) turbo
off.

**STATUS (implementado 2026-11-14, NÃO deployado):**
- ✅ (a) `handleFunnelAdvanceTap` em `uazapi-webhook.ts` — clique `f*_` registra a escolha
  (`events` `funnel_button_tap`) e adianta a próxima peça do drip. Limitação: drip linear não
  ramifica conteúdo pela escolha (ex. leite×corte) — a escolha fica no evento pro humano/relatório.
- ✅ (b) `inbound.ts` — cancel/engaged agora casa `like "mega-sorgo%"` (cobre `-7d-v1/-v2/-followup`);
  clique de avanço (`funnelAdvanceClick`) é isento (avança o drip em vez de cancelar).
- ✅ (c) coberto por (b): resposta/clique não-avanço no funil novo agora cancela o drip.
- ✅ (d) `uazapi-webhook.ts` — 2º `menu_preco` no dia → `autoPauseFunil` + `handleHumanRequest`
  (cotação), em vez do silêncio.
- ⏳ (e) janela e (f) turbo: config do gerador/produção, não code — resolver no build do 7d-v2.
- ⚠️ Pendência achada (fora do escopo destes fixes): teste `iscas.test.ts` "fase 5 oferta a isca"
  falha (pré-existente) — a fase 5 não está ofertando a isca ativa. Investigar à parte.

## 1. Diagnóstico do funil principal (números reais)
| Gargalo | Número | Leitura |
|---|---|---|
| Ninguém fecha | **881/1194 open (73,8%)**; só **52 com humano (4,4%)** | lead tocado, esfria, conversa abandonada |
| Handoff não dispara | `pediu_humano` = **43/1194 (3,6%)** | das 76 vendas, **64 fecharam sem atribuição** (Cícero no WhatsApp, fora do sistema) |
| Toque demais | **~27 peças/lead**; `cancelled` sobe dia a dia (537→1225) | lead cansa e sai |
| Medição cega | `messages.funnel` entrada = **0**; `outcome_value_cents` = **0** nas 154 vendas | sem resposta-por-etapa nem ROI |
| Conversão | 76/1194 = **6,4%** | topo responde, fecha pouco |

**Conclusão:** o furo é **lead quente não chegar no humano** e **conversa nunca ser fechada**.

## 2. O que já existe (`mega-sorgo-7d-v1`)
- **33 peças** em 7 "dias": d1=9, d2=11, d3=9, d5=3, d6=1, d7=1. Mix bom (áudio/vídeo/imagem +
  `interactive`/`list` com botões). Peças ativas em `funnel_media` (`official_01-05`, `p02`–`p29`,
  `d5_pdf`, e os cards `preco_2kg/4kg/10kg/20kg`).
- Testado em **4 contatos (09/11) em modo turbo** → as 33 saíram em **~40 min**; todos `open`.
- Flow **linear** (drip em `scheduled_messages`): botões roteiam pelos detectores globais de intenção;
  resposta **cancela** peças pendentes.

**Como o dono decidiu manter o volume (~33), o desenho não corta peça — corta o risco:** espaçar em
7 dias reais, teto por dia/janela, e reply pausa a régua. Sem isso, 33 toques pioram o `cancelled` e o
risco de bloqueio.

## 3. Princípio
**O funil entrega lead quente pro Cícero rápido.** Conteúdo denso, mas: 1 resposta pausa a régua, e
qualquer sinal de compra sai na hora pro humano.

## 4. Cadência (~33 peças, espalhadas em 7 dias reais — turbo OFF)
Espinha **prova → medo → oferta**. Janela **08–20h**. Teto **≤5 peças/dia**, espaçadas (nunca a
rajada de 9 do dia 1). Toda resposta do lead **pausa** o restante do dia.

| Dia | Ângulo | Peças (slots existentes) | CTA / botão |
|---|---|---|---|
| **0** | Prova / abertura | vídeos `official_01`/`p06` + `p02` imagem (abre com botões) | [Quero o preço] · [Como planto] · [Falar c/ especialista] |
| **1** | Prova social | depoimentos `p04`/`p05`/`p09`/`p10` (áudio) + `p11` vídeo | [Quero garantir o meu] |
| **2** | **Medo de perder a lavoura** (seca/praga) | `p14`/`p15` áudio + `p16`/`p16b1`/`p16b2` | [Quero proteger minha lavoura] |
| **3** | Reforço de resultado (sem comparação técnica pesada) | `p19`/`p20` áudio + `p21` img + `p22` vídeo + `p24v` | [Ver pacotes] |
| **4** | **Oferta — preço por pacote** | cards `preco_2kg`/`preco_4kg`/`preco_10kg`/`preco_20kg` + `d5_pdf` | [Quero este pacote] → **handoff** |
| **5–6** | Urgência / escassez real | `p25`/`p26` áudio + `p28`/`p29` img | [Falar agora] |
| **7** | Última chamada | `text` de fechamento | [Falar com o Cícero] |
| pós-7 sem resposta | — | — | sai da régua → **morno** (re-nutrição), **não** lost |

Por que a ordem: dado histórico — **"medo de perder a lavoura" reengaja** (resposta sobe pra ~39%);
**comparação técnica derruba** (cai pra ~19%), então fica fora do início; **cliente pede preço no dia
0** (14/87) → a abertura já tem botão de preço que roteia na hora.

## 5. Preço — quotar pacote fixo (decisão do dono)
- O funil passa a **mandar o card de preço do pacote** (`preco_2kg/4kg/10kg/20kg`, já existem como
  imagem) no dia 4 e sempre que o lead pedir preço.
- Valores de referência (confirmar antes de ativar): 2 kg R$ 179,90 · 4 kg R$ 341,62 · 10 kg R$ 764,15
  · 20 kg R$ 1.437,90 · frete grátis. **Volume / >20 kg / desconto especial → Cícero.**
- ⚠️ **Fonte de verdade:** `product_prices` está **VAZIA** no banco hoje. Antes de ligar o preço no
  funil: popular/aprovar `product_prices` (com `valid_until`) e **alinhar com o bot de IA agro** (que
  já quota esses pacotes) — senão funil e bot divergem no mesmo lead.
- ⚠️ **Guarda anti-erro histórico:** nunca mandar card com promoção vencida (`valid_until`), e o card
  é a única via de número (não deixar texto solto com R$). `ancoragem-preco.ts` é código morto — não
  religar ([[preco-sem-numero-fast-track]]).

## 6. Handoff e fechamento — todo sinal de compra, na hora (furo nº1)
Qualquer sinal → **pausa a régua + atribui o Cícero + nota privada + alerta**:
- pediu preço, escolheu pacote, "quero/fechar/pagar/garantir", clique em [garantir]/[especialista]/
  [este pacote];
- CEP/CNPJ/endereço/comprovante (já existe: `fechamento-intent.ts`, deploy `872633d`).
Mecanismo: `bridge/shared/pedido-humano.ts` + `autoPauseFunil` (`funnel-state.ts:12`) + o fast-track
já no ar (`handleMenuClick`). Hoje 3,6% chegam — **meta: todo sinal de compra vira handoff**.
**Fechamento assumido** ao levantar a mão: "posso **adiantar o envio** pra sua região? o Cícero
confirma condição" + handoff — em vez de empurrar conteúdo. (A venda #798 fechou com "posso agilizar
o envio?".)
**SLA humano:** atribuiu e o Cícero não respondeu em X min → re-alerta. 852 `open` sem humano hoje =
handoff sem SLA vira a mesma fila morta.

## 7. Anti-fadiga e régua de perdido (porque mantivemos ~33 toques)
- Teto ≤5 peças/dia, espaçadas; **1 resposta do lead pausa o resto do dia** (humano assume).
- Dedup de peça por lead (não repetir slot).
- `lost` só após dia 7 **+ zero inbound no período + sem sinal de compra**. Quem respondeu alguma vez
  **nunca** vira auto-lost → **morno**. Afrouxar `lost_por_silencio` (`recovery-chain.ts:403`) e
  `ABANDONO_MS`.

## 8. Instrumentação (ANTES de trocar — senão troca às cegas)
- preencher `messages.funnel`/`funnel_day` nas mensagens de **ENTRADA** (hoje 0) — `inbound.ts`;
- gravar `outcome_value_cents` ao marcar "Pago" — `conversation-outcome.ts`;
- 1 evento `source=sales-funnel` por etapa.
Medir em `web/app/acompanhamento/page.jsx`.

## 9. Migração (ocupar o lugar do principal)
- Nome `mega-sorgo-7d-v2` (mantém 7d-v1 como acervo).
- Desligar enroll da jornada atual: `FASES=[faseComercialV2]` (`funil-enroll.ts:317`) e
  `autoEnrollFunil` (`:579`) apontam pro 7d-v2.
- A-B num recorte pequeno enquanto o principal escoa `running`/`open` no manual; comparar antes de
  cortar o antigo.

## 10. Segurança operacional
- Janela **08–20h**; **turbo OFF** em produção.
- **Não deployar/reiniciar o SERVIDOR entre 8–20h** — restart vira "incerto" e **auto-pause congela a
  campanha inteira** ([[campanha-auto-pause-incerto]]). Recomendado: auto-pause por item, não campanha
  (`campaign-queue.ts:164`; `0016_...sql:98-157`).
- Lista grande sempre pela **fila** (`agendar-fluxo`), nunca `start`/`start-fluxo` (ignoram horário).
- **Nunca** `channels.status=inactive` pra pausar campanha ([[canal-0595-suspenso]]).
- **33 toques em uazapi = risco de ban alto** (0595 já caiu): preferir abrir janela por template no
  canal oficial e mandar o conteúdo rico só após o toque do lead; rampa + teto por dia obrigatórios.

## 11. Métricas de sucesso (vs baseline 6,4%)
% que chega no humano (hoje 3,6%) · tempo até handoff · conversão · taxa de `lost` · receita/lead
(exige a instrumentação da seção 8).

## 12. Implementação (ordem)
1. Instrumentação (seção 8) — PR, deploy fora de 8–20h.
2. Popular/aprovar `product_prices` + alinhar com o bot IA agro (pré-requisito do preço).
3. Gerar o 7d-v2: ~33 peças espalhadas em 7 dias reais, teto/dia, turbo off.
4. Handoff em todo sinal + fechamento assumido (seção 6).
5. Régua de perdido + SLA humano (seção 7).
6. A-B num recorte → medir → só então apontar o auto-enroll de vez.

## 13. Verificação
- Cadência real: `scheduled_messages?funnel=eq.mega-sorgo-7d-v2` — `send_at` em dias, ≤5/dia.
- Preço: card sai certo; `product_prices` populada e válida; funil × bot IA batem.
- Handoff: subiu `pediu_humano`/assignee sobre enrolled?
- Instrumentação: `messages.funnel` em `direction=in` > 0; `outcome_value_cents` > 0.
- Fechamento: caiu `open`? subiu `won`?
