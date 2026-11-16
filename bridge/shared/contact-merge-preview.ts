// contact-merge-preview — gate READ-ONLY que avalia se dois contatos do Chatwoot podem ser
// mesclados, devolvendo as razões que BLOQUEIAM a mescla. Nunca mescla: só reporta, pra revisão
// humana (via scripts/preview-contact-merge.ts). Portado do hub CECAPE, inbox parametrizada.
import { usableContactName } from "./contact-name.ts";
import { equivalentBrazilianPhoneKeys } from "./phone-keys.ts";

type Json = Record<string, unknown>;

function soleRoute(contact: Json, inboxId: number): string | null {
  const inboxes = contact.contact_inboxes;
  if (!Array.isArray(inboxes) || inboxes.length !== 1) return null;
  const row = inboxes[0] as Json;
  if (Number((row.inbox as Json | undefined)?.id) !== inboxId) return null;
  const source = row.source_id;
  return typeof source === "string" && source.trim() ? source : null;
}

function conversationsBelongTo(rows: Json[], contactId: number, inboxId: number): boolean {
  if (!rows.length || rows.length >= 25) return false;
  return rows.every((row) =>
    Number.isSafeInteger(Number(row.id)) &&
    Number(row.inbox_id) === inboxId &&
    Number(((row.meta as Json | undefined)?.sender as Json | undefined)?.id) === contactId
  );
}

/** Gate read-only; um resultado vazio é pré-requisito pra revisar uma mescla pontual. */
export function assessContactMerge(
  inboxId: number,
  base: Json,
  mergee: Json,
  candidateIds: number[],
  baseConversations: Json[],
  mergeeConversations: Json[],
): string[] {
  const reasons: string[] = [];
  const baseId = Number(base.id);
  const mergeeId = Number(mergee.id);
  if (
    !Number.isSafeInteger(baseId) || baseId <= 0 ||
    !Number.isSafeInteger(mergeeId) || mergeeId <= 0 ||
    baseId === mergeeId
  ) reasons.push("contact_ids_invalid");
  if (!usableContactName(base.name)) reasons.push("base_name_invalid");
  if (usableContactName(mergee.name)) reasons.push("mergee_has_human_name");

  const baseKeys = new Set(equivalentBrazilianPhoneKeys(base.phone_number));
  const mergeeKeys = equivalentBrazilianPhoneKeys(mergee.phone_number);
  if (!baseKeys.size || !mergeeKeys.some((key) => baseKeys.has(key))) {
    reasons.push("phone_mismatch");
  }
  const baseRoute = soleRoute(base, inboxId);
  const mergeeRoute = soleRoute(mergee, inboxId);
  if (!baseRoute || !mergeeRoute) reasons.push("inbox_scope");
  else if (baseRoute !== mergeeRoute) reasons.push("routing_identity_differs");

  const actual = [...new Set(candidateIds)].sort((a, b) => a - b);
  const expected = [baseId, mergeeId].sort((a, b) => a - b);
  if (actual.join(",") !== expected.join(",")) {
    reasons.push("candidate_set_ambiguous");
  }
  if (
    !conversationsBelongTo(baseConversations, baseId, inboxId) ||
    !conversationsBelongTo(mergeeConversations, mergeeId, inboxId)
  ) reasons.push("conversation_scope");
  return reasons;
}
