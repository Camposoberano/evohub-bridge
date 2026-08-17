-- 0015_campaign_queue.sql
-- Fila de disparo de campanha, consumida no ritmo em vez de tudo de uma vez.
--
-- `start-fluxo` é síncrono: a resposta só volta quando o último contato termina. Com o
-- intervalo humano que a operação exige (4 a 17 minutos entre contatos), 200 contatos
-- levariam 14 horas numa única request HTTP — nenhum proxy segura isso. Enfileirar resolve:
-- a chamada devolve na hora e um loop consome no ritmo, sobrevivendo a restart do container.
--
-- Nome com prefixo `campaign_` pelo mesmo motivo de `campaign_flow_state`: nome genérico
-- colide com tabela de sistema do Supabase e a migration falha em silêncio.

create table if not exists public.campaign_queue (
  id uuid primary key default gen_random_uuid(),
  campaign_id text not null,
  -- número só com dígitos, mesma normalização de campaigns.numKey
  contact_key text not null,
  channel_id uuid,
  -- pending → sent | failed | skipped
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- o mesmo contato não entra duas vezes na mesma campanha
  unique (campaign_id, contact_key)
);

-- O loop pega o próximo pendente da campanha, em ordem de entrada.
create index if not exists idx_campaign_queue_proximo
  on public.campaign_queue (campaign_id, created_at)
  where status = 'pending';

-- Contagem do que já saiu hoje, para respeitar o teto diário.
create index if not exists idx_campaign_queue_enviados
  on public.campaign_queue (campaign_id, sent_at)
  where status = 'sent';

comment on table public.campaign_queue is 'Fila de contatos de uma campanha de fluxo, consumida por loop no ritmo configurado. Existe porque start-fluxo é síncrono e não aguenta horas numa request.';
comment on column public.campaign_queue.status is 'pending → sent | failed | skipped. `skipped` é contato excluído em tempo de envio (bot travado, já comprou, virou lead ativo).';
comment on column public.campaign_queue.attempts is 'Tentativas de envio. Protege contra loop infinito num contato que falha sempre.';
