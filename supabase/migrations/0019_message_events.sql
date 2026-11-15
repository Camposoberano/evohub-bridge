-- 0019_message_events.sql
-- Ciclo de vida das mensagens (relatórios): captura os recibos de status que a
-- uazapi já manda (entregue/lido/falha) via webhook `messages_update`/`ReadReceipt`, que hoje só
-- caíam em `events` sem virar métrica. Destrava taxa de entrega/leitura por canal/dia.
-- Portado do hub CECAPE.
--
-- MVP defensivo: o shape do status da uazapi varia por versão, então o capturador mapeia os casos
-- comuns e, quando NÃO reconhece, grava `status='desconhecido'` + o payload cru em `raw` — assim
-- nada se perde e o mapeamento é refinado a partir de linhas reais, sem chutar no escuro.
--
-- Rodar no Supabase Studio (SQL Editor), server-side — NUNCA expondo a porta 5432.

create table if not exists public.message_events (
  id uuid primary key default gen_random_uuid(),
  external_id text,                 -- id da mensagem no provedor (uazapi/meta)
  provider text default 'uazapi',
  direction text default 'out',     -- status é sobre a NOSSA saída
  status text,                      -- sent | delivered | read | failed | desconhecido
  status_at timestamptz,            -- timestamp do provedor (ou recebido)
  channel_id uuid,
  conversation_id uuid,
  campaign_id text,
  flow_id text,
  step_id text,
  error_code text,
  cost_estimado numeric,
  cost_real numeric,
  raw jsonb,                        -- payload cru quando o status não foi reconhecido
  dedupe_key text,                  -- provider:external_id:status — idempotência de webhook
  created_at timestamptz default now()
);

-- Idempotência: o mesmo recibo (ex.: "read" da mesma mensagem) pode chegar repetido.
create unique index if not exists uidx_message_events_dedupe
  on public.message_events (dedupe_key) where dedupe_key is not null;

-- Consultas por canal/dia e por mensagem.
create index if not exists idx_message_events_status_at on public.message_events (status_at);
create index if not exists idx_message_events_external on public.message_events (external_id);

comment on table public.message_events is
  'Recibos de status das mensagens (entregue/lido/falha) p/ métricas.';
