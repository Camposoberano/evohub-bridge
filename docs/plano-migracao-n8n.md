# Plano de migração — tudo pro n8n

> **Decisão (31/10):** mover **toda a operação de disparo e conversa pro n8n**, pra ter
> controle visual de edição (vídeo, preço, funil, ramificação) sem mexer em código.
> Isto **reverte de propósito** a decisão travada *"lógica SEMPRE no bridge, n8n só cron"*
> (CLAUDE.md) e desfaz, ao contrário, a migração Secretária v3 (n8n) → V4 (bridge).
> Risco assumido pelo dono. Este plano existe pra fazer isso **sem apagão** numa VPS de 2 vCPU.

---

## 1. O que roda hoje (inventário real)

Tudo no bridge Deno (`bridge/server.ts`): **22 loops de fundo** + **33 endpoints HTTP**.

### Loops de fundo (boot do server, gate `AUTO_LOOPS_ENABLED`)
| Grupo | Loops |
|---|---|
| **Disparo** | `startFunnelQueueLoop`, `startFunnelResumeLoop`, `startFunnelRecoveryLoop`, `startFlowTimeoutLoop`, `startCampaignQueueLoop`, `startUazapiCatchupLoop` |
| **Sincronização** | `startSyncLoop` (FB), `startCommentsLoop`, `startChannelSyncLoop`, `startChatwootOutLoop` (pull 20s), `startSyncLabelsLoop`, `startSyncWaLabelsLoop`, `startAvatarLoop`, `startEnrichLoop` |
| **Estado / etiqueta** | `startLabelWindowLoop`, `startMacroCommandLoop`, `startBotMuteLoop`, `startOutcomeLabelLoop`, `startDeclineGuardLoop` |
| **Manutenção** | `startRollupLoop` (métricas 24h), `startRetentionLoop`, `startDataCleanupLoop` |
| **Monitor** | `startOperationalMonitorLoop` (alerta WhatsApp) |

### Endpoints HTTP (`routes` em server.ts)
- **Entrada:** `/hub-webhook` (Meta), `/uazapi-webhook`, `/chatwoot-webhook`
- **Disparo (já chamáveis pelo n8n):** `/send-outbound`, `/funil-enroll`, `/funil-queue-pump`, `/campaign`, `/funil-control`, `/funnel-ops`
- **Orquestração:** `/llm-orchestrate`
- **Conexão/canal:** `/connect-channel`, `/connect-uazapi`, `/uazapi`, `/channel-sync`, `/channel-health`, `/meta-templates`, `/repair-official-5895`
- **Sync/relatório:** `/sync-facebook`, `/sync-comments`, `/sync-chatwoot-out`, `/sync-labels`, `/sync-wa-labels`, `/label-window`, `/metrics-rollup`, `/relatorio`, `/conversation-outcome`
- **Híbrido/IA:** `/hybrid-routes`, `/hybrid-ops`, `/ai-gate`
- **Outros:** `/clientes`, `/chatwoot-accounts`, `/media-retention`, `/operational-health`

---

## 2. Princípio da migração

"Tudo no n8n" = **toda a lógica e o conteúdo editável viram workflow n8n**. Mas o bridge
**não some** — vira uma **biblioteca de primitivas burras** (sem decisão de negócio), porque
reimplementar isto em nós n8n é risco puro, sem ganho de controle:

**Fica no bridge como primitiva (o n8n chama):**
- `send-outbound` — já é o contrato PRA n8n (text/vídeo/imagem/áudio/botões/lista), registra no
  Chatwoot sem re-disparar webhook, aplica a janela 8-20h como **última barreira**, dedup por claim.
- Upload de mídia na Graph da Meta, HMAC/token, paginação PostgREST, claim de dedup (`deliveries`).
- Download de mídia de entrada (modo shared bloqueia — bridge baixa direto da Graph).

**Vira workflow n8n (o que você edita):**
- Sequência do funil (quais peças, timing, qual mídia) — hoje em `funil-enroll.ts`.
- Conteúdo: textos, botões, legendas, escolha de vídeo/arte.
- Ramificação reativa: intent → resposta (preço, dúvida técnica, uso, pedido-humano).
- Regras de campanha (reativações), pacing, horário, retomada.

> Confirmar este recorte antes de começar. Se o dono quiser **também** as primitivas no n8n
> (Meta Graph, HMAC, dedup em nós), somam-se semanas e o risco de regressão dispara — não
> recomendado.

---

## 3. Fases (ordem segura, cada uma testável e reversível)

Estratégia-chave: **dual-run**. O claim em `deliveries` já impede duplicação se o n8n e o loop
do bridge lerem a mesma fila (`funnel-queue.ts`). Então cada fase roda em paralelo com o bridge
(shadow), compara saída, e só aí desliga o loop equivalente no bridge. Nada de big-bang.

### Fase 0 — Infra n8n (2-3 dias)
- n8n com fila durável (execução em modo `queue` + Postgres próprio, já existe `soberano-n8n-postgresql`).
- **CPU:** n8n executando milhares de execuções/dia numa VPS 2 vCPU é o maior risco operacional.
  Medir antes; considerar mover n8n ou subir núcleos (ver memória VPS single-box).
- Versionar os workflows (export JSON no git) — senão perde edição igual o session store do VS Code.
- Credenciais no n8n: token send-outbound, service-role Supabase, admintoken uazapi, Meta.

### Fase 1 — Disparo mega-sorgo → n8n (~1 semana)
- Workflow que, por lead, gera a sequência (as 5 fases de `funil-enroll.ts`: GAPS, textos, botões,
  slots de mídia) e chama `send-outbound`.
- **Estado longo (dias):** NÃO usar Wait node do n8n por lead (não escala). Manter
  `scheduled_messages` como fila + n8n cron 1x/min lendo o que venceu (o modelo atual, só que o
  n8n passa a ESCREVER a fila em vez do `funil-enroll.ts`).
- Teste de paridade: rodar n8n em shadow, comparar peças/timing com o roteiro v2
  (`docs/funil-mega-sorgo-playbook.md`). Só desligar `startFunnelQueueLoop`/`funil-enroll` após bater.

### Fase 2 — 4 reativações → n8n (2-3 dias)
- Padrão mais simples (`campaign_queue`). Workflow de enroll + pace + chamada send-outbound.
- Manter a trava: instância desconectada não pode starvar a fila (ver memória instancia-uazapi-trava-fila).

### Fase 3 — Guards e pacing (3-4 dias)
- Janela 8-20h: já é última barreira no send-outbound (fica). Replicar a decisão no n8n só pra
  não enfileirar fora de hora.
- Janela Meta 24h/72h, loop-guard, bot-mute, dedup de intent: expor como sub-workflow ou manter
  no bridge e o n8n consulta. Decisão por item.

### Fase 4 — Conversa reativa → n8n (2-4 SEMANAS — o grande salto, maior risco)
- Mover o hot path: `/hub-webhook` + `/uazapi-webhook` → n8n roteia a entrada.
- Intent (preço/dúvida/uso/interesse): **decisão em aberto** — nó de IA no n8n, ou n8n chama o
  bridge que já tem `intent.ts`. Chamar o bridge perde menos hardening.
- Ramificação (funil-comercial, pacotes, ancoragem, pedido-humano, gate-comercial): reconstruir
  como máquina de estado no n8n. É aqui que moram meses de correção (dedup, eco, loop). Migrar
  item a item com teste, nunca de uma vez.
- Latência: webhook é tempo-real; cada salto n8n adiciona atraso. Vigiar.

### Fase 5 — Loops de suporte → n8n cron (~1 semana)
- recovery, catchup, sync-chatwoot-out, sync-labels, retention, rollup, monitor operacional.
- Cada um vira um cron do n8n chamando o endpoint existente ou refazendo a lógica.

### Fase 6 — Desligar loops do bridge, bridge = só primitiva (2-3 dias + estabilização)
- `AUTO_LOOPS_ENABLED=false` permanente; remover os loops migrados.
- Bridge responde só: send-outbound, mídia, Meta, dedup, download, registro Chatwoot.

---

## 4. Contratos

### `send-outbound` (já existe — reusar)
`POST /send-outbound?token=<CHATWOOT_WEBHOOK_SECRET>`
```
{ chatwoot_conversation_id, type, payload }
  text          -> { content }
  text_sequence -> { texts:[...], delay_ms? }
  image/video   -> { media_url, caption? }
  audio         -> { media_url }
  interactive   -> { text, buttons:[{id,title}], header_image? }  // title <= 20 chars
  list          -> { text, button_label?, sections:[{title?, rows:[{id,title,description?}]}] }
```
Elo com a fila: `funnel`, `funnel_day`, `funnel_step`, `scheduled_message_id`.

### Contratos novos a definir
- Leitura/escrita de `scheduled_messages` e `campaign_queue` pelo n8n (via PostgREST service-role).
- Endpoint de intent (se optar por chamar o bridge na Fase 4).

---

## 5. Riscos

| Risco | Mitigação |
|---|---|
| **CPU 2-vCPU** não aguenta n8n em escala | Medir na Fase 0; subir núcleos ou isolar n8n antes da Fase 4 |
| Perda de hardening (dedup, eco, loop, janela) | Dual-run + paridade por fase; manter guards no send-outbound |
| Estado per-contato de dias no n8n | Manter `scheduled_messages` + cron, não Wait node |
| Latência no hot path reativo (Fase 4) | Medir; chamar bridge pra intent em vez de nó IA |
| Workflows do n8n sumirem (sem versão) | Export JSON no git desde a Fase 0 |
| Janela Meta 24h/72h / template frio | Replicar no n8n + manter barreira no send-outbound |

---

## 6. Estimativa

| Fase | Trabalho |
|---|---|
| 0 Infra | 2-3 dias |
| 1 Mega-sorgo | ~1 semana |
| 2 Reativações | 2-3 dias |
| 3 Guards | 3-4 dias |
| 4 Reativo | **2-4 semanas** (risco concentrado) |
| 5 Suporte | ~1 semana |
| 6 Desligar bridge | 2-3 dias + estabilização |
| **Total** | **~7-10 semanas** de trabalho focado |

Fases 1-3 entregam já o controle do **disparo** (o que foi pedido primeiro). A Fase 4 é a que
justifica "tudo" — e é onde o custo/risco vive.

---

## 7. Decisões em aberto (resolver antes da fase respectiva)

1. **Primitivas no bridge** (seção 2) — confirmar que send-outbound/Meta/dedup ficam, ou vão
   também pro n8n (não recomendado).
2. **Intent na Fase 4** — nó IA do n8n vs. chamar `intent.ts` do bridge.
3. **Estado longo** — `scheduled_messages` + cron (recomendado) vs. Wait node.
4. **Lane de IA (fazer.ai)** — fica como está (webhook → ai-gate) ou o n8n passa a rotear pra ela.
5. **CPU** — medir e decidir subir núcleos/isolar n8n antes da Fase 4.
