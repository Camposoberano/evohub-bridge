type Json = Record<string, unknown>;

export type ConversationAssigneeUpdate = {
  conversationId: string;
  inboxId: string;
  assignee: string | null;
};

/** Parseia apenas atualizações que realmente trazem o estado de responsável no meta. */
export function readConversationAssigneeUpdate(
  payload: Json,
): ConversationAssigneeUpdate | null {
  const meta = (payload.meta ?? {}) as Json;
  if (!Object.hasOwn(meta, "assignee")) return null;

  const conversationId = String(payload.id ?? "").trim();
  const inboxId = String(payload.inbox_id ?? "").trim();
  if (!conversationId || !inboxId) return null;

  const assignee = meta.assignee && typeof meta.assignee === "object"
    ? meta.assignee as Json
    : null;
  const team = meta.team && typeof meta.team === "object"
    ? meta.team as Json
    : null;
  const userId = assignee?.id;
  const teamId = team?.id;
  return {
    conversationId,
    inboxId,
    assignee: userId != null && String(userId).trim()
      ? String(userId)
      : teamId != null && String(teamId).trim()
      ? `team:${String(teamId)}`
      : null,
  };
}
