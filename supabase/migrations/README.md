# Migrations

`npm run db:apply` aplica os arquivos `*.sql` desta pasta em **ordem alfabética**
(`scripts/apply-migration.mjs`). Em produção a porta do Postgres não abre para fora: rode no VPS,
pelo terminal do Coolify no container `supabase-db-*`, como `supabase_admin` (ver `CLAUDE.md`).

## Números repetidos

Sete números foram usados duas ou três vezes por branches paralelas. A ordem alfabética resolve o
empate e não há dependência conhecida entre os pares, mas **não reaproveite estes números** e
confira no banco antes de reaplicar qualquer um deles:

| Nº | Arquivos |
|---|---|
| 0003 | `0003_clientes.sql`, `0003_llm_prompt_cache_metrics.sql` |
| 0004 | `0004_customer_identity.sql`, `0004_messages_wamid_uniq.sql`, `0004_set_luna_as_default.sql` |
| 0005 | `0005_channels_external_id_uniq.sql`, `0005_customer_identity_phone_repair.sql` |
| 0013 | `0013_bot_mute.sql`, `0013_events_retention_index.sql` |
| 0017 | `0017_campaign_number_rotation.sql`, `0017_flow_definitions.sql` |
| 0018 | `0018_campaign_flow_state_flow_ref.sql`, `0018_events_type_received_at_index.sql` |
| 0019 | `0019_events_fromme_expression_index.sql`, `0019_message_events.sql` |

Próxima migration nova: use o número seguinte ao maior existente, sem repetir.
