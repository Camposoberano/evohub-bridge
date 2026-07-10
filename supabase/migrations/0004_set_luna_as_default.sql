-- 0004_set_luna_as_default.sql
-- Define o GPT-5.6 Luna como modelo OpenAI principal do roteador.

update llm_models
set
  model_name = 'gpt-5.6-luna',
  notes = 'modelo principal OpenAI: rapido e otimizado para custo; Prompt Cache ativo',
  updated_at = now()
where id = 'codex_exec'
  and provider = 'openai';

-- Garante que o modelo exista em bancos onde o seed inicial ainda nao foi aplicado.
insert into llm_models (id, provider, model_name, specialties, priority, cost_score, notes)
values (
  'codex_exec',
  'openai',
  'gpt-5.6-luna',
  '{backend,debug,tests,analysis}'::llm_task_area[],
  20,
  0.650,
  'modelo principal OpenAI: rapido e otimizado para custo; Prompt Cache ativo'
)
on conflict (id) do nothing;
