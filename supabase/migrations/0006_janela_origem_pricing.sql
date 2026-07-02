-- Janela 24h/72h + custos (mudanças Meta ago-out/2026) — adapta tabelas existentes.
-- conversations.origem: 'anuncio' (CTWA/free entry point -> janela 72h) | null (orgânico -> 24h)
-- conversations.referral: payload cru do referral do webhook (ad_id, ctwa_clid, source_url...)
-- messages.pricing_category: categoria de cobrança vinda do status da Meta (service/marketing/utility...)
alter table conversations add column if not exists origem text;
alter table conversations add column if not exists referral jsonb;
alter table messages add column if not exists pricing_category text;
