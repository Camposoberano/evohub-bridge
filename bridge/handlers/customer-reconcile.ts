// customer-reconcile — reconcilia UMA página do Chatwoot no diretório local de contatos/clientes.
// Portado do hub CECAPE, generalizado (auth via can_read_operational_campaigns; sem gate de painel).
// Nunca chama endpoint de mensageria, campanha ou fluxo — só backfill idempotente por IDs exatos.
//
//   POST /customer-reconcile { inbox_id, page, apply? }
//     apply=false (default) = dry-run (conta o que faria); apply=true = grava.
//
// Casa conversa/contato por IDs EXATOS do Chatwoot (nunca por sufixo de telefone): cria/vincula
// contato+cliente local e a conversa. Idempotente — repetir a mesma página não duplica.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { admin } from "../shared/supabase.ts";
import { env } from "../shared/env.ts";
import { envAcct } from "../shared/chatwoot.ts";
import { ensureCustomer } from "../shared/customer.ts";
import { bestContactName, usableContactName } from "../shared/contact-name.ts";

type Row = Record<string, unknown>;
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}
function obj(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}
export function numberId(value: unknown): number | null {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
function digits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}
export function exactPhone(value: unknown): string | null {
  const d = digits(value);
  return /^\d{10,15}$/.test(d) ? `+${d}` : null;
}
function time(value: unknown): string {
  const n = Number(value);
  if (Number.isFinite(n) && n > 1_000_000_000) {
    return new Date(n > 10_000_000_000 ? n : n * 1000).toISOString();
  }
  const d = new Date(String(value ?? ""));
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
export function conversationItems(body: unknown): Row[] {
  const outer = obj(body);
  const data = obj(outer.data);
  const list = data.payload ?? outer.payload ?? outer.data;
  return Array.isArray(list) ? list.map(obj) : [];
}
async function cwGet(path: string): Promise<Row> {
  const acct = envAcct();
  const response = await fetch(`${acct.url}${path}`, {
    headers: { api_access_token: acct.token, Accept: "application/json" },
  });
  if (response.status === 429) throw new Error("chatwoot_rate_limited");
  if (!response.ok) throw new Error(`chatwoot_http_${response.status}`);
  return obj(await response.json());
}
async function authorized(req: Request): Promise<boolean> {
  const client = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return false;
  const { data: allowed, error: gateError } = await client.rpc("can_read_operational_campaigns");
  return !gateError && allowed === true;
}
export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!(await authorized(req))) return json({ error: "forbidden" }, 403);
  let body: Row;
  try { body = obj(await req.json()); } catch { return json({ error: "invalid_json" }, 400); }
  const inboxId = numberId(body.inbox_id);
  const page = numberId(body.page);
  const apply = body.apply === true;
  if (!inboxId || !page || page > 100000) return json({ error: "invalid_page_or_inbox" }, 400);
  const db = admin();
  const { data: channels, error: channelError } = await db.from("channels")
    .select("id,name,chatwoot_inbox_id,type,status").eq("chatwoot_inbox_id", inboxId);
  if (channelError) return json({ error: "database_error" }, 500);
  if (!channels || channels.length !== 1) {
    return json({ error: "ambiguous_or_missing_inbox", review: true }, 409);
  }
  const channel = obj(channels[0]);
  // Archived channels may preserve history; they never become an outbound route here.
  const acct = envAcct();
  const base = `/api/v1/accounts/${encodeURIComponent(acct.accountId)}`;
  let items: Row[];
  try {
    const params = new URLSearchParams({
      status: "all", assignee_type: "all", inbox_id: String(inboxId), page: String(page),
    });
    items = conversationItems(await cwGet(`${base}/conversations?${params}`));
  } catch (error) {
    return json({ error: String(error) }, 503);
  }
  const result = { inbox_id: inboxId, page, apply, scanned: items.length,
    existing: 0, created: 0, linked: 0, review: 0, errors: 0,
    review_ids: [] as number[], next_page: items.length ? page + 1 : null as number | null };
  // One page is a small Chatwoot page. A repeated page is idempotent by exact IDs.
  for (const summary of items) {
    const convId = numberId(summary.id);
    if (!convId) { result.review++; continue; }
    try {
      const details = await cwGet(`${base}/conversations/${convId}`);
      if (numberId(details.id) !== convId || numberId(details.inbox_id) !== inboxId ||
        (numberId(details.account_id) && numberId(details.account_id) !== Number(acct.accountId))) {
        result.review++; result.review_ids.push(convId); continue;
      }
      const { data: existing, error: existingError } = await db.from("conversations")
        .select("id,channel_id,contact_id").eq("chatwoot_conversation_id", convId);
      if (existingError) throw existingError;
      if ((existing ?? []).length > 1 ||
        (existing ?? []).some((item: Row) => item.channel_id !== channel.id)) {
        result.review++; result.review_ids.push(convId); continue;
      }
      if ((existing ?? []).length === 1) { result.existing++; continue; }
      const sender = obj(obj(details.meta).sender);
      const contactId = numberId(sender.id);
      if (!contactId) { result.review++; result.review_ids.push(convId); continue; }
      const contact = await cwGet(`${base}/contacts/${contactId}`);
      if (numberId(contact.id) !== contactId ||
        (numberId(contact.account_id) && numberId(contact.account_id) !== Number(acct.accountId))) {
        result.review++; result.review_ids.push(convId); continue;
      }
      const phone = exactPhone(contact.phone_number);
      // Include the channel UUID: customerIdentityKey strips non-digits, and a
      // long Chatwoot ID alone must never be mistaken for a telephone.
      const sourceId = `chatwoot:${channel.id}:${contactId}`;
      const { data: sameId, error: sameIdError } = await db.from("contacts")
        .select("id,external_contact_id,customer_id,chatwoot_contact_id,name,attributes")
        .eq("channel_id", channel.id).eq("chatwoot_contact_id", contactId);
      if (sameIdError) throw sameIdError;
      if ((sameId ?? []).length > 1) {
        result.review++; result.review_ids.push(convId); continue;
      }
      let linked = sameId?.[0] ?? null;
      if (!linked) {
        const { data: bySource, error: sourceError } = await db.from("contacts")
          .select("id,external_contact_id,customer_id,chatwoot_contact_id,name,attributes")
          .eq("channel_id", channel.id).eq("external_contact_id", sourceId);
        if (sourceError) throw sourceError;
        if ((bySource ?? []).length > 1 ||
          (bySource ?? []).some((c: Row) => c.chatwoot_contact_id &&
            Number(c.chatwoot_contact_id) !== contactId)) {
          result.review++; result.review_ids.push(convId); continue;
        }
        linked = bySource?.[0] ?? null;
      }
      let currentCustomer: Row | null = null;
      if (linked?.customer_id) {
        const { data, error: customerError } = await db.from("customers")
          .select("identity_key,canonical_phone,display_name,avatar_url").eq("id", linked.customer_id).maybeSingle();
        currentCustomer = data;
        if (customerError || !currentCustomer ||
          (phone && currentCustomer.canonical_phone && currentCustomer.canonical_phone !== phone)) {
          result.review++; result.review_ids.push(convId); continue;
        }
      }
      if (!apply) { result.linked++; continue; }
      const name = usableContactName(contact.name);
      const avatar = typeof contact.thumbnail === "string" ? contact.thumbnail :
        typeof contact.avatar_url === "string" ? contact.avatar_url : null;
      const custom = obj(contact.custom_attributes);
      const declared = {
        chatwoot_identifier: typeof contact.identifier === "string"
          ? contact.identifier.trim().slice(0, 160) : null,
        chatwoot_email: typeof contact.email === "string" && contact.email.includes("@")
          ? contact.email.trim().slice(0, 254) : null,
        declared_city: typeof (custom.city ?? custom.cidade) === "string"
          ? String(custom.city ?? custom.cidade).trim().slice(0, 120) : null,
        declared_state: typeof (custom.state ?? custom.estado) === "string"
          ? String(custom.state ?? custom.estado).trim().slice(0, 80) : null,
        profile_source: "chatwoot_reconcile",
        profile_checked_at: new Date().toISOString(),
      };
      const customerId = linked?.customer_id
        ? String(linked.customer_id)
        : await ensureCustomer(db, {
          channelId: String(channel.id), externalId: sourceId,
          phone: null, name, avatarUrl: avatar, validateName: true,
          attributes: { chatwoot_contact_id: contactId, ...declared },
        });
      if (!linked && phone) {
        const { error: phoneError } = await db.from("customers")
          .update({ canonical_phone: phone }).eq("id", customerId);
        if (phoneError) throw phoneError;
      }
      if (currentCustomer) {
        const preferredName = bestContactName(currentCustomer.display_name, [name]);
        const { error: profileError } = await db.from("customers").update({
          ...(preferredName ? { display_name: preferredName } : {}),
          ...(!currentCustomer.avatar_url && avatar ? { avatar_url: avatar } : {}),
        }).eq("id", customerId);
        if (profileError) throw profileError;
      }
      let localContactId: string;
      if (linked) {
        const { error } = await db.from("contacts").update({
          customer_id: customerId, chatwoot_contact_id: contactId,
          ...(bestContactName(linked.name, [name]) ?
            { name: bestContactName(linked.name, [name]) } : {}),
          ...(phone ? { phone } : {}),
          attributes: { ...obj(linked.attributes), ...declared },
        }).eq("id", linked.id);
        if (error) throw error;
        localContactId = String(linked.id);
      } else {
        const { data: inserted, error } = await db.from("contacts").insert({
          channel_id: channel.id, external_contact_id: sourceId,
          customer_id: customerId, chatwoot_contact_id: contactId,
          phone, name, attributes: declared,
        }).select("id").single();
        if (error) throw error;
        localContactId = inserted.id;
      }
      const labels = Array.isArray(details.labels)
        ? details.labels.filter((item: unknown): item is string => typeof item === "string")
        : [];
      const status = ["open", "pending", "resolved", "snoozed"].includes(String(details.status))
        ? details.status : "open";
      const { error: insertError } = await db.from("conversations").upsert({
        channel_id: channel.id, contact_id: localContactId,
        chatwoot_conversation_id: convId, status,
        labels, opened_at: time(details.created_at),
      }, { onConflict: "channel_id,chatwoot_conversation_id" });
      if (insertError) throw insertError;
      result.created++;
    } catch (error) {
      result.errors++;
      if (String(error).includes("chatwoot_rate_limited")) {
        result.next_page = page;
        break;
      }
    }
  }
  return json(result);
}
