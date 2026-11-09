# Fotos reais no Mega Sorgo 7 dias Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remover o texto repetido após o áudio e usar fotos reais do acervo nas peças visuais do funil isolado.

**Architecture:** O catálogo JSON determina ordem e `media_ref`; slots inéditos apontam para novas fotos cadastradas no Storage e em `funnel_media`. O bridge continua a despachar pela mesma fila, com anúncios antigos intocados.

**Tech Stack:** Deno/TypeScript, JSON, Supabase Storage e PostgREST.

**Spec:** `docs/superpowers/specs/2026-11-09-mega-sorgo-7d-fotos-reais-design.md`

## Global Constraints

- Usar apenas fotos `12.jpg`, `15.jpg`, `16.jpg`, `18.jpg` e `20.jpg` do acervo real.
- Não gerar pixels por IA nem afirmar rendimento em legenda de fotografia.
- Permanecem dez áudios, cinco vídeos sob aceite e a janela 08h–20h BRT.
- Não mudar o roteamento dos anúncios 5895/6836.

---

### Task 1: Catálogo e validação

**Files:** `bridge/shared/mega-sorgo-7d-content.json`, `bridge/shared/mega-sorgo-7d-content.ts`, `bridge/tests/mega-sorgo-7d-content.test.ts`, `bridge/tests/n8n-action-enqueue.test.ts`, `bridge/scripts/audit-mega-sorgo-7d-test.py`.

- [ ] Testar que a abertura é áudio seguido de foto, sem a peça `01`, com 33 peças e dez áudios.
- [ ] Rodar o teste e observar falha no catálogo antigo.
- [ ] Retirar a peça `01`; trocar `02` por foto 18, `16b1` por foto 12, `28` por foto 15; revisar as legendas das fotos 16 e 20 para descrever só o visível.
- [ ] Atualizar o validador, os demais testes e o auditor de 34 para 33, incluindo exigência dos novos slots.
- [ ] Rodar os testes focados e `deno check bridge/server.ts`.

### Task 2: Cadastro de mídias

**Files:** `bridge/scripts/stage-mega-sorgo-7d-media.ts`.

- [ ] Conferir que as cinco fotos fonte existem e os novos slots ainda não existem.
- [ ] Rodar o estágio sem `--apply`; validar origem, tipo e destinos.
- [ ] Cadastrar os novos slots/caminhos de foto sem sobrescrever os existentes e conferir HTTP 200 de cada arquivo.
- [ ] Conferir que as peças históricas continuam usando suas URLs antigas.

### Task 3: Publicação e conferência

**Files:** `HANDOFF.md`, `docs/superpowers/plans/2026-11-09-mega-sorgo-7d-verificacao.md`, `bridge/server.ts`.

- [ ] Atualizar build manual e roteiro para 33 peças e abertura áudio/foto; registrar estado no handoff.
- [ ] Rodar testes focados, checagem de tipos e `git diff --check`.
- [ ] Publicar no `main` com diff pontual; implantar o bridge somente fora de 08h–20h BRT ou com OK explícito.
- [ ] Confirmar Coolify commit, `/version`, `/health` e ausência de novas inscrições automáticas nos anúncios.
