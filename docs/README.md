# Guia da documentação do EvoHub

Este é o ponto de entrada para entender o sistema e planejar mudanças. O recorte desta organização é a branch `main` no commit `08c6e5c` (22/10/2026, horário de Fortaleza). O código e os arquivos históricos foram preservados; este guia não declara que uma proposta antiga esteja ativa em produção.

## Ordem de leitura

1. [Arquitetura e fluxos](arquitetura-e-fluxos.md): componentes, entrada e saída de mensagens, campanhas, recuperação e monitoramento.
2. [Funções e comandos](funcoes-e-comandos.md): mapa de rotas, módulos, ciclos automáticos e comandos seguros de inspeção.
3. [Linha do tempo](linha-do-tempo.md): decisões e mudanças com datas, commits e documentos de origem.
4. [Auditoria e plano de organização](auditoria-organizacao-2026-10-22.md): divergências encontradas, riscos e sequência recomendada para reorganizar o código.
5. [Catálogo completo](catalogo-documentos.md): os 54 documentos publicados antes desta organização, sem mover ou apagar nenhum.
6. [Catálogo do código](catalogo-codigo.md): handlers, módulos compartilhados e seus exports, páginas, migrations e utilitários.

## Como interpretar as fontes

| Fonte | Uso correto |
|---|---|
| `bridge/`, `web/`, `supabase/migrations/` na `main` | Comportamento implementado no código daquele commit. A execução real depende de configuração e deploy. |
| `/version`, `/health`, provedores e banco de produção | Estado operacional observado no momento da consulta. Não é substituído por documentação ou código local. |
| `docs/superpowers/specs/` | Desenhos e decisões propostas; verificar o commit e o código antes de chamar de implantado. |
| `docs/superpowers/plans/` | Planos de execução, inclusive planos ainda não concluídos. |
| `HANDOFF.md` e handoffs datados | Registro histórico da sessão indicada no próprio arquivo. |
| Arquivos locais sem commit | Rascunhos ou trabalho em andamento; não fazem parte da `main`. |

## Documentos por domínio

| Domínio | Leituras existentes |
|---|---|
| Conversa e motor de fluxo | [Motor de fluxo](motor-de-fluxo.md), [recuperação de clientes](RECUPERACAO-DE-CLIENTES.md), [fluxo de reativação](fluxo-reativacao-mega-sorgo.md) |
| WhatsApp e Uazapi | [Envio Uazapi](uazapi-envio-referencia.md), [mensageria híbrida](auditoria-mensageria-hibrida-e-replicacao.md), [regras Meta](../README.md) |
| Facebook e Instagram | [Operação social](FACEBOOK_INSTAGRAM_OPERACAO.md), [comentários](social-comment-autoreply.md), [handoff social](HANDOFF-SOCIAL-2026-07-21.md) |
| Campanhas e fila | [Dois fluxos Sul](disparo-sul-dois-fluxos.md), [estratégia Sul](estrategia-disparo-sul.md), [rotação por número](superpowers/specs/2026-10-21-rotacao-campanhas-por-numero-design.md) |
| Banco e recuperação | [Backup e clonagem](backup-e-clonagem-evohub.md), [migrations](../supabase/migrations/) |
| Planejamento | [Especificações](superpowers/specs/), [planos](superpowers/plans/) |

## Regra para documentos novos

No cabeçalho, indique data, commit/base, escopo (`proposta`, `implementado`, `implantado` ou `observado`) e fontes. Para procedimentos que enviam mensagens, alteram campanhas, aplicam migrations ou fazem deploy, separe explicitamente leitura de execução. Evite copiar segredos, tokens ou telefones completos.

Os documentos legados continuam nos caminhos originais para preservar links e contexto. Se um trecho antigo conflitar com o código atual, use a data do documento como contexto e abra uma atualização pontual; não apague o registro histórico.
