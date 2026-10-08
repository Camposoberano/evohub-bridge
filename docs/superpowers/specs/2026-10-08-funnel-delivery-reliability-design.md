# Funnel delivery reliability design

**Date:** 2026-10-08
**Status:** Approved for inline implementation

## Goal

Prevent a funnel step from being reported as delivered unless the channel accepted it, stop later steps from overtaking an earlier step that failed or is unresolved, and expose enough structured outcomes to diagnose WhatsApp, Instagram, and Facebook delivery.

## Existing failure modes

- `/send-outbound` currently returns `ok: true` for missing media when it skips or substitutes the attachment.
- The queue treats `ok: true`, deduplicated responses, and skipped responses as delivery success, then advances `sales_sequences`.
- The sender logs provider failures asynchronously and omits the scheduled row ID in some cases, so outcome evidence is incomplete.
- The sender does not own the scheduled row state; callers can disagree about whether a send succeeded.
- Failed or uncertain earlier rows do not reliably prevent later rows in the same sequence from being sent.
- The existing operational monitor reports generic failed messages and overdue rows, but not ad first-step delivery by channel or structured funnel outcomes.

## Design

1. **One delivery record:** for scheduled funnel sends, `/send-outbound` records a structured `funnel_delivery_attempt` event with scheduled row ID, funnel/day/step, channel type, attempt number, outcome, provider HTTP status/code, retryability, and timestamp. Do not store message text, recipient data, full media URLs, or secrets in the new event.
2. **Explicit completion:** the sender persists `scheduled_messages` as sent only after the provider accepts the send. It returns an explicit `sent: true`; deduplicated, skipped, blocked, failed, and uncertain results never count as success.
3. **Ordered sequence:** before a scheduled step sends, verify the row is pending and every lower-numbered step for the same conversation/funnel is sent or intentionally cancelled. This applies to both n8n and the local queue through the shared endpoint.
4. **Safe retries:** retry only a definite HTTP 429 rejection, using bounded exponential backoff (maximum three retries after the first attempt). Keep the sequence step pending while it waits. Treat transport errors, HTTP 408/5xx, and partial multi-message sends as uncertain and hold them for human review; do not resend automatically. Other provider rejection and preflight failures become failed and block later steps.
5. **Required media:** if a required image/video/audio URL is missing or invalid, do not substitute text or skip it. Record `media_unavailable`, mark the row failed, and block later steps until the media or row is corrected.
6. **Monitoring and operations:** expose funnel outcomes and ad first-step status grouped by channel type in the authenticated ops/health endpoints. Alert on missing ad first steps and failed/uncertain outcomes. Historical retries and media restoration remain operator actions at the end; no historical customer messages are sent by this implementation.

## Persistence constraints

Use existing `events`, `scheduled_messages.payload`, and `scheduled_messages` status fields. Avoid a new table or an unverified production DDL migration because `scheduled_messages`, `sales_sequences`, and `funnel_media` have no versioned schema migration in this repository and the production DB URL is not available for direct DDL.

## Acceptance criteria

- Missing media cannot be represented as sent and does not fall back to text/skip.
- Only explicit provider acceptance marks the row sent and advances the sequence.
- Deduplicated/in-progress, blocked, failed, uncertain, and partial outcomes do not advance it.
- An earlier unsent/failed step blocks later steps across all three Meta channel types.
- HTTP 429 retries are bounded and scheduled with backoff; uncertain sends are never automatically replayed.
- Structured events and operational summaries identify the stage/channel/outcome without storing PII or payload content.
- Historical failures are inventoried separately and left for manual review.


## Idempotência e reentrada

Cada nova inscrição principal recebe um identificador dentro do JSON de `scheduled_messages.payload`. A verificação de etapas anteriores considera somente linhas dessa inscrição, evitando que uma falha antiga da mesma conversa bloqueie uma nova sequência. Uma claim permanente por ID de etapa após aceite do provedor protege contra duplicação mesmo quando a atualização do status falha.
O sender também valida send_at em cada chamada direta, para que o n8n não contorne o horário agendado ou o backoff. Se uma tentativa permanecer como started por mais de dez minutos sem resultado final, ela vira uncertain e fica bloqueada para reenvio automático. A criação da inscrição e das etapas usa compensação: se a gravação das etapas falhar, a linha de sequência recém-criada é removida para não deixar uma inscrição ativa vazia.
