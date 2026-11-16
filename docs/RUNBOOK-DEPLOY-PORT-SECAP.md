# Runbook de deploy — Port SECAP (fluxo + contatos)

Deploy do PR que traz o construtor de fluxo e a leitura de contatos da faculdade CECAPE pro
EvoHub. **Tudo novo entra atrás de env flag default-off** — aplicar as migrations e subir o código
NÃO muda nada em produção até você ligar as flags. Siga a ordem.

## Pré-requisitos
- Schema das tabelas = **`public`** (ver `docs`/memória: o `SUPABASE_SCHEMA=evohub` do `.env.example`
  é resíduo stale; prod roda em `public`). Todas as migrations abaixo qualificam `public.`.
- DDL é **manual via Supabase Studio** (SQL Editor). Nunca expor a porta 5432. No Studio:
  `set role supabase_admin;` antes dos `create/alter` (postgres não é dono). Sem `CONCURRENTLY`.
- Reusa a função `public.can_read_operational_campaigns()` + `app_private.dashboard_readers` da
  migration `0016` (já existe). Confirme antes.

---

## Passo 1 — Migrations (Supabase Studio, schema public)

Rodar **em ordem**, uma por vez, conferindo que não deu erro. Todas são idempotentes.

| Ordem | Arquivo | O que cria | Depende de |
|---|---|---|---|
| 1 | `0017_flow_definitions.sql` | `flow_definitions`, `flow_versions` (biblioteca de fluxos + versões) | 0016 (RLS) |
| 2 | `0018_campaign_flow_state_flow_ref.sql` | coluna `flow_ref` em `campaign_flow_state` (nó goto) | 0014 |
| 3 | `0019_message_events.sql` | `message_events` (recibos de status) | — |
| 4 | `0021_audiences.sql` | `audiences`, `audience_contacts` (Públicos) | 0016 |
| 5 | `0022_audiences_colunas.sql` | colunas `columns`/`attributes` nos Públicos | 0021 |
| 6 | `0023_flow_triggers.sql` | `flow_triggers` (gatilho por resposta/keyword) | 0016 |
| 7 | `0024_contacts_attributes.sql` | coluna `attributes` em `contacts` (nó input) | 0001 |
| 8 | `0026_audience_columns.sql` | colunas nomeadas + RPCs `save/search_audience_contacts` + `audience_edit_log` | 0021 |
| 9 | `0028_audience_whatsapp_checks.sql` | `audience_whatsapp_checks` (cache da verificação WhatsApp) | 0021 |
| 10 | `0029_response_priority.sql` | colunas de SLA em `conversations` + trigger em `messages` | 0013 (bot_muted_at) |
| 11 | `0030_campaign_contact_variables.sql` | `campaign_contact_variables` (snapshot de variáveis do disparo) | 0021, 0026 |

Confirme ao final: `select count(*) from public.flow_definitions;` (e as demais) sem erro de relação.

---

## Passo 2 — Env no Coolify

**Bridge (SERVIDOR `m8qf6ru2x75gukzozpsrssrm`):** adicionar as envs abaixo. Deixe as flags em
branco/false AGORA — liga depois, uma a uma.

| Env | Para | Default p/ subir |
|---|---|---|
| `TYPESAFE_API_KEY` | nó Agente IA (Jev) e qualificação de lead | vazio (nós IA caem no fallback humano) |
| `FLOW_API_ALLOWLIST` | nó Chamada API (hosts liberados, vírgula) | vazio (bloqueia tudo) |
| `FLOW_GOTO_ENABLED` | nó Ir-para-fluxo (exige 0018) | não setar (=off) |
| `FLOW_KEYWORD_ENABLED` | iniciar fluxo por palavra-chave | off |
| `FLOW_WAIT_ENABLED` | sweeper dos nós de pausa (wait) | off |
| `FLOW_FREETEXT_JEV_ENABLED` / `FLOW_FREETEXT_JEV_MIN` | roteamento de texto livre por Jev | off / 0.6 |
| `FLOW_NINTH_DIGIT_MATCH` | casar resposta por 9º dígito BR | off |
| `FLOW_QUALIFY_JEV_MIN` | confiança mínima da temperatura de lead | 0.5 |
| `UAZAPI_INTERACTIVE_AS_TEXT` | botões/lista como menu numerado (aparelhos sem interativo) | off |
| `WHATSAPP_NAME_REPAIR_ENABLED` | loop de reparo de nome de contato (escreve no Chatwoot) | off |
| `RESPONSE_PRIORITY_ENABLED` | escalonamento de Prioridade nativa por SLA (escreve no Chatwoot) | off |

Já existentes (não mexer): `FLOW_TIMEOUT_ENABLED` (loop de timeout), `CHATWOOT_*`, `UAZAPI_*`.
Ponta solta: conferir/corrigir `SUPABASE_SCHEMA` se ainda estiver `evohub` — prod é `public`.

**Painel (PAINEL `ue0tgzd5a30jrxyenzff7piv`):** o `web/package.json` ganhou `@xyflow/react@^12.3.5`.
O build do Coolify roda `npm install` → puxa a dep sozinho. Sem env nova no painel.

---

## Passo 3 — Deploy do código

Trabalha em `master`, deploya `git push origin master:main` (Coolify observa `main`).
1. **Bridge** (SERVIDOR): sobe server.ts + handlers + libs novos. Confirmar por `/version`
   (uptime baixo) e logs: devem aparecer os loops só se a flag estiver on (ex.: "flow-wait loop ON").
2. **Painel** (PAINEL): sobe as páginas novas (`/fluxos` com canvas, `/publicos`, `/campanha-fluxo`).

---

## Passo 4 — Validar feature a feature (ligar flags uma por vez)

Sempre **dentro da janela 8h–20h BRT** para testes de envio. Use o canal `teste`, não a linha viva.

1. **Construtor de fluxo** (sem flag): em `/fluxos`, montar um fluxo no canvas (text→input→
   condition→transfer), **Publicar** versão, simular no FlowSimulator. Nenhum envio.
2. **Públicos** (sem flag): em `/publicos`, importar um CSV (nome+telefone), abrir a tabela,
   adicionar coluna, editar célula. Conferir dedupe.
3. **Verificação WhatsApp**: na tabela do público, escolher uma instância conectada → "Continuar
   verificação". Confere presença sem enviar nada.
4. **Disparo de campanha-fluxo**: em `/campanha-fluxo`, escolher fluxo publicado + canal `teste` +
   um Público pequeno → Lançar. Acompanhar a fila. Confirmar `{{nome}}`/`{{coluna}}` interpolados.
5. **Nós IA (Jev)**: setar `TYPESAFE_API_KEY`, testar em `/jev-test` (admin) → status "ok". Só então
   usar nós `ai` em fluxo real.
6. **goto / keyword / wait**: ligar `FLOW_GOTO_ENABLED` (após 0018), `FLOW_KEYWORD_ENABLED`,
   `FLOW_WAIT_ENABLED` uma por vez; `/restart` do bridge; validar no canal teste.
7. **Reparo de nome**: ligar `WHATSAPP_NAME_REPAIR_ENABLED`; conferir nos logs "whatsapp-name-sync:
   atualizou um contato" e que o nome foi corrigido no Chatwoot (1 escrita/ciclo, 3min).
8. **Prioridade SLA**: ligar `RESPONSE_PRIORITY_ENABLED`; a prioridade nativa do Chatwoot deve subir
   em conversa sem resposta humana (5/10/15/20min) e zerar quando o atendente responde.
9. **Reconcile de contatos** (sem flag, sob demanda): `POST /customer-reconcile {inbox_id, page,
   apply:false}` (dry-run) → confere a contagem; depois `apply:true` numa página pequena.

---

## Rollback
- Flags: basta remover/`false` a env e `/restart` do bridge — o comportamento volta ao anterior.
- Migrations: são aditivas (novas tabelas/colunas). Não precisam ser revertidas pra desligar uma
  feature; a flag off já basta. Se precisar, `drop` manual da tabela/coluna no Studio.
- Código: `git revert` do commit da fase + redeploy.

## Regras que não mudam (lembretes)
- Disparo só 8h–20h BRT; o botão oficial não trava horário — conferir na mão.
- Toda escrita que toca o Chatwoot (reparo de nome, prioridade) é best-effort e throttled, mas
  liga só após validar no teste — são as flags de maior impacto.
- `can_read_operational_campaigns()` controla o acesso do painel aos endpoints novos; quem não
  está em `app_private.dashboard_readers` recebe 403.
