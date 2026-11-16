-- 0018 — índice (event_type, received_at) para as consultas do monitor
--
-- PROBLEMA (medido em 23/10/2026):
--   O operational-monitor estoura statement_timeout (57014) a cada rodada. Ele faz VÁRIAS
--   consultas no formato `where event_type = $1 and received_at >= now()-1h` (midia_indisponivel,
--   inbound_recovered, catchup_degradado, pediu_humano, inbound_sem_canal, …) — SEM filtrar por
--   `source`. Os índices existentes em `events` são:
--     - (channel_id, received_at)
--     - (source, event_type, received_at)   <- lidera por `source`, inútil sem ele
--     - (received_at)                        <- 0013; só recorta a janela de tempo
--   Com a tabela inflada (sync-facebook grava `sync_completed` em volume), recortar 1h pelo
--   índice (received_at) ainda deixa muitas linhas para filtrar por event_type em memória.
--
-- SOLUÇÃO: índice composto com event_type na frente, received_at em seguida. Transforma as
--   consultas do monitor em varredura de faixa estreita (um event_type, última hora).
--
-- CONCURRENTLY: constrói sem travar escrita; não roda dentro de bloco de transação (se a
--   ferramenta de migration envolver tudo num BEGIN, rode este arquivo à parte).
--
-- REVERSÍVEL: drop index concurrently if exists idx_events_event_type_received_at;
--
-- NOTA: o conserto estrutural é a limpeza voltar a drenar a tabela (DELETE em lotes em
--   startDataCleanupLoop, bridge/server.ts). Este índice é o complemento que torna as
--   consultas do monitor previsivelmente rápidas mesmo durante a drenagem.

create index concurrently if not exists idx_events_event_type_received_at
  on events (event_type, received_at desc);
