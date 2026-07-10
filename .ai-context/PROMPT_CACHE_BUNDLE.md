# Prompt Cache Bundle

Bundle estavel para prefixo reutilizavel de LLM.
Use isto no INICIO do prompt/request e coloque detalhes variaveis somente depois do breakpoint de cache.
Nao inclua segredos neste arquivo.

## Arquivo: README.md

# Evo Hub ↔ Chatwoot Bridge + Dashboard

Ponte entre o **EVO Hub** (gateway proxy da Meta Graph API — WhatsApp/Facebook/Instagram) e o **Chatwoot** (camada de conversa), com um **dashboard próprio** que é o system of record + analisador (operacional e comercial).

Plano completo: `C:\Users\User\.claude\plans\analise-esta-documenta-o-api-peppy-token.md`

## Camadas

```
GATEWAY    EVO Hub   → proxy Meta (canais, channel_token, /meta/*)
CONVERSA   Chatwoot  → inbox do atendente (canal "API"; só conversa)
CÉREBRO    DASHBOARD → Supabase (Postgres + Edge Functions) + Next.js
```

## Estrutura

```
bridge/                         # serviço HTTP único (container Deno, deploy via Coolify)
  server.ts                     #   router: /hub-webhook /chatwoot-webhook /connect-channel /metrics-rollup
  Dockerfile                    #   Coolify builda isto
  handlers/
    hub-webhook.ts              #   Meta -> Chatwoot + Postgres  (entrada + lifecycle)
    chatwoot-webhook.ts         #   Chatwoot outgoing -> /meta/*  (saída)
    connect-channel.ts          #   botão "Conectar" -> cria canal Hub + inbox Chatwoot
    metrics-rollup.ts           #   rollup diário (operacional + comercial)
  shared/                       #   helpers (hmac, supabase, hub, chatwoot, env)
supabase/migrations/0001_init.sql   # schema
scripts/apply-migration.mjs         # aplica migrations sem psql (npm run db:apply)
web/                                # dashboard Next.js (Fase 2+)
```

## Deploy da ponte (Coolify)

1. Subir este repo num git (GitHub/GitLab) acessível ao Coolify.
2. Coolify → New Resource → **Dockerfile**, apontando para `bridge/` (build context = `bridge`).
3. Setar as variáveis de ambiente (do `.env`) no serviço Coolify.
4. Atribuir domínio público `cofre.camposoberano.com.br` → vira `BRIDGE_PUBLIC_BASE`.
5. Healthcheck: `GET /health` → `ok`.

## Sync Facebook Messenger (fallback)

O webhook de lifecycle do EVO Hub funciona, mas o evento de mensagem do Messenger pode não ser entregue pela Meta/EVO Hub. Para fechar a entrada de mensagens, a ponte expõe um fallback por pull:

```bash
GET /sync-facebook?token=<SYNC_SECRET>&since_minutes=10
```

No Coolify, crie um cron a cada 30-60 segundos apontando para:

```text
https://cofre.camposoberano.com.br/sync-facebook?token=<SYNC_SECRET>&since_minutes=10
```

`SYNC_SECRET` é opcional; se não for definido, o endpoint usa `CHATWOOT_WEBHOOK_SECRET`.

## Pré-requisitos de infra (self-host) — destravar antes de aplicar

Alvo: **Supabase self-host `https://bancortovital.soberano.pro`**.

1. **Credenciais** do `bancortovital`: `SUPABASE_DB_URL` (com senha), `service_role` e `anon` keys → preencher `.env`.
2. **MCP / acesso**: o MCP Supabase conectado hoje aponta para `bancodedados.soberano.pro` e a auth falha. Reapontar para `bancortovital` com credencial válida, **ou** aplicar migrations via `supabase` CLI / `psql` usando `SUPABASE_DB_URL`.
3. **Edge runtime**: confirmar container `edge-runtime` ativo e Kong expondo `/functions/v1`. Se não houver, a ponte roda como micro-serviço Deno/Node containerizado (mesma lógica).
4. **pg_cron**: habilitar para o `metrics-rollup` agendado.
5. **Reachability/TLS**: `bancortovital.soberano.pro` precisa ser alcançável pela internet (Hub e Chatwoot entregam webhook nele).

## Aplicar o schema

Via CLI (com `SUPABASE_DB_URL` no `.env`):

```bash
psql "$SUPABASE_DB_URL" -f supabase/migrations/0001_init.sql
# ou: supabase db push  (com supabase/ linkado ao projeto self-host)
```

## Aplicar migration (sem psql/supabase CLI)

Node 22 já basta:

```bash
npm install                       # instala 'pg'
# preencha .env (SUPABASE_DB_URL) primeiro
npm run db:apply                  # aplica supabase/migrations/*.sql
npm run db:apply -- 0002_llm_orchestration.sql  # aplica somente a 0002
```

Se o projeto Supabase já tiver tabelas `public.conversations` ou
`public.messages` de outro sistema, não aplique a `0001` em `public`. Use o SQL
manual `supabase/manual/0001_0002_evohub_schema.sql`, que cria a base da ponte no
schema dedicado `evohub`. Depois exponha `evohub` em Project Settings -> API ->
Data API -> Exposed schemas.

## Projeto 1: rotacao de multiagentes (3+ LLMs)

Base inicial ja versionada para evoluir a orquestracao:

- Contrato tecnico: `docs/projeto-1-multiagentes-contrato.md`
- Roteador e handoff (TS): `bridge/shared/llm-orchestrator.ts`
- Persistencia e auditoria (SQL): `supabase/migrations/0002_llm_orchestration.sql`

Objetivo operacional:

1. Rotear tarefas pelo melhor modelo por especialidade.
2. Trocar automaticamente quando houver quota/timeout.
3. Registrar handoff obrigatorio para nao perder contexto.
4. Aplicar revisao cruzada para tarefas de maior risco.

## Prompt caching

O repositorio agora traz uma base para prompt caching mais correta:

- documento reutilizavel: `docs/protocolo-contexto-persistente-e-prompt-caching.md`
- prefixo estavel do projeto: `.ai-context/PROMPT_CACHE_PREFIX.md`
- bundle consolidado: `npm run ai:bundle`
- helper TS para chamadas OpenAI compativeis: `bridge/shared/prompt-cache.ts`
- auditoria de cache em `llm_runs` (`cached_tokens`, `cache_write_tokens`, `cache_hit`)

Regra pratica: use contexto estavel no inicio da chamada, marque o breakpoint de cache e deixe pedido dinamico, logs e detalhes da tarefa depois disso.

Exemplo de uso no endpoint:

```json
{
  "mode": "execute",
  "area": "backend",
  "risk": "medium",
  "title": "Auditar fluxo",
  "objective": "analisar impacto de uma mudanca no webhook",
  "payload": {
    "context_prefix": "conteudo de .ai-context/PROMPT_CACHE_BUNDLE.md",
    "files": ["bridge/handlers/hub-webhook.ts"]
  },
  "instructions": "Responda com plano tecnico curto."
}
```

Smoke test local depois de configurar `OPENAI_API_KEY`:

```bash
deno run --allow-env --allow-net --allow-read bridge/scripts/test-llm-execute.ts
```
## Status

- [x] Schema `0001_init.sql`
- [x] Scaffold + `.env.example` + script de migration (`npm run db:apply`)
- [x] Código da ponte (`bridge/`): hub-webhook, chatwoot-webhook, connect-channel, metrics-rollup
- [x] Repo GitHub privado `Camposoberano/evohub-bridge` (push feito)
- [x] Credencial EVO Hub validada (api.evohub.ai, plano Pro Lançamento)
- [x] Credencial Chatwoot validada (gerenciador.soberano.pro, account 2)
- [ ] Supabase `SERVICE_ROLE_KEY` + `ANON_KEY` no `.env`  ← falta
- [ ] Aplicar `0001_init.sql` (Studio SQL Editor do bancortovital)  ← falta
- [ ] Deploy da ponte no Coolify (GitHub App, base dir `/bridge`, port 8000)
- [ ] Testar loop WhatsApp texto ponta a ponta (Fase 1)
- [ ] Página Conexões + FB/IG (Fase 2)
- [ ] Mídia/templates (Fase 3)
- [ ] Analytics + rollups (Fase 4)
- [ ] Hardening (Fase 5)
```

## Arquivo: .ai-context/PROMPT_CACHE_PREFIX.md

# Prefixo Estavel do Projeto

Projeto: EvoHub
Objetivo: integrar mensageria, atendimento, automacao e observabilidade em uma unica operacao.

## Arquitetura duravel

- Bridge Deno em `bridge/`
- Dashboard Next.js em `web/`
- Supabase como base operacional e analitica
- Chatwoot como camada de atendimento
- EVO Hub, Uazapi e RyzeAPI como integracoes de mensageria

## Regras duraveis

- a logica de negocio central fica no bridge;
- o Chatwoot e camada de conversa, nao de regra de negocio;
- contexto estavel deve vir antes do contexto de tarefa;
- logs, debug bruto e status do dia ficam fora do prefixo cacheavel;
- segredos nunca entram em bundles de contexto.

## Convencoes de uso com IA

- reaproveitar prefixos estaveis;
- anexar detalhes variaveis so depois do breakpoint de cache;
- medir `cached_tokens` e `cache_write_tokens` nas chamadas compativeis;
- manter o bundle estavel pequeno, legivel e sem ruido operacional.

## Arquivo: .ai-context/REGRAS_DO_PROJETO.md

# Regras do Projeto

- Nao misturar este projeto com outros projetos.
- Nao criar arquivos de configuracao global dentro do projeto sem necessidade.
- Nao expor chaves API em arquivos.
- Antes de editar muitos arquivos, apresentar plano curto.
- Se a tarefa for apenas duvida, nao alterar arquivos.
- Ao terminar uma sessao, atualizar ULTIMA_SESSAO.md.

## Arquivo: docs/projeto-1-multiagentes-contrato.md

# Projeto 1 - Contrato tecnico de orquestracao multi-LLM (v1)

## Objetivo

Criar um fluxo com 3 LLMs ou mais, com especializacao por tarefa, fallback automatico e revisao cruzada.

## Resultado esperado

1. Sem bloqueio quando um provider ficar sem quota.
2. Troca de modelo sem perder contexto.
3. Menos erro repetido na mesma categoria de tarefa.
4. Trilha auditavel de decisao, custo, latencia e qualidade.

## Acoplamento com este repositorio

1. Bridge Deno decide rota e persiste tentativas.
2. Supabase guarda tarefas, runs, handoff e quality gates.
3. Web/Next mostra fila e saude dos modelos.

Arquivos centrais:

1. bridge/shared/llm-orchestrator.ts
2. bridge/handlers/llm-orchestrate.ts
3. supabase/migrations/0002_llm_orchestration.sql
4. web/app/orquestracao/page.jsx

## API da bridge

Endpoint:

1. POST /llm-orchestrate

Autenticacao:

1. Header Authorization: Bearer <LLM_ROUTER_API_TOKEN> quando o token estiver configurado.

### Modo route

Cria llm_task + primeira llm_run com status started.

```json
{
  "mode": "route",
  "external_ref": "ticket-42",
  "area": "frontend_visual",
  "risk": "high",
  "title": "Refinar tela de conexoes",
  "objective": "melhorar UX sem regressao funcional",
  "payload": { "files": ["web/app/conexoes/page.jsx"] },
  "requires_review": true,
  "blocked_model_ids": ["cloud_arch"]
}
```

### Modo execute

Cria llm_task + llm_run inicial, executa a chamada OpenAI no proprio endpoint e finaliza a tentativa com trilha de cache.

```json
{
  "mode": "execute",
  "external_ref": "ticket-43",
  "area": "backend",
  "risk": "medium",
  "title": "Gerar plano de correção",
  "objective": "propor ajuste seguro para webhook duplicado",
  "payload": {
    "context_prefix": "PREFIXO ESTAVEL GRANDE AQUI",
    "files": ["bridge/handlers/chatwoot-webhook.ts"]
  },
  "instructions": "Seja direto e priorize baixo risco."
}
```

Campos uteis para prompt caching:

1. `payload.context_prefix` ou `context_prefix` para enviar o bundle estavel
2. `cache_tenant` para separar prefixos por cliente/escopo
3. `model_name` para override do modelo OpenAI

### Modo attempt

Registra tentativa, atualiza status da tarefa, opcionalmente grava gates e handoff.

```json
{
  "mode": "attempt",
  "task_id": "<uuid>",
  "model_id": "codex_exec",
  "role": "primary",
  "status": "succeeded",
  "attempt_no": 2,
  "latency_ms": 8100,
  "total_tokens": 5200,
  "gates": {
    "lint": "pass",
    "build": "pass",
    "tests": "pass",
    "security": "na"
  }
}
```

## Contrato de handoff

Nenhuma troca de modelo deve ocorrer sem handoff.

Campos minimos:

1. taskId
2. objective
3. completedSteps
4. pendingSteps
5. failures
6. nextAction
7. gates

## Politica de roteamento

Formula base de score:

score = 0.40*especialidade + 0.25*disponibilidade + 0.15*historico + 0.10*latencia + 0.10*custo

Regras:

1. risk high força reviewer, quando houver.
2. Falhas consecutivas removem modelo do pool preferencial.
3. Quota/timeout move para fallback.
4. Reviewer pode reprovar e abrir nova tentativa.

## Quality gates

1. lint
2. build
3. tests
4. security

## SLOs iniciais

1. Sucesso por tarefa >= 90%.
2. Fallback sem bloqueio manual >= 95%.
3. Reducao de retrabalho >= 30%.
4. Latencia p95 por tentativa <= 25s.

## Roadmap de implantacao

1. Aplicar migration 0002 e seeds de modelo.
2. Integrar chamada do endpoint /llm-orchestrate no fluxo operacional.
3. Instrumentar quality gates por tentativa.
4. Monitorar dashboard /orquestracao e ajustar pesos.
