# Auditoria de organização — 22/10/2026

**Base:** `main` em `08c6e5c` e inventário somente de leitura do checkout local `E:\Projetos_Novos\evohub`. **Escopo:** arquitetura, documentação, funções, fluxos, comandos e riscos de organização. **Sem alteração de lógica, fila, banco ou produção.** Esta auditoria é estática; não equivale a uma revisão de segurança nem a um teste integral de operação.

## Inventário da `main`

| Área | Contagem observada | Leitura |
|---|---:|---|
| Rotas explícitas no objeto `routes` | 37 | `bridge/server.ts` |
| Handlers TypeScript | 38 | `bridge/handlers/` |
| Módulos TypeScript compartilhados | 105 | `bridge/shared/` |
| Arquivos de teste TypeScript | 105 | `bridge/tests/` |
| Documentos Markdown em `docs/` | 54 | `docs/` |
| Migrations SQL | 22 | `supabase/migrations/` |
| Linhas em `bridge/server.ts` | 1.825 | Roteador e ciclos no mesmo arquivo |

O checkout principal local tem alterações não commitadas e arquivos que não existem na `main`; este trabalho foi feito em worktree isolado. Nenhum desses arquivos foi movido, apagado ou incluído automaticamente aqui.

## Constatações

| Prioridade | Constatação | Evidência | Efeito prático |
|---|---|---|---|
| Alta | `README.md` descreve a estrutura inicial com quatro handlers, embora o roteador atual tenha 37 rotas. | Comparação de `README.md` com `bridge/server.ts`. | Quem começa pelo README não encontra incidentes, campanhas, n8n e recuperação. |
| Alta | `HANDOFF.md` abre com “estado atual — 06/10/2026”, anterior às PRs #24–#32 e aos três commits de 22/10. | Cabeçalho do handoff e histórico Git. | O texto pode ser interpretado como estado operacional presente. |
| Alta | Especificações, planos, registros históricos e instruções operacionais estão próximos sem indicação uniforme de status. | `docs/superpowers/`, handoffs, documentos por campanha. | Uma proposta pode ser confundida com comportamento publicado. |
| Média | `server.ts` centraliza roteamento e mais de vinte funções `start...Loop`. | Arquivo de 1.825 linhas; buscas por funções de ciclo. | Difícil localizar responsável por frequência, reentrância e falhas sem um mapa. |
| Média | Scripts `ops/` misturam auditoria e mutação, sem catálogo central que marque o efeito. | Nomes `audit`, `migrate`, `reconcile`, `recover`, `schedule`, `set`. | A execução pelo nome pode disparar escrita ou envio inesperado. |
| Média | A documentação não oferece uma linha do tempo única ligando incidente, PR, deploy e observação. | Handoffs e planos datados, histórico Git. | Reconstituição de causa e decisão exige procurar em vários lugares. |
| Média | Há arquivos de trabalho local não publicados, inclusive specs, planos, relatórios, scripts e alterações de código. | `git status --short` do checkout principal. | Um índice somente da `main` não representa todo o trabalho local; copiar ou substituir esses arquivos sem revisão arriscaria perder contexto. |
| Média | O `HANDOFF.md` da `main` contém quatro links locais sem destino na própria `main`; três documentos existem apenas no checkout principal e uma imagem não foi localizada no snapshot auditado. | Verificação de links relativos contra o commit `08c6e5c`. | Quem abre o handoff publicado perde essas evidências; integrar ou substituir links requer revisão da fonte. |
| Média | `.gitignore` ignora `docs/*`, com poucas exceções explícitas; novos documentos não aparecem no `git status` sem inclusão forçada ou ajuste da regra. | Linhas 31–42 de `.gitignore` e `git check-ignore -v docs/README.md`. | Documentação nova pode ficar apenas local por acidente. |
| Baixa | Alguns nomes numéricos de migrations se repetem (`0003`, `0004`, `0005`, `0013`), embora os nomes completos sejam distintos. | `supabase/migrations/`. | A ordem de aplicação deve seguir o mecanismo de migrations, não apenas o prefixo numérico. |

## O que foi organizado nesta etapa

Foram criados [índice](README.md), [mapa de arquitetura](arquitetura-e-fluxos.md), [catálogo de funções e comandos](funcoes-e-comandos.md), [catálogo dos 54 documentos anteriores](catalogo-documentos.md), [catálogo do código](catalogo-codigo.md) e [linha do tempo](linha-do-tempo.md). Os documentos anteriores continuam intactos. O índice explica o peso de cada fonte e separa proposta, código mesclado e operação observada.

## Limites da auditoria

- Não foi feita confirmação ao vivo do deploy de `08c6e5c`; a confirmação de produção registrada nesta conversa é da PR #32 em 21/10.
- Não foi feita leitura exaustiva de cada uma das 105 implementações em `shared/`; o mapa usa responsabilidades e entradas do código.
- Não foi validado que cada script de `ops/` seja idempotente. Até tal revisão, trate os scripts mutáveis como comandos de produção.
- A documentação local fora da `main` permanece no checkout principal. Sua incorporação requer comparação de conteúdo, status e confidencialidade, não cópia automática.

## Próxima sequência recomendada

1. **Estabilizar a fonte:** comparar `main`, deploy do bridge/painel e checkout local; registrar commit e horário da consulta em um estado operacional curto.
2. **Tornar a documentação durável:** atualizar o resumo do README para apontar este guia; datar o handoff antigo como histórico; catalogar scripts `ops/` por leitura/escrita/envio/deploy.
3. **Consolidar rascunhos locais:** revisar arquivo por arquivo, atribuir status e integrar somente conteúdo válido sem sobrescrever os originais.
4. **Planejar refatoração do código:** começar por extrair o registro dos ciclos de `server.ts` em unidades com interface clara, sem alterar intervalo ou habilitação; depois revisar limites entre campanha, funil, entrada e recuperação.
5. **Verificar por domínio:** testes focados, check de tipos, build do painel, comparação de rotas/ciclos e revisão de diffs. Mudanças de comportamento e deploy ficam em etapas próprias.

O [plano de execução](superpowers/plans/2026-10-22-organizacao-evohub.md) detalha essa sequência. O pedido do usuário nesta etapa foi **mapa e plano primeiro**; nenhuma refatoração de função foi executada.
