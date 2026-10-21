# Rotação de campanhas por número — plano de implementação

> **For agentic workers:** Executar nesta sessão, em branch isolada, com revisão após cada tarefa.

**Goal:** Cumprir a meta diária por número, alternando 5895, 0595 e 6836 entre 08h e 18h.

**Architecture:** Um seletor puro calcula a próxima oportunidade por número. O loop consulta contadores e pendências explícitas, reserva um item com exclusão global e conserva as validações atuais.

**Tech Stack:** Deno/TypeScript, Supabase Postgres, Coolify.

**Spec:** `docs/superpowers/specs/2026-10-21-rotacao-campanhas-por-numero-design.md`

## Global Constraints

- Campanhas alvo: `reativacao-5895-of`, `reativacao-5895-uz`, `reativacao-0595-uz`, `reativacao-6836-uz`.
- Janela 08h–18h Fortaleza; teto 25 no primeiro dia, +5/dia até 100 por número.
- 5895 oficial e botões compartilham teto; não duplicar contatos nem retirar validações.

## Tarefa 1 — seleção e ritmo

**Files:** `bridge/shared/campaign-rotation.ts`, `bridge/tests/campaign-rotation.test.ts`.

- [ ] Criar casos com três números em zero: primeira seleção 5895, próxima oportunidade cerca de oito minutos depois com 0595, depois 6836.
- [ ] Criar caso com 5895 parcialmente enviado e outros dois atrasados; selecionar o menor progresso proporcional e recalcular o espaçamento pelo tempo restante.
- [ ] Implementar seletor determinístico, limite diário por número e janela rígida.
- [ ] Executar `deno test` e `deno check` dos arquivos.

## Tarefa 2 — dados e reserva

**Files:** `bridge/shared/campaign-queue.ts`, migração SQL nova, testes do helper.

- [ ] Consultar contadores exatos e último envio das quatro campanhas, sem paginação truncada.
- [ ] Implementar reserva transacional que recusa nova reserva se alguma das quatro campanhas estiver `processing`.
- [ ] Testar contagem e reserva sem alterar demais campanhas.

## Tarefa 3 — integração e publicação

**Files:** `bridge/server.ts`, testes de integração focados.

- [ ] Trocar o loop de quatro campanhas pelo seletor, mantendo preflight, pausas e gravação existentes.
- [ ] Revalidar teto e intervalo após reserva antes de chamar o provedor.
- [ ] Rodar testes, checagem de tipos e diff check.
- [ ] Publicar apenas após confirmar migração e branch `main` do Coolify; conferir saúde e progresso de 5895, 0595 e 6836.
