# Prefixo Estavel do Projeto

Projeto: EvoHub
Objetivo: integrar mensageria, atendimento, automacao e observabilidade em uma unica operacao.

## Arquitetura duravel

- Bridge Deno em `bridge/`
- Dashboard Next.js em `web/`
- Supabase como base operacional e analitica
- Chatwoot como camada de atendimento
- EVO Hub, Uazapi e RyzeAPI como integracoes de mensageria

## Regras duraveis

- a logica de negocio central fica no bridge;
- o Chatwoot e camada de conversa, nao de regra de negocio;
- contexto estavel deve vir antes do contexto de tarefa;
- logs, debug bruto e status do dia ficam fora do prefixo cacheavel;
- segredos nunca entram em bundles de contexto.

## Convencoes de uso com IA

- reaproveitar prefixos estaveis;
- anexar detalhes variaveis so depois do breakpoint de cache;
- medir `cached_tokens` e `cache_write_tokens` nas chamadas compativeis;
- manter o bundle estavel pequeno, legivel e sem ruido operacional.
