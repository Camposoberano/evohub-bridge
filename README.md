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
