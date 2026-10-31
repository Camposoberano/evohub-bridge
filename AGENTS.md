# AGENTS.md — EVO Hub Bridge

Padrão lido pela maioria dos agentes (Claude Code, Codex, Cursor, Gemini). A **fonte
compartilhada de estado entre qualquer LLM é este repositório git** — nunca só a memória
de um tool específico. Arquivos canônicos versionados: este `AGENTS.md`, `CLAUDE.md`,
`HANDOFF.md`, e os docs tópicos em `docs/`.

---

## Decisões travadas (correções que NÃO se repetem)

Regras duras. Cada uma já custou um incidente — não refazer o erro.

- **Chatwoot filter = 1 condição `equal_to` com todos os valores (IN), nunca N condições
  `equal_to` OR'd.** 16 OR levavam ~15s e estouravam timeout na VPS (HTTP 500 no
  controle de bot); 1 condição IN = 143ms–1,3s. Vale pra `macro-poll`/`bot-mute`/`outcome`.
- **`events` precisa do índice `idx_events_received_at`.** Sem ele, `order by received_at`
  = 8,6s/500 e espiral 57014; a tabela cresce sem limpar. Recriar via role
  **`supabase_admin`** (o `postgres` não é dono/superuser). Drenar backlog em lotes (VPS single-box).
- **Deploy builda do `main`, não `master`.** Os 2 apps Coolify observam `main`; `master`↔`main`
  divergiram. Publicar = cherry-pick/edit direto no `main` + **`POST /deploy`** (o endpoint
  virou POST; GET devolve 405). Confirmar por `uptime_s` baixo em `/version`.
- **NÃO deployar nem reiniciar o bridge entre 8h e 20h BRT.** Disparo de campanha ativo nessa
  janela; restart no meio pausa a campanha. Só com OK explícito do usuário.
- **VPS é uma caixa só** (`136.248.116.231`, 2 vCPU): Supabase + Chatwoot + bridge + fazer-ai
  + Grafana no mesmo IP. CPU é o gargalo. Operações pesadas (drain, scans) a **≤3 workers** +
  pausa, senão 100% CPU derruba as queries de todo mundo.
- **Lane de IA (fazer.ai): flag `AI_LANE_ENABLED` default OFF; o estado é a label `ai-vendas`;
  o `/ai-gate` é fail-closed.** Ligar a flag sem o wiring externo (agente bindado + `AI_GATE_SECRET`
  + contactAuth apontando pro `/ai-gate`) = lead no vácuo. Ver `docs/ai-lane-funil-agro.md`.
- **Não colar segredo no chat** — vai pro `.env`/Coolify/Chatwoot. Segredo exposto no chat
  entra na lista de rotação do handoff.

---

## Comando: salva tudo

Quando o usuário disser **"salva tudo"** (ou "salvar geral", "handoff", "encerra sessão",
"fecha", "guarda contexto", "salva estado"), rodar o checklist **completo** — nunca só o handoff:

1. **Handoff** — atualizar `HANDOFF.md` (raiz, versionado): estado (build/último deploy/branch),
   feito na sessão, pendente (com contexto pra retomar sem perguntar), dúvidas/em aberto, bloqueios.
2. **Decisões travadas** — toda correção pedida ou decisão revertida vira regra AQUI
   (`AGENTS.md`, seção acima) na hora, mais uma memória `feedback` com o porquê. NUNCA deixar
   correção só no handoff (ele é reescrito e some).
3. **Memórias** — fatos/feedback novos no diretório de memória do projeto + linha no `MEMORY.md`.
4. **Git** — commit do que falta; push pra `main` só com OK (confirmar antes se for código que
   rebuilda container).
5. **Roadmap/docs** — atualizar se o plano mudou.
6. **Relatório final** — listar item a item o que foi salvo + apontar qualquer ponta solta.

Regra de ouro: correção importante → arquivo versionado (`AGENTS.md`/`CLAUDE.md`) NA HORA,
não só num handoff volátil.

---

## Persistência

Persistência entre sessões/LLMs = 3 camadas **versionadas no git**:

- **`AGENTS.md` + `CLAUDE.md`** — regras e decisões travadas.
- **`HANDOFF.md`** (raiz) — estado vivo único + arquivo histórico. **Fonte canônica.**
- **`docs/`** — docs tópicos (arquitetura, features, referências).

A memória de tool (`C:\Users\User\.claude\...\memory\handoff.md`) é **ponteiro volátil**,
não fonte da verdade. O session store do VS Code é descartável — já perdeu uma sessão
inteira. Ao sinalizar encerramento, oferecer "salva tudo".

Nota do `.gitignore`: `docs/` é ignorado por padrão com **allowlist** (`!docs/<arquivo>`).
Todo doc novo em `docs/` precisa de uma linha `!docs/<nome>` ou fica fora do git.

---

## Mapa da documentação

- `HANDOFF.md` — estado atual + histórico.
- `docs/ai-lane-funil-agro.md` — lane de IA fazer.ai no funil agro.
- `docs/contact-auth.md` — contrato do `/ai-gate`.
- `docs/motor-de-fluxo.md` — motor de fluxo conversacional.
- `docs/superpowers/specs/` e `docs/superpowers/plans/` — specs e planos de features.
