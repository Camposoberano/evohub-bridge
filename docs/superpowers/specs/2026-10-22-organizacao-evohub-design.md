# Organização do EvoHub — desenho

**Data:** 22/10/2026. **Base:** `main` em `08c6e5c`. **Decisão do usuário:** mapa e plano antes de mover ou renomear funções.

## Objetivo

Permitir que uma pessoa reconstrua, em ordem cronológica, o que foi decidido, implementado, publicado e observado, encontre o responsável por cada fluxo e saiba quais comandos apenas leem dados e quais podem alterar produção. Manter todos os arquivos históricos e o trabalho local preservados.

## Abordagens consideradas

1. **Índice e mapas sobre os arquivos existentes (escolhida):** pouca mudança, links antigos continuam válidos, permite revisar o código antes de refatorar. Exige manutenção do índice quando novas funções surgirem.
2. **Mover todos os documentos para uma nova árvore:** navegação mais uniforme, mas quebra links e mistura material histórico com atual durante a migração.
3. **Refatorar o código e documentar ao mesmo tempo:** pode melhorar limites internos, mas aumenta o risco de alterar campanhas e mensagens enquanto a fonte de verdade ainda está sendo estabelecida.

## Estrutura

- `docs/README.md`: porta de entrada e regra para interpretar fontes.
- `docs/arquitetura-e-fluxos.md`: mapa do caminho de dados e das responsabilidades.
- `docs/funcoes-e-comandos.md`: catálogo de rotas, módulos, ciclos e comandos.
- `docs/linha-do-tempo.md`: eventos com datas, commits, PRs e grau de confirmação.
- `docs/auditoria-organizacao-2026-10-22.md`: constatações, limites e próximos passos.
- `docs/superpowers/plans/2026-10-22-organizacao-evohub.md`: execução futura da reorganização do código e do restante da documentação.

## Regras de integridade

1. Nenhum documento ou script legado é apagado nesta etapa.
2. Uma especificação não é tratada como código ativo; um commit na `main` não é tratado como deploy confirmado.
3. O checkout principal com alterações locais não é rebased, limpo ou mesclado automaticamente.
4. Comandos de envio, reconciliação, banco e deploy são rotulados pelo efeito antes de serem recomendados.
5. Informações de cliente aparecem apenas com identificação parcial; segredos não entram na documentação.

## Critérios de aceitação

- O README aponta para o índice.
- Rotas, ciclos, componentes e comandos principais têm entrada encontrável.
- A linha do tempo de 17–22/10 liga PRs #24–#32 e commits posteriores à `main` sem afirmar deploy não comprovado.
- Links relativos e contagens são verificados automaticamente.
- O diff desta etapa contém apenas documentação; nenhuma lógica ou configuração operacional muda.

## Próxima etapa de código

Após aprovação de um plano concreto, separar responsabilidades no `server.ts` e criar catálogo verificável dos scripts de `ops/`. Cada extração deve preservar rotas, flags, intervalos, efeitos e testes observáveis antes de deploy. O plano desta etapa não autoriza execução automática dessas refatorações.
