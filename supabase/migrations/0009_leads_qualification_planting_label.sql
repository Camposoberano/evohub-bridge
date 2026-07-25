-- 0009_leads_qualification_planting_label.sql
-- "Pra quando está previsto o plantio?" é resposta livre do lead ("setembro", "próxima safra",
-- "já plantei") — não cabe direto numa coluna date. Guarda o texto bruto; planting_date (date)
-- fica pra quando/se alguém normalizar manualmente ou com um parser mais robusto depois.
alter table leads_qualification add column if not exists planting_date_label text;
alter table leads_qualification add column if not exists objective_code text;
