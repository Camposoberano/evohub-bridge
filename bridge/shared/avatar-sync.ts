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
    .select("id,phone,external_contact_id,chatwoot_contact_id,channel_id,attributes,channels!inner(type)")
    .eq("channels.type", "whatsapp")
    .not("chatwoot_contact_id", "is", null)
    .is("attributes->avatar_set", null)
    .order("last_seen_at", { ascending: false })
    .limit(5);

  // filtra pseudo-contatos (comentários cmt-*, grupos @g.us) e sem dígitos.
  const contact = (rows ?? []).find((c: Json) => {
    const ext = String(c.external_contact_id ?? "");
    return !ext.startsWith("cmt-") && !ext.includes("@g.us") && /^\d{10,15}$/.test(ext.replace(/\D/g, ""));
  }) as Json | undefined;
  if (!contact) return "idle";

  const number = String(contact.external_contact_id).replace(/\D/g, "");
  const mark = async (v: unknown) => {
    const attrs = { ...((contact.attributes as Json) ?? {}), avatar_set: v };
    await db.from("contacts").update({ attributes: attrs }).eq("id", contact.id);
  };

  const r = await instPost("/chat/details", token, { number });
  const d = (r.data ?? {}) as Json;
  const image = (d.image as string) || (d.imagePreview as string) || "";
  if (!r.ok || !image) { await mark("none"); return `sem-foto ${number}`; }

  // grava avatar no Chatwoot (ele baixa a URL e passa a exibir a foto do contato).
  const acct = await accountForChannel(contact.channel_id as string);
  const res = await fetch(`${acct.url.replace(/\/+$/, "")}/api/v1/accounts/${acct.accountId}/contacts/${contact.chatwoot_contact_id}`, {
    method: "PUT",
    headers: { "api_access_token": acct.adminToken ?? acct.token, "Content-Type": "application/json" },
    body: JSON.stringify({ avatar_url: image }),
  });
  if (!res.ok) { await mark("none"); return `cw-falhou ${number} (${res.status})`; }

  await mark(true);
  return `foto ${number}`;
}
