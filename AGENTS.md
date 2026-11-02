# AGENTS.md — EVO Hub Bridge

Padrão lido pela maioria dos agentes (Claude Code, Codex, Cursor, Gemini). A **fonte
compartilhada de estado entre qualquer LLM é este repositório git** — nunca só a memória
de um tool específico. Arquivos canônicos versionados: este `AGENTS.md`, `CLAUDE.md`,
`HANDOFF.md`, e os docs tópicos em `docs/`.

---

## Decisões travadas (correções que NÃO se repetem)

Regras duras. Cada uma já custou um incidente — não refazer o erro.

- **Chatwoot filter = 1 condição `equal_to` com todos os valores (IN), nunca N condições
  `equal_to` OR'd.** 16 OR levavam ~15s e estouravam timeout na VPS (HTTP 500 no
  controle de bot); 1 condição IN = 143ms–1,3s. Vale pra `macro-poll`/`bot-mute`/`outcome`.
- **`events` precisa do índice `idx_events_received_at`.** Sem ele, `order by received_at`
  = 8,6s/500 e espiral 57014; a tabela cresce sem limpar. Recriar via role
  **`supabase_admin`** (o `postgres` não é dono/superuser). Drenar backlog em lotes (VPS single-box).
- **Deploy builda do `main`, não `master`.** Os 2 apps Coolify observam `main`; `master`↔`main`
  divergiram. Publicar = cherry-pick/edit direto no `main` + **`POST /deploy`** (o endpoint
  virou POST; GET devolve 405). Confirmar por `uptime_s` baixo em `/version`.
- **NÃO deployar nem reiniciar o bridge entre 8h e 20h BRT.** Disparo de campanha ativo nessa
  janela; restart no meio pausa a campanha. Só com OK explícito do usuário.
- **VPS é uma caixa só** (`136.248.116.231`, 2 vCPU): Supabase + Chatwoot + bridge + fazer-ai
  + Grafana no mesmo IP. CPU é o gargalo. Operações pesadas (drain, scans) a **≤3 workers** +
  pausa, senão 100% CPU derruba as queries de todo mundo.
- **O n8n JÁ RODA nesta mesma VPS — a "Fase 0 (infra)" do plano de migração está FEITA.**
  `https://automacao.soberano.pro` (`/healthz` → `{"status":"ok"}`, container `10.0.5.2`), com
  **41 workflows, 20 ativos**, e o **funil Soberano 5895 já despacha por cron do n8n** — o n8n
  está no caminho crítico HOJE, não é um futuro. Consequências para o planejamento:
  1. Migrar **não** é somar uma carga nova à caixa: é **mover** carga do bridge pro n8n. O
     delta pode ser **negativo** (pior), porque uma execução de workflow custa mais que um
     laço Deno — medir os dois lados antes de afirmar ganho.
  2. Antes da Fase 1, **inventariar o que já está no n8n**. Sem isso a migração duplica
     lógica que já existe, e 21 dos 41 workflows são cópias/testes que dão para limpar.
  3. Para um agente inspecionar: precisa de `N8N_API_KEY` no `.env` (não há nenhuma hoje);
     `/api/v1/workflows` exige o header `X-N8N-API-KEY` e `/rest/login` responde 401. Criar
     uma key **nova** resolve dois problemas de uma vez, porque a anterior foi colada em chat
     e está na fila de rotação.
- **Observabilidade — onde ver CPU (e por que um agente NÃO consegue ver hoje).**
  `https://grafana.soberano.pro` (Grafana 13.x, `/api/health` responde sem auth e serve de
  ping). Serviço Coolify `mbc0rqqk3kn47uxkw8mufuuu` = Grafana + Prometheus + Alertmanager +
  node-exporter + cAdvisor; configs em `/data/observ`; publicado em `127.0.0.1:3001:3000`
  (porta de host fixa — correção durável de 31/10, ver `nginx-ip-container-quebra`).
  Prometheus e Alertmanager **não têm vhost válido** (`prometheus.`/`alertas.soberano.pro`
  dão erro de certificado), então só se chega às métricas **através do Grafana**, e
  `/api/datasources` responde `401`. O login é `admin` com senha trocada no 1º acesso — o
  agente **não tem** credencial.
  **Para um agente poder medir CPU:** criar em Grafana → Administration → Service accounts um
  token de papel **Viewer** e gravá-lo no `.env` como `GRAFANA_TOKEN` (nunca no chat). Com ele,
  a leitura é pelo proxy de datasource:
  `GET /api/datasources/proxy/<id>/api/v1/query?query=...` com `Authorization: Bearer`.
  Queries úteis: `100-(avg(rate(node_cpu_seconds_total{mode="idle"}[5m]))*100)` (CPU%),
  `node_load1`, e por container `rate(container_cpu_usage_seconds_total[5m])`.
  Alerta já fechado no sentido inverso: Prometheus → Alertmanager → `POST /grafana-alert` no
  bridge → WhatsApp (`bridge/handlers/grafana-alert.ts`, auth `GRAFANA_ALERT_SECRET` ou
  `AI_GATE_SECRET`, destino `ALERT_WHATSAPP_TO`).
- **Lane de IA (fazer.ai): flag `AI_LANE_ENABLED` default OFF; o estado é a label `ai-vendas`;
  o `/ai-gate` é fail-closed.** Ligar a flag sem o wiring externo (agente bindado + `AI_GATE_SECRET`
  + contactAuth apontando pro `/ai-gate`) = lead no vácuo. Ver `docs/ai-lane-funil-agro.md`.
- **O campo `build:` em `bridge/server.ts` é uma label MANUAL e está travada** (ficou em
  `2026-10-10` por 126+ commits). O `build` em `/version` **MENTE** — NUNCA diagnosticar
  "deploy não subiu" por ele. Confirmar deploy por `version.features` (flags novas, ex.
  `ai-lane-contact-auth-gate`) ou `uptime_s`. **Bumpar o `build:` a cada deploy.**
- **Instância uazapi desconectada trava a fila de campanha INTEIRA.** Um item cuja instância
  está offline é repescado pelo loop (reserva → preflight "sem verificador WhatsApp conectado"
  → devolve → repete) e **starva as campanhas das instâncias conectadas** (elas nem são tocadas).
  Fix: pausar a campanha da instância morta (`pending`→`paused`) libera as outras. Conferir
  `/instance/all` no uazapi (admintoken do `.env`) antes de culpar env/deploy/kill-switch.
- **Coolify restart/deploy = POST, não GET** (GET devolve 405). Restart (recarrega env, sem
  rebuild): `POST /applications/{uuid}/restart`. Deploy/rebuild: `POST /deploy?uuid={uuid}&force=true`.
- **`AUTO_LOOPS_ENABLED=false` = kill-switch de TODOS os loops de fundo** (funnel-pump,
  reativação, sync, recovery, catch-up…). No Coolify há uma entrada "false" `is_preview=true`
  (só preview) e a de produção `is_preview=false` — editar a de produção. **O webhook de
  entrada NÃO para com isso:** lead que manda msg ainda recebe resposta (intent/menu/IA).
- **Pausar no banco (`pending`→`paused`) só congela o BACKLOG.** Conversas ao vivo continuam
  enrolando/disparando. Pra parar o funil ao vivo: `AUTO_LOOPS_ENABLED=false` (+ `AI_LANE_ENABLED=0`
  pra IA) + restart. Não há flag que impeça o webhook de responder quem manda mensagem.
- **Consultar o self-host direto (análise read-only):** PostgREST em `$SUPABASE_URL/rest/v1`,
  schema `evohub` via header `Accept-Profile` (leitura) / `Content-Profile` (escrita), Bearer =
  `SUPABASE_SERVICE_ROLE_KEY`. Cap de 1000 linhas/req → paginar com header `Range`. Rodar dentro
  do `ctx_execute` (segredo lido do `.env`, nunca impresso).
- **Não colar segredo no chat** — vai pro `.env`/Coolify/Chatwoot. Segredo exposto no chat
  entra na lista de rotação do handoff.
- **Divergência `master` ↔ `main`: RESOLVIDA em 02/11/2026** (`main` == `master`, e o
  `AGENTS.md` passou a viver no `main`). O que fica como regra: **publicar é cherry-pick
  pontual pro `main`, nunca merge de uma branch velha** — em 01/11 o `master` estava 149
  commits atrás e **sem** os dois fixes de 30-31/10 (`095c415` filtro IN, `a31803d` guard de
  eco), então um merge os reverteria. E **compare CONTEÚDO (diff two-dot) antes de concluir
  que algo "só existe" numa branch**: em 01/11 o código já estava cherry-pickado e só 7 docs
  estavam presos de fato.
  ⚠️ Branch de trabalho não é lugar de guardar documentação: 5 commits de doc + 1 migration da
  sessão de 01/11 ficaram **fora do `main`** porque a divergência foi resolvida por outra
  sessão, pelo outro lado. Levar doc pro `main` no mesmo dia em que é escrita.
- **Canal `0595`: DISPARO AUTOMÁTICO suspenso por decisão do dono (02/11/2026); atendimento na
  mão SEGUE LIBERADO.** A instância está **conectada** na uazapi — não foi queda, foi decisão,
  por risco de bloqueio (o número já caiu dias antes). O canal fica
  **`channels.status = active`** de propósito: a suspensão mora em `campaign_flow_state` +
  `campaigns.json`, nunca no status ([[instancia-uazapi-trava-fila]]).
  🔴 **Suspender canal NÃO é só `channels.status` + filas: existe disparo que não vem de fila
  nenhuma.** Em 02/11, horas depois da suspensão, o 0595 continuou mandando vídeo a cada
  **10 minutos exatos**. Todas as filas estavam zeradas (`campaign_queue` 0 `pending`,
  `scheduled_messages` 0, `sales_sequences` 0), e mesmo assim saía. O culpado era
  `pumpCampaignAutoVideos` (`bridge/shared/campaign-auto-video.ts`, laço de `GAP_MS = 10min`):
  ele **não lê fila** — varre `campaign_flow_state` com `step_id='abertura'` e
  `status='waiting'` e manda o vídeo para quem não respondeu a abertura depois de
  `autoVideoAfterMin`. Não filtra `channels.status`, não gera `funnel_delivery_attempt`, e
  grava `messages` com `funnel = NULL` — por isso não aparece em nenhuma auditoria de funil.
  Havia **188 contatos** represados aí, ~2,5 dias de disparo pela frente.
  **Parar de verdade exige as duas camadas** (ambas em dado/config, sem deploy — dá para
  aplicar dentro da janela 8-20h):
  1. estoque → `campaign_flow_state` da campanha: `status` `waiting` → `paused`;
  2. torneira → `campaigns.json` no bucket `soberano-config`: `autoVideoAfterMin` → `0`
     (o laço só pesca com `>= 5`). `readCampaigns()` **não cacheia** — baixa do bucket a cada
     tick, então vale na hora, sem restart.
  Reverter = `autoVideoAfterMin = 60` + `paused` → `waiting`. Backup do JSON em
  `soberano-config/backups/campaigns-antes-parada-0595-20261102.json`.
  **Antes de dizer que um canal está parado, procure os disparadores que não são fila**:
  `grep -rn "status\", \"waiting\"" bridge/shared/`.
  🔴 **NUNCA use `channels.status = inactive` para suspender campanha — isso MATA o envio
  manual do atendente, em silêncio.** `handlers/sync-chatwoot-out.ts:41` seleciona
  `.eq("type","whatsapp").eq("status","active")`. Esse laço é o **fallback de saída** que
  existe porque o webhook do Chatwoot vive dando 502/503 ([[webhook-chatwoot-instavel]]):
  com o canal `inactive` ele pula o canal, e a mensagem que o atendente digita no Chatwoot
  **não é despachada por ninguém** — sem erro, sem `status failed`, sem rastro no banco.
  Em 02/11 isso derrubou o atendimento do 0595 por horas; o dono percebeu porque "mandei
  preço e vídeo e não foi". O envio pelo **aparelho** continuava funcionando (não passa pelo
  bridge, só ecoa depois), o que faz o sintoma parecer aleatório.
  `inactive` é suspensão **documental**: não bloqueia `/send` (o envio uazapi resolve a rota
  por nome da instância — `getDirectUazapiRoute` → `tokenForInstance`,
  `bridge/shared/hybrid.ts:174`, sem olhar `channels.status`) e não bloqueia a entrada (acha o
  canal por `external_id`/`name`). Ou seja: **não impede o que você quer impedir e quebra o que
  você quer preservar.** Para suspender campanha, use as duas camadas acima e deixe o
  `status = active`. O `channel-sync` não reverte status sozinho (só varre canais com
  `hub_channel_id` não nulo; o 0595 tem nulo), então um `inactive` posto na mão fica lá até
  alguém tirar.
- **DDL no self-host: o SQL Editor do Studio NÃO aceita `CREATE INDEX CONCURRENTLY`** — ele
  envolve tudo num bloco de transação e devolve `25001: cannot run inside a transaction
  block`. E o `postgres` **não é dono** das tabelas: sem `set role supabase_admin` vem
  `must be owner of table`. Caminhos que funcionam: `psql -c` (não abre transação) ou criar
  sem `CONCURRENTLY` quando o lock couber (medir quantas linhas o índice cobre antes).
  O bridge **não serve** para DDL — só fala PostgREST — e `SUPABASE_DB_URL` está vazio no
  `.env`, então não há caminho automatizado: DDL é sempre ação manual do dono.
- **Antes de culpar índice ausente, MEÇA.** Em 01/11 diagnostiquei `events/raw: 57014` como
  falta do `idx_events_received_at` — errado, ele existe e funciona (`order received_at` em
  524ms sobre 426k linhas, retenção drenando: a tabela caiu de 1,7M para 426k). A causa real
  era o filtro `payload->'message'->>'fromMe'` **sem índice de expressão**: cada candidato
  precisava ter o payload desserializado. Decompor a consulta por partes achou o culpado em
  minutos — sem filtro JSONB 278-414ms estável, com filtro 277ms até TIMEOUT. Fix em
  `supabase/migrations/0019_events_fromme_expression_index.sql`; nenhuma linha de código
  mudou.
- **Token de canal social (FB/IG) se testa no proxy, não no Graph.**
  `GET $EVOLUTION_HUB_URL/meta/me?fields=id,name` com `Authorization: Bearer <channel_token>`.
  O `channel_token` é credencial do **EVO Hub**, não access token do Graph: batendo em
  `graph.facebook.com` os 5 canais devolvem o mesmo `400 Cannot parse access token` e parecem
  todos expirados. Em 01/11 isso gerou um falso "5 canais quebrados" — pelo caminho certo era 1.

---

## Comando: salva tudo

Quando o usuário disser **"salva tudo"** (ou "salvar geral", "handoff", "encerra sessão",
"fecha", "guarda contexto", "salva estado"), rodar o checklist **completo** — nunca só o handoff:

1. **Handoff** — atualizar `HANDOFF.md` (raiz, versionado): estado (build/último deploy/branch),
   feito na sessão, pendente (com contexto pra retomar sem perguntar), dúvidas/em aberto, bloqueios.
2. **Decisões travadas** — toda correção pedida ou decisão revertida vira regra AQUI
   (`AGENTS.md`, seção acima) na hora, mais uma memória `feedback` com o porquê. NUNCA deixar
   correção só no handoff (ele é reescrito e some).
3. **Memórias** — fatos/feedback novos no diretório de memória do projeto + linha no `MEMORY.md`.
4. **Git** — commit do que falta; push pra `main` só com OK (confirmar antes se for código que
   rebuilda container).
5. **Roadmap/docs** — atualizar se o plano mudou.
6. **Relatório final** — listar item a item o que foi salvo + apontar qualquer ponta solta.

Regra de ouro: correção importante → arquivo versionado (`AGENTS.md`/`CLAUDE.md`) NA HORA,
não só num handoff volátil.

---

## Persistência

Persistência entre sessões/LLMs = 3 camadas **versionadas no git**:

- **`AGENTS.md` + `CLAUDE.md`** — regras e decisões travadas.
- **`HANDOFF.md`** (raiz) — estado vivo único + arquivo histórico. **Fonte canônica.**
- **`docs/`** — docs tópicos (arquitetura, features, referências).

A memória de tool (`C:\Users\User\.claude\...\memory\handoff.md`) é **ponteiro volátil**,
não fonte da verdade. O session store do VS Code é descartável — já perdeu uma sessão
inteira. Ao sinalizar encerramento, oferecer "salva tudo".

Nota do `.gitignore`: `docs/` é ignorado por padrão com **allowlist** (`!docs/<arquivo>`).
Todo doc novo em `docs/` precisa de uma linha `!docs/<nome>` ou fica fora do git.

---

## Mapa da documentação

- `HANDOFF.md` — estado atual + histórico.
- `docs/ai-lane-funil-agro.md` — lane de IA fazer.ai no funil agro.
- `docs/contact-auth.md` — contrato do `/ai-gate`.
- `docs/motor-de-fluxo.md` — motor de fluxo conversacional.
- `docs/superpowers/specs/` e `docs/superpowers/plans/` — specs e planos de features.
