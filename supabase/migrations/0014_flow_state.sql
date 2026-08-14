-- 0014_flow_state.sql
-- Posição de cada contato dentro de um fluxo conversacional.
--
-- Por que tabela e não o campaigns.json que já existe: aquele arquivo é lido inteiro,
-- modificado em memória e regravado inteiro. Enquanto o único evento era "o lead respondeu
-- ao template", isso passava; num fluxo interativo cada resposta é uma escrita, e duas
-- respostas simultâneas fazem a segunda sobrescrever a primeira — o lead perde o lugar na
-- conversa e recebe a pergunta de novo, ou nada.
--
-- Uma linha por (campanha, contato) com unique: o upsert vira atômico e a concorrência
-- deixa de ser problema.

-- NOME: `campaign_flow_state`, não `flow_state`. O Supabase Auth já tem uma `auth.flow_state`
-- (estado de PKCE), e `create table if not exists flow_state` sem qualificar o schema
-- encontra aquela pelo search_path e não cria nada — silenciosamente. Foi o que aconteceu na
-- primeira tentativa: a migration "rodou" e a tabela nunca existiu.
-- Schema explícito pelo mesmo motivo.

create table if not exists public.campaign_flow_state (
  id uuid primary key default gen_random_uuid(),
  campaign_id text not null,
  -- número só com dígitos, mesma normalização de campaigns.numKey
  contact_key text not null,
  conversation_id uuid,
  channel_id uuid,
  -- step em que o fluxo parou aguardando resposta; null = terminou
  step_id text,
  -- quando entrou em espera — base do timeout
  waiting_since timestamptz,
  status text not null default 'waiting',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (campaign_id, contact_key)
);

-- O loop de timeout varre por quem está esperando há mais tempo que o permitido.
create index if not exists idx_campaign_flow_state_waiting
  on public.campaign_flow_state (waiting_since)
  where status = 'waiting';

-- Webhook resolve o estado pelo número que respondeu.
create index if not exists idx_campaign_flow_state_contact
  on public.campaign_flow_state (contact_key)
  where status = 'waiting';

comment on table public.campaign_flow_state is 'Posição de cada contato num fluxo conversacional (shared/flow.ts). Uma linha por campanha+contato; o unique torna o upsert atômico, evitando a perda de escrita que o campaigns.json tinha sob respostas simultâneas. Nome com prefixo porque `flow_state` colide com a tabela interna do Supabase Auth.';
comment on column public.campaign_flow_state.step_id is 'Step do fluxo em que parou aguardando resposta. Null com status=done significa fluxo concluído.';
comment on column public.campaign_flow_state.waiting_since is 'Início da espera. Comparado com FlowStep.timeoutMin para decidir se o fluxo segue sozinho por onTimeout.';
