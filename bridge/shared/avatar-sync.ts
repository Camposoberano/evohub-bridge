// avatar-sync — foto de perfil dos CONTATOS no Chatwoot. A API oficial da Meta não expõe
// foto (privacidade), então usamos a instância uazapi de trabalho como "lupa": /chat/details
// de qualquer número devolve image/imagePreview. Loop lento e aleatório (anti-ban, mesmo
// ritmo do enrich). Pega 1 contato por tick, mais recentes primeiro (lead novo ganha foto logo).
import { instPost } from "./uazapi.ts";
import { accountForChannel } from "./accounts.ts";
import type { DbClient } from "./supabase.ts";

type Json = Record<string, unknown>;

export async function avatarStep(db: DbClient, token: string): Promise<string> {
  // candidato: contato WhatsApp com contato Chatwoot criado, número real e sem avatar tratado.
  // attributes.avatar_set: true = foto posta | "none" = número sem foto (não re-tenta).
  const { data: rows } = await db.from("contacts")
    .select("id,phone,name,external_contact_id,chatwoot_contact_id,channel_id,customer_id,attributes,last_seen_at,channels!inner(type)")
    .eq("channels.type", "whatsapp")
    .not("chatwoot_contact_id", "is", null)
    .order("last_seen_at", { ascending: false })
    .limit(50);

  // filtra pseudo-contatos (comentários cmt-*, grupos @g.us) e sem dígitos.
  const retryBefore = Date.now() - 24 * 60 * 60 * 1000;
  const contact = (rows ?? []).find((c: Json) => {
    const ext = String(c.external_contact_id ?? "");
    const attrs = (c.attributes as Json) ?? {};
    const checkedAt = Date.parse(String(attrs.profile_checked_at ?? ""));
    const needsProfile = attrs.avatar_set !== true && (!checkedAt || checkedAt < retryBefore);
    return needsProfile && !ext.startsWith("cmt-") && !ext.includes("@g.us") && /^\d{10,15}$/.test(ext.replace(/\D/g, ""));
  }) as Json | undefined;
  if (!contact) return "idle";

  const number = String(contact.external_contact_id).replace(/\D/g, "");
  const r = await instPost("/chat/details", token, { number });
  const d = (r.data ?? {}) as Json;
  const image = (d.image as string) || (d.imagePreview as string) || "";
  const profileName = String(d.wa_name ?? d.wa_contactName ?? d.verifiedName ?? d.name ?? "").trim();
  const attrs = {
    ...((contact.attributes as Json) ?? {}),
    avatar_set: image ? true : "none",
    avatar_url: image || null,
    profile_checked_at: new Date().toISOString(),
    whatsapp_jid: d.jid ?? d.wa_jid ?? null,
    whatsapp_lid: d.lid ?? d.wa_lid ?? null,
    whatsapp_name: d.wa_name ?? d.name ?? null,
    whatsapp_contact_name: d.wa_contactName ?? null,
    whatsapp_verified_name: d.verifiedName ?? null,
  };
  await db.from("contacts").update({
    attributes: attrs,
    name: profileName || contact.name || null,
  }).eq("id", contact.id);
  if (contact.customer_id) {
    await db.from("customers").update({
      display_name: profileName || contact.name || null,
      avatar_url: image || null,
      last_seen_at: contact.last_seen_at ?? new Date().toISOString(),
    }).eq("id", contact.customer_id);
  }
  if (!r.ok || !image) return `sem-foto ${number}`;

  // grava avatar no Chatwoot (ele baixa a URL e passa a exibir a foto do contato).
  const acct = await accountForChannel(contact.channel_id as string);
  const res = await fetch(`${acct.url.replace(/\/+$/, "")}/api/v1/accounts/${acct.accountId}/contacts/${contact.chatwoot_contact_id}`, {
    method: "PUT",
    headers: { "api_access_token": acct.adminToken ?? acct.token, "Content-Type": "application/json" },
    body: JSON.stringify({ avatar_url: image }),
  });
  if (!res.ok) return `cw-falhou ${number} (${res.status})`;
  return `foto ${number}`;
}
