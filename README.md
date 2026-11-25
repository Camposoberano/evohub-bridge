# EVO Hub Bridge

Ponte entre o **EVO Hub** (proxy da Meta: WhatsApp oficial, Facebook, Instagram), a **uazapi**
(WhatsApp não-oficial) e o **Chatwoot**, com um painel próprio e o Supabase como base de dados.

## Comece por aqui

| Preciso de… | Leia |
|---|---|
| Regras que não podem ser quebradas, deploy, Coolify, segurança | [`CLAUDE.md`](CLAUDE.md) |
| Regras de produto/funil decididas pelo dono | [`AGENTS.md`](AGENTS.md) |
| O que está em produção agora e o que ficou pendente | topo do [`HANDOFF.md`](HANDOFF.md) |
| Arquitetura, rotas, ciclos automáticos, linha do tempo | [`docs/README.md`](docs/README.md) |
| Registros antigos (julho a setembro) | [`docs/historico/`](docs/historico/) |

Quando dois documentos discordarem, vale nesta ordem: código no `main` → `CLAUDE.md`/`AGENTS.md`
→ topo do `HANDOFF.md` → `docs/` → `docs/historico/`.

## Branches e deploy

- **Produção builda do `main`.** O `master` (padrão do GitHub) ficou para trás; abra branch e PR a
  partir do `main`.
- O push no `main` não faz deploy sozinho. O deploy é pedido no Coolify (detalhes no `CLAUDE.md`).
- **Não reiniciar nem deployar o bridge entre 8h e 20h (horário de Brasília)** com campanha
  disparando: o envio em andamento fica "incerto" e a campanha da instância se auto-pausa.

## Estrutura

```
bridge/              servidor Deno (Coolify "SERVIDOR", cofre.camposoberano.com.br)
  server.ts          roteador + ciclos automáticos
  handlers/          uma rota por arquivo (webhooks, funil, campanhas, relatórios)
  shared/            regras de negócio e clientes (Supabase, Chatwoot, uazapi, Meta)
  tests/             deno test
web/                 painel Next.js (Coolify "PAINEL", painel.camposoberano.com.br)
supabase/migrations/ schema versionado (ver README da pasta)
supabase/manual/     SQL aplicado à mão no VPS (índices CONCURRENTLY etc.)
ops/                 auditorias, roteiros de operação, workflows n8n
scripts/             utilitários locais (npm run db:apply, npm run ai:bundle)
docs/                documentação viva; docs/historico/ = registros antigos
```

## Segurança

- Este repositório é **público**. Nunca commitar `.env`, token, senha, telefone ou nome de cliente.
  O modelo de variáveis é o [`.env.example`](.env.example).
- O cadastro público do Supabase precisa ficar **fechado** (`DISABLE_SIGNUP=true`), porque o painel
  e várias rotas aceitam qualquer usuário logado. Detalhes no `CLAUDE.md`, seção Segurança.

## Rodar localmente

```bash
cp .env.example .env          # preencher com valores reais (nunca commitar)
cd bridge && deno task dev    # servidor na porta 8000
deno test -A bridge/tests     # testes
npm run db:apply              # aplica migrations via SUPABASE_DB_URL (Postgres não abre pra fora: rodar no VPS)
```

Contexto estável para LLM (prompt caching): `.ai-context/PROMPT_CACHE_PREFIX.md`,
`.ai-context/REGRAS_DO_PROJETO.md` e `npm run ai:bundle`.
