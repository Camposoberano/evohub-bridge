// Preview READ-ONLY de um par de contatos do Chatwoot pra possível mescla. Nunca mescla.
// Portado do hub CECAPE, generalizado (host/conta via env; inbox como argumento).
//   deno run -A bridge/scripts/preview-contact-merge.ts <baseId> <mergeeId> <inboxId>
// Env: CHATWOOT_URL, CHATWOOT_ACCOUNT_ID, CHATWOOT_ADMIN_TOKEN.
import { assessContactMerge } from "../shared/contact-merge-preview.ts";
import { equivalentBrazilianPhoneKeys } from "../shared/phone-keys.ts";

type Json = Record<string, unknown>;

function idArg(value: string | undefined): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("invalid id");
  return id;
}

const baseId = idArg(Deno.args[0]);
const mergeeId = idArg(Deno.args[1]);
const inboxId = idArg(Deno.args[2]);
if (baseId === mergeeId) throw new Error("contact IDs must differ");
const baseUrl = Deno.env.get("CHATWOOT_URL") ?? "";
const accountId = Deno.env.get("CHATWOOT_ACCOUNT_ID") ?? "";
const token = Deno.env.get("CHATWOOT_ADMIN_TOKEN") ?? Deno.env.get("CHATWOOT_API_ACCESS_TOKEN") ?? "";
if (!baseUrl || !accountId || !token) {
  throw new Error("CHATWOOT_URL, CHATWOOT_ACCOUNT_ID e CHATWOOT_ADMIN_TOKEN são obrigatórios");
}
const root = `${baseUrl.replace(/\/+$/, "")}/api/v1/accounts/${encodeURIComponent(accountId)}`;

async function get(path: string): Promise<Json> {
  const response = await fetch(`${root}${path}`, {
    headers: { api_access_token: token },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Chatwoot read failed: ${response.status}`);
  const data = await response.json();
  if (!data || typeof data !== "object") throw new Error("invalid Chatwoot response");
  return data as Json;
}

async function contact(id: number): Promise<Json> {
  const data = await get(`/contacts/${id}?include_contact_inboxes=true`);
  if (!data.payload || typeof data.payload !== "object") throw new Error("contact payload missing");
  return data.payload as Json;
}

async function conversations(id: number): Promise<Json[]> {
  const data = await get(`/contacts/${id}/conversations`);
  if (!Array.isArray(data.payload)) throw new Error("conversation payload missing");
  return data.payload as Json[];
}

const [base, mergee, baseConversations, mergeeConversations] = await Promise.all([
  contact(baseId),
  contact(mergeeId),
  conversations(baseId),
  conversations(mergeeId),
]);
const keys = equivalentBrazilianPhoneKeys(base.phone_number);
if (!keys.length) throw new Error("invalid base phone");
const exactCandidates = new Set<number>();
for (const key of keys) {
  const data = await get(`/contacts/search?q=${encodeURIComponent(key)}&include_contact_inboxes=true`);
  if ((data.meta as Json | undefined)?.has_more === true || !Array.isArray(data.payload)) {
    throw new Error("contact search incomplete");
  }
  for (const item of data.payload as Json[]) {
    const id = Number(item.id);
    if (
      Number.isSafeInteger(id) && id > 0 &&
      equivalentBrazilianPhoneKeys(item.phone_number).some((value) => keys.includes(value))
    ) exactCandidates.add(id);
  }
}
const reasons = assessContactMerge(
  inboxId,
  base,
  mergee,
  [...exactCandidates],
  baseConversations,
  mergeeConversations,
);
const route = (item: Json) => String(
  ((item.contact_inboxes as Json[] | undefined)?.[0] as Json | undefined)?.source_id ?? "",
);
const preview = {
  destination_id: baseId,
  source_id: mergeeId,
  inbox_id: inboxId,
  phone_suffix: keys[0].slice(-4),
  candidate_ids: [...exactCandidates].sort((a, b) => a - b),
  routing_identity_equal: route(base) !== "" && route(base) === route(mergee),
  destination_conversation_ids: baseConversations.map((row) => row.id),
  source_conversation_ids: mergeeConversations.map((row) => row.id),
  can_merge: reasons.length === 0,
  blocking_reasons: reasons,
};
console.log(JSON.stringify(preview, null, 2));
if (reasons.length) Deno.exitCode = 2;
