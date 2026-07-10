-- 0003_llm_prompt_cache_metrics.sql
-- Auditoria de prompt caching para chamadas OpenAI / modelos compativeis.

alter table if exists llm_runs
  add column if not exists cached_tokens int,
  add column if not exists cache_write_tokens int,
  add column if not exists cache_hit boolean,
  add column if not exists prompt_cache_key text,
  add column if not exists prompt_cache_ttl text,
  add column if not exists prompt_cache_mode text;
