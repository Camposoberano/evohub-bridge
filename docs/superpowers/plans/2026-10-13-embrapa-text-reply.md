# Resposta digitada na oferta Embrapa 5895 Implementation Plan

> **For agentic workers:** Implementar nesta sessão, em etapas pequenas, com revisão de testes e versão implantada.

**Goal:** Fazer `Quero` digitado liberar o PDF da Embrapa e preservar a espera diante de texto ambíguo.

**Architecture:** Um classificador puro decide a resposta somente para a oferta Embrapa. Os dois webhooks fornecem o texto ao continuador; este só reserva o passo após decisão explícita. O fluxo salvo permanece intacto.

**Tech Stack:** Deno/TypeScript, webhooks UAZAPI e Hub, Supabase para estado do fluxo.

**Spec:** `docs/superpowers/specs/2026-10-13-embrapa-text-reply-design.md`

## Global Constraints

- Campanha `isca-embrapa-sul-sudeste-5895-2026-09-25`; passo `oferta`.
- Nenhuma mudança de interpretação nos outros fluxos.
- Texto ambíguo não libera PDF nem altera o estado aguardando.

---

### Task 1: Classificar a resposta da oferta

**Files:** criar `bridge/shared/embrapa-offer-reply.ts` e `bridge/tests/embrapa-offer-reply.test.ts`.

- [ ] Escrever testes para `quero`, `quero o material`, `pode enviar o PDF`, `não`, `agora não`, texto ambíguo e frases negativas que contenham `quero`.
- [ ] Rodar o teste e confirmar falha anterior à implementação.
- [ ] Implementar `classifyEmbrapaOfferReply(text: string | null | undefined): "quero" | "nao" | null` com normalização e correspondências explícitas.
- [ ] Rodar o teste e confirmar aprovação.

### Task 2: Integrar sem afetar outros fluxos

**Files:** modificar `bridge/shared/flow-inbound.ts`, `bridge/handlers/uazapi-webhook.ts`, `bridge/handlers/hub-webhook.ts`; testar o tratamento do estado em `bridge/tests/embrapa-offer-reply.test.ts` ou teste de integração existente.

- [ ] Passar o texto recebido como parâmetro opcional de `continueFlowOnReply` nos dois webhooks.
- [ ] Se campanha e passo forem os da oferta Embrapa, trocar texto explícito pelo ID do ramo antes de `claimFlowStep`; para texto ambíguo, retornar sem reservar o estado.
- [ ] Testar cliques, texto e isolamento dos outros fluxos; rodar o verificador de tipos.

### Task 3: Implantar e verificar

**Files:** atualizar somente os arquivos acima na branch implantável; registrar resultado no plano operacional.

- [ ] Revisar diff e testes, mantendo as demais alterações locais fora do deploy.
- [ ] Implantar a correção na ponte e conferir `/version`.
- [ ] Conferir fila de 123 pendentes, configuração da oferta e saúde da ponte; relatar qualquer impedimento antes da janela de 14/10.
