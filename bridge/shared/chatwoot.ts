// Cliente Chatwoot.
//  * Application API (token de agente/admin): cria inbox, busca dados de conta.
//  * Client API pública (inbox_identifier + source_id): injeta mensagens de ENTRADA.
import { env } from "./env.ts";

const BASE = () => env("CHATWOOT_URL").replace(/\/+$/, "");
const ACC = () => env("CHATWOOT_ACCOUNT_ID");

function appHeaders(): HeadersInit {
  return {
    "api_access_token": env("CHATWOOT_API_ACCESS_TOKEN"),
    "Content-Type": "application/json",
  };
}

// ── Application API ──────────────────────────────────────────────────────────

// Cria inbox tipo "api" e devolve id + inbox_identifier.
export async function createApiInbox(name: string, webhookUrl: string): Promise<{
  id: number;
  inbox_identifier: string;
}> {
  const res = await fetch(`${BASE()}/api/v1/accounts/${ACC()}/inboxes`, {
    method: "POST",
    headers: appHeaders(),
    body: JSON.stringify({ name, channel: { type: "api", webhook_url: webhookUrl } }),
  });
  if (!res.ok) throw new Error(`Chatwoot createApiInbox ${res.status}: ${await res.text()}`);
  const inbox = await res.json();
  const identifier = inbox?.inbox_identifier ?? inbox?.channel?.inbox_identifier;
  if (identifier) return { id: inbox.id, inbox_identifier: identifier };
  const got = await fetch(`${BASE()}/api/v1/accounts/${ACC()}/inboxes/${inbox.id}`, {
    headers: appHeaders(),
  });
  const full = await got.json();
  return { id: inbox.id, inbox_identifier: full?.inbox_identifier ?? full?.channel?.inbox_identifier };
}

// ── Client API pública (ENTRADA) ─────────────────────────────────────────────

// Cria (ou recupera) um contato no inbox API e devolve source_id.
export async function ensureContact(
  inboxIdentifier: string,
  input: { name?: string; phone?: string; identifier?: string },
): Promise<{ source_id: string; pubsub_token?: string; contact_id?: number }> {
  const res = await fetch(`${BASE()}/public/api/v1/inboxes/${inboxIdentifier}/contacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier: input.identifier,
      name: input.name,
      phone_number: input.phone,
    }),
  });
  if (!res.ok) throw new Error(`Chatwoot ensureContact ${res.status}: ${await res.text()}`);
  const c = await res.json();
  return { source_id: c.source_id, pubsub_token: c.pubsub_token, contact_id: c?.id };
}

export async function createConversation(
  inboxIdentifier: string,
  sourceId: string,
): Promise<{ id: number }> {
  const res = await fetch(
    `${BASE()}/public/api/v1/inboxes/${inboxIdentifier}/contacts/${sourceId}/conversations`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
  );
  if (!res.ok) throw new Error(`Chatwoot createConversation ${res.status}: ${await res.text()}`);
  return await res.json();
}

export async function createIncomingMessage(
  inboxIdentifier: string,
  sourceId: string,
  conversationId: number,
  content: string,
): Promise<{ id: number }> {
  const res = await fetch(
    `${BASE()}/public/api/v1/inboxes/${inboxIdentifier}/contacts/${sourceId}/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    },
  );
  if (!res.ok) throw new Error(`Chatwoot createIncomingMessage ${res.status}: ${await res.text()}`);
  return await res.json();
}

export async function listConversationMessages(conversationId: number): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${BASE()}/api/v1/accounts/${ACC()}/conversations/${conversationId}/messages`, {
    headers: appHeaders(),
  });
  if (!res.ok) throw new Error(`Chatwoot listConversationMessages ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json.payload ?? []) as Record<string, unknown>[];
}
