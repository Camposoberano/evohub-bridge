-- 0018_campaign_flow_state_flow_ref.sql
-- Suporte ao nó "Ir para fluxo" (goto): guardar QUAL fluxo o contato está seguindo.
-- Portado do hub CECAPE.
--
-- Hoje a posição em `campaign_flow_state` só diz o step_id, e o fluxo vem sempre de
-- `camp.flow` (o fluxo da campanha). Isso basta enquanto um contato nunca troca de fluxo. O
-- nó goto quebra essa premissa: ao saltar pra outro fluxo publicado, a próxima resposta do
-- lead precisa ser resolvida contra o fluxo-ALVO, não o da campanha. Sem onde guardar "em qual
-- fluxo ele está agora", o salto não sobrevive à primeira pergunta.
--
-- `flow_ref` guarda o id da VERSÃO publicada (flow_versions) para onde o contato saltou. NULL =
-- seguindo o fluxo da campanha (comportamento atual, inalterado). O código trata a coluna como
-- opcional (try/catch) — esta migration pode ser aplicada antes ou depois do deploy sem quebrar.
--
-- Rodar no Supabase Studio (SQL Editor), server-side — NUNCA expondo a porta 5432.

alter table public.campaign_flow_state
  add column if not exists flow_ref text;

comment on column public.campaign_flow_state.flow_ref is
  'Nó goto: id da versão de fluxo publicada que o contato passou a seguir. NULL = fluxo da campanha.';
