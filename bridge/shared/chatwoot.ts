// Cliente Chatwoot.
//  * Application API (token de agente/admin): cria inbox, busca dados de conta.
//  * Client API pública (inbox_identifier + source_id): injeta mensagens de ENTRADA.
import { env, optionalEnv } from "./env.ts";

type Json = Record<string, unknown>;

// Conta Chatwoot (instância): URL + token + account_id. Permite multi-cliente (outra
// instância/URL/token). Default = conta principal do env.
export type CwAcct = { url: string; token: string; accountId: string; adminToken?: string };

export function envAcct(): CwAcct {
  return {
    url: env("CHATWOOT_URL").replace(/\/+$/, ""),
    token: env("CHATWOOT_API_ACCESS_TOKEN"),
    accountId: env("CHATWOOT_ACCOUNT_ID"),
    adminToken: optionalEnv("CHATWOOT_ADMIN_TOKEN") ?? undefined,
  };
}

const baseOf = (a: CwAcct) => a.url.replace(/\/+$/, "");
const appAuthHeaders = (a: CwAcct): HeadersInit => ({ "api_access_token": a.token });
const appHeaders = (a: CwAcct): HeadersInit => ({ "api_access_token": a.token, "Content-Type": "application/json" });
// criar inbox / gerenciar membros exige role Administrator -> usa adminToken se houver.
const adminHeaders = (a: CwAcct): HeadersInit => ({ "api_access_token": a.adminToken ?? a.token, "Content-Type": "application/json" });

// id do agente do token (pra virar membro de inbox criada — senão o agente não a enxerga).
export async function profileId(acct: CwAcct = envAcct()): Promise<number | undefined> {
  const res = await fetch(`${baseOf(acct)}/api/v1/profile`, { headers: appAuthHeaders(acct) });
  if (!res.ok) return undefined;
  return (await res.json().catch(() => ({})))?.id as number | undefined;
}

// adiciona agentes como membros de uma inbox (visibilidade). Precisa admin.
export async function addInboxMembers(accountId: string | number, inboxId: number, userIds: number[], acct: CwAcct = envAcct()): Promise<boolean> {
  const res = await fetch(`${baseOf(acct)}/api/v1/accounts/${accountId}/inbox_members`, {
    method: "POST", headers: adminHeaders(acct),
    body: JSON.stringify({ inbox_id: inboxId, user_ids: userIds }),
  });
  return res.ok;
}

export type ChatwootAttachment = {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
};

// ── Application API ──────────────────────────────────────────────────────────

// Cria inbox tipo "api" e devolve id + inbox_identifier.
export async function createApiInbox(name: string, webhookUrl: string, acct: CwAcct = envAcct()): Promise<{
  id: number;
  inbox_identifier: string;
}> {
  const res = await fetch(`${baseOf(acct)}/api/v1/accounts/${acct.accountId}/inboxes`, {
    method: "POST",
    headers: adminHeaders(acct), // criar inbox exige Administrator
    body: JSON.stringify({ name, channel: { type: "api", webhook_url: webhookUrl } }),
  });
  if (!res.ok) throw new Error(`Chatwoot createApiInbox ${res.status}: ${await res.text()}`);
  const inbox = await res.json();
  const identifier = inbox?.inbox_identifier ?? inbox?.channel?.inbox_identifier;
  if (identifier) return { id: inbox.id, inbox_identifier: identifier };
  const got = await fetch(`${baseOf(acct)}/api/v1/accounts/${acct.accountId}/inboxes/${inbox.id}`, {
    headers: appHeaders(acct),
  });
  const full = await got.json();
  return { id: inbox.id, inbox_identifier: full?.inbox_identifier ?? full?.channel?.inbox_identifier };
}

// Acha uma inbox existente pelo nome (ex: ryzeapi nativo já criou a inbox por baixo e
// só precisamos do inbox_identifier pra nosso ingestInbound postar na mesma conversa).
export async function findInboxByName(name: string, acct: CwAcct = envAcct()): Promise<{
  id: number;
  inbox_identifier: string;
} | null> {
  const res = await fetch(`${baseOf(acct)}/api/v1/accounts/${acct.accountId}/inboxes`, {
    headers: appHeaders(acct),
  });
  if (!res.ok) throw new Error(`Chatwoot listInboxes ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const payload = (json.payload ?? []) as Json[];
  const found = payload.find((i) => i.name === name);
  if (!found) return null;
  if (found.inbox_identifier) return { id: found.id as number, inbox_identifier: found.inbox_identifier as string };
  const got = await fetch(`${baseOf(acct)}/api/v1/accounts/${acct.accountId}/inboxes/${found.id}`, {
    headers: appHeaders(acct),
  });
  const full = await got.json();
  return { id: found.id as number, inbox_identifier: full?.inbox_identifier ?? full?.channel?.inbox_identifier };
}

// Seta o webhook_url de uma inbox API — usado p/ ligar a saída Chatwoot → uazapi.
export async function setInboxWebhook(
  accountId: number | string,
  inboxId: number | string,
  webhookUrl: string,
  acct: CwAcct = envAcct(),
): Promise<{ ok: boolean; status: number; body: string }> {
  const adminToken = acct.adminToken ?? acct.token;
  const res = await fetch(`${baseOf(acct)}/api/v1/accounts/${accountId}/inboxes/${inboxId}`, {
    method: "PATCH",
    headers: { "api_access_token": adminToken, "Content-Type": "application/json" },
    body: JSON.stringify({ channel: { webhook_url: webhookUrl } }),
  });
  return { ok: res.ok, status: res.status, body: (await res.text()).slice(0, 200) };
}

// ── Client API pública (ENTRADA) ─────────────────────────────────────────────

// Cria (ou recupera) um contato no inbox API e devolve source_id.
export async function ensureContact(
  inboxIdentifier: string,
  input: { name?: string; phone?: string; identifier?: string },
  acct: CwAcct = envAcct(),
): Promise<{ source_id: string; pubsub_token?: string; contact_id?: number }> {
  const res = await fetch(`${baseOf(acct)}/public/api/v1/inboxes/${inboxIdentifier}/contacts`, {
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
  acct: CwAcct = envAcct(),
): Promise<{ id: number }> {
  const res = await fetch(
    `${baseOf(acct)}/public/api/v1/inboxes/${inboxIdentifier}/contacts/${sourceId}/conversations`,
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
  acct: CwAcct = envAcct(),
): Promise<{ id: number }> {
  const res = await fetch(
    `${baseOf(acct)}/public/api/v1/inboxes/${inboxIdentifier}/contacts/${sourceId}/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    },
  );
  if (!res.ok) throw new Error(`Chatwoot createIncomingMessage ${res.status}: ${await res.text()}`);
  return await res.json();
}

export async function createConversationMessage(
  conversationId: number,
  input: {
    content: string;
    messageType: "incoming" | "outgoing";
    attachments?: ChatwootAttachment[];
  },
  acct: CwAcct = envAcct(),
): Promise<Record<string, unknown> & { id?: number }> {
  const attachments = input.attachments ?? [];

  if (attachments.length > 0) {
    const form = new FormData();
    form.set("content", input.content);
    form.set("message_type", input.messageType);
    form.set("private", "false");
    form.set("content_type", "text");

    for (const attachment of attachments) {
      const blob = new Blob([arrayBufferFromBytes(attachment.bytes)], { type: attachment.contentType });
      form.append("attachments[]", blob, attachment.filename);
    }

    const res = await fetch(`${baseOf(acct)}/api/v1/accounts/${acct.accountId}/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: appAuthHeaders(acct),
      body: form,
    });
    if (!res.ok) throw new Error(`Chatwoot createConversationMessage ${res.status}: ${await res.text()}`);
    return await res.json();
  }

  const res = await fetch(`${baseOf(acct)}/api/v1/accounts/${acct.accountId}/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: appHeaders(acct),
    body: JSON.stringify({
      content: input.content,
      message_type: input.messageType,
      private: false,
      content_type: "text",
      content_attributes: {},
    }),
  });
  if (!res.ok) throw new Error(`Chatwoot createConversationMessage ${res.status}: ${await res.text()}`);
  return await res.json();
}

export async function getConversationLabels(conversationId: number, acct: CwAcct = envAcct()): Promise<string[]> {
  const res = await fetch(`${baseOf(acct)}/api/v1/accounts/${acct.accountId}/conversations/${conversationId}/labels`, {
    headers: appHeaders(acct),
  });
  if (!res.ok) throw new Error(`Chatwoot getConversationLabels ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json.payload ?? []) as string[];
}

// substitui a lista INTEIRA de labels da conversa (Chatwoot não tem add/remove individual).
export async function setConversationLabels(conversationId: number, labels: string[], acct: CwAcct = envAcct()): Promise<void> {
  const res = await fetch(`${baseOf(acct)}/api/v1/accounts/${acct.accountId}/conversations/${conversationId}/labels`, {
    method: "POST",
    headers: appHeaders(acct),
    body: JSON.stringify({ labels }),
  });
  if (!res.ok) throw new Error(`Chatwoot setConversationLabels ${res.status}: ${await res.text()}`);
}

export async function listConversationMessages(conversationId: number, acct: CwAcct = envAcct()): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${baseOf(acct)}/api/v1/accounts/${acct.accountId}/conversations/${conversationId}/messages`, {
    headers: appHeaders(acct),
  });
  if (!res.ok) throw new Error(`Chatwoot listConversationMessages ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json.payload ?? []) as Record<string, unknown>[];
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
