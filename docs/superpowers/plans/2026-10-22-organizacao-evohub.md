# Organização do EvoHub — plano de implementação

> **Para execução futura:** ler a [especificação](../specs/2026-10-22-organizacao-evohub-design.md) e executar uma tarefa por vez, revisando o diff e os testes antes da seguinte. As caixas indicam trabalho **não executado** neste pedido.

**Objetivo:** manter documentação, comandos e fronteiras do código fáceis de encontrar sem perder histórico nem mudar o comportamento das campanhas.

**Arquitetura:** documentação por fonte e domínio; registro central de comandos com efeito declarado; extrações pequenas do `bridge/server.ts` mantendo o roteador e os mesmos ciclos. Cada tarefa possui revisão independente.

**Stack:** Deno/TypeScript, Next.js, Supabase/Postgres, GitHub, Coolify.

**Base:** `main` em `08c6e5c`; conferir novamente a `main` e o deploy antes da execução.

## Restrições globais

- Não tocar nas alterações locais não commitadas do checkout principal.
- Não alterar cadência, janela, elegibilidade, envio, idempotência ou sinalização de sucesso sem uma tarefa separada com evidência de produção.
- Não reenviar mensagens antigas automaticamente.
- Não copiar segredos, tokens, telefones completos ou dados de clientes para documentação ou testes.
- Não remover documentos antigos nem mudar seus caminhos nesta sequência.

## Tarefa 1 — Estado operacional versionado

**Arquivos:** criar `docs/estado-operacional.md`; atualizar `docs/README.md` e `docs/linha-do-tempo.md`.

**Entrada:** SHA da `main`, versão do bridge/painel, deploy Coolify, canais e campanhas ativos. **Saída:** snapshot curto com horário, fonte e status de confirmação.

- [ ] Ler `main`, `/version`, `/health` e status de deploy, sem mudanças em produção.
- [ ] Registrar uma linha por componente: commit esperado, commit observado quando disponível, horário da consulta e URL/endpoint de evidência sem credencial.
- [ ] Marcar `não verificado` quando o provedor ou deploy não expuser a versão; não inferir equivalência só pelo horário.
- [ ] Testar links relativos e conferir o diff antes de commitar apenas esses arquivos.

## Tarefa 2 — Integrar documentação local sem perda

**Arquivos:** criar `docs/inventario-rascunhos-locais.md`; atualizar `docs/README.md` somente para documentos integrados.

**Entrada:** `git status --short` do checkout principal e arquivos locais. **Saída:** tabela com caminho, data/escopo, status (`rascunho`, `histórico`, `vigente`, `conflitante`) e destino.

- [ ] Gerar lista de arquivos não rastreados/modificados, sem mover ou excluir nenhum.
- [ ] Para cada Markdown, comparar conteúdo com `main` e verificar referências a campanhas e ambientes antes de publicação.
- [ ] Integrar somente textos não sensíveis e ainda válidos por commits pequenos; manter o original até a equivalência ser revisada.
- [ ] Validar que a contagem de arquivos no checkout principal não diminuiu e que nenhum `git status` anterior desapareceu por efeito da tarefa.

## Tarefa 3 — Catálogo executável de operações

**Arquivos:** criar `ops/README.md` e `ops/commands-manifest.json`; adicionar `scripts/check-ops-manifest.mjs` e teste `scripts/check-ops-manifest.test.mjs`.

**Entrada:** todos os arquivos executáveis em `ops/`. **Saída:** para cada script: propósito, `read`/`write`/`send`/`deploy`, flags obrigatórias, filtros, idempotência, prova de execução e rollback quando aplicável.

- [ ] O teste enumera os executáveis de `ops/` e falha se qualquer um não tiver entrada no manifesto ou se uma entrada apontar para arquivo inexistente.
- [ ] Começar com classificação conservadora (`write`) quando o efeito não estiver comprovado por leitura do código.
- [ ] Documentar comandos de leitura com exemplos que não imprimam credenciais; comandos mutáveis recebem precondições e não são executados durante a catalogação.
- [ ] Executar o teste do manifesto e revisar manualmente pelo menos um script de cada classe antes de commitar.

## Tarefa 4 — Separar registro de ciclos do servidor

**Arquivos:** modificar `bridge/server.ts`; criar `bridge/runtime/loops.ts` e, por domínio, `bridge/runtime/social-loops.ts`, `bridge/runtime/campaign-loops.ts`, `bridge/runtime/health-loops.ts`; criar testes `bridge/tests/runtime-loops.test.ts`.

**Entrada:** funções `start...Loop` atualmente em `server.ts`. **Saída:** um registro de inicialização com as mesmas flags, frequências e chamadas.

- [ ] Antes de editar, criar um snapshot de nomes, intervalos e variáveis de ambiente lidos das 26 funções `start...Loop` e do código adjacente.
- [ ] Extrair primeiro um grupo sem alterar corpo, assinatura ou ordem de inicialização. `server.ts` continua dono do roteamento e chama o registro exportado.
- [ ] No teste, injetar agendador e dependências falsas, comparar os ciclos habilitados e seus intervalos com o snapshot. Não disparar integrações reais.
- [ ] Rodar `deno check bridge/server.ts`, testes focados, `git diff --check` e revisão do diff; repetir para os demais grupos em commits separados.
- [ ] Antes de qualquer deploy, comparar `/version`, rotas e logs de inicialização em ambiente de validação e preparar rollback para o commit anterior.

## Tarefa 5 — Fronteiras de campanha, funil e recuperação

**Arquivos:** atualizar `docs/arquitetura-e-fluxos.md`; modificar apenas módulos cujo contrato estiver duplicado entre `bridge/shared/campaign-queue.ts`, `flow-inbound.ts`, `funnel-recovery.ts`, `catchup-uazapi.ts` e `inbound-incidents.ts`; testes correspondentes em `bridge/tests/`.

**Entrada:** mapa de chamada real e casos de incidente do 5895/0595. **Saída:** contratos documentados para `enfileirar`, `consumir resposta`, `avançar fluxo`, `recuperar evento` e `confirmar entrega`.

- [ ] Desenhar a sequência atual com ID de mensagem, ID de contato, estado e recibo, distinguindo evento recebido de envio confirmado.
- [ ] Identificar uma duplicação concreta; escolher uma única função dona da regra, mantendo adaptadores para chamadas existentes.
- [ ] Criar teste de regressão para clique de botão template, clique de lista, texto livre, evento repetido, resposta sem webhook e recibo atrasado.
- [ ] Alterar um contrato por vez, checar tipos e testes, e registrar no documento o efeito observado. Não reprocessar contato real durante testes.

## Tarefa 6 — Verificação e publicação da reorganização

**Arquivos:** atualizar `docs/README.md`, `docs/funcoes-e-comandos.md`, `docs/linha-do-tempo.md` e `HANDOFF.md` com estado datado.

- [ ] Verificar links locais, rotas do `server.ts`, contagem de scripts no manifesto e ausência de segredos.
- [ ] Rodar `deno check bridge/server.ts`, suíte focada, `npm --prefix web run build` se o painel tiver sido alterado, e `git diff --check`.
- [ ] Registrar no PR o que mudou, o que permaneceu histórico, os testes e risco de deploy.
- [ ] Para mudança apenas documental, mesclar após revisão. Para mudança de runtime, implantar em etapa própria e atualizar a linha do tempo com evidência real.
