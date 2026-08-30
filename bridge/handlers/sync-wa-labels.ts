// sync-wa-labels — traz as etiquetas aplicadas dentro do WhatsApp (uazapi) para
// `conversations.labels` e deriva `outcome`.
//
// Motivo: o time marca "Pago" / "Não COMPRA" direto no WhatsApp, que é mais rápido no
// dia a dia do que abrir o Chatwoot. Sem isso essas marcações não viravam desfecho e a
// taxa de conversão ficava incompleta.
//
// As etiquetas entram prefixadas com `wa:` para não colidirem com as do Chatwoot —
// cada sync substitui só a sua fatia (ver shared/outcome-labels.ts).
// Cobre apenas o canal não-oficial: o WhatsApp oficial (Meta) não tem etiquetas.
// Auth: ?token=<SYNC_SECRET|CHATWOOT_WEBHOOK_SECRET>.
import { confereSegredo } from "../shared/segredo-bridge.ts";
import { admin } from "../shared/supabase.ts";
import { env, optionalEnv } from "../shared/env.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { instGet, instPost, listInstances } from "../shared/uazapi.ts";
import {
  deriveOutcome,
  mergeLabels,
  sameLabels,
  splitByOrigin,
  WA_PREFIX,
} from "../shared/outcome-labels.ts";
import { excludePaidContact, stopContactAutomation } from "../shared/stop-contact.ts";

type Chat = {
  wa_chatid?: string;
  wa_isGroup?: boolean;
  wa_label?: string[];
};

export async function handle(req: Request): Promise<Response> {
  if (!["GET", "POST"].includes(req.method)) {
    return json({ error: "method not allowed" }, 405);
  }
  const url = new URL(req.url);
  if (!isAuthorized(req, url)) return json({ error: "unauthorized" }, 401);

  const db = admin();
  const errors: string[] = [];
  let scanned = 0;
  let labelsUpdated = 0;
  let outcomeSet = 0;

  // Só instâncias uazapi que têm canal correspondente no banco (channels.name == instância).
  const { data: channels, error: chErr } = await db.from("channels")
    .select("id,name").eq("type", "whatsapp");
  if (chErr) return json({ error: chErr.message }, 500);
  const byName = new Map<string, string>(
    ((channels ?? []) as Array<{ id: string; name: string }>).map(
      (c) => [String(c.name), String(c.id)],
    ),
  );

  let instances: Array<{ name: string; token: string }>;
  try {
    instances = await listInstances();
  } catch (e) {
    return json({
      error: `uazapi listInstances: ${
        e instanceof Error ? e.message : String(e)
      }`,
    }, 502);
  }

  for (const inst of instances) {
    const channelId = byName.get(inst.name);
    if (!channelId) continue; // instância sem canal no bridge — ignora

    let labelName: Map<string, string>;
    let chats: Chat[];
    try {
      labelName = await labelCatalog(inst.token);
      chats = await listChats(inst.token);
    } catch (e) {
      errors.push(
        `${inst.name}: ${e instanceof Error ? e.message : String(e)}`,
      );
      continue;
    }

    for (const chat of chats) {
      if (chat.wa_isGroup) continue;
      const ids = Array.isArray(chat.wa_label) ? chat.wa_label : [];
      if (ids.length === 0) continue;

      const phone = phoneOf(chat.wa_chatid);
      if (!phone) continue;
      scanned++;

      const names = ids
        .map((id) => labelName.get(id))
        .filter((n): n is string => Boolean(n))
        .map((n) => `${WA_PREFIX}${n.trim()}`);
      if (names.length === 0) continue;

      const { data: contact } = await db.from("contacts")
        .select("id,attributes").eq("channel_id", channelId)
        .eq("external_contact_id", phone).maybeSingle();
      if (!contact) continue;

      const { data: row } = await db.from("conversations")
        .select("id,labels,outcome,outcome_source")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle();
      if (!row) continue;

      // Preserva o que veio do Chatwoot; substitui só a fatia do WhatsApp.
      const { chatwoot } = splitByOrigin(row.labels);
      const next = mergeLabels(chatwoot, names);

      const patch: Record<string, unknown> = {};
      if (!sameLabels(row.labels, next)) {
        patch.labels = next;
        labelsUpdated++;
      }

      const derived = deriveOutcome(next);
      const manual = row.outcome_source === "dashboard";
      const blocked = (contact.attributes as Record<string, unknown> | null)
        ?.blocked === true;
      if (derived && !manual && row.outcome !== derived) {
        patch.outcome = derived;
        patch.outcome_source = "whatsapp-label";
        patch.outcome_set_at = new Date().toISOString();
        outcomeSet++;
      }

      // Também corrige contatos legados cujo outcome já era `lost` antes do
      // bloqueio durável existir. Depois de bloqueado, não repete a operação.
      if (derived === "lost" && (!blocked || row.outcome !== "lost")) {
        try {
          await stopContactAutomation(db, channelId, phone, "whatsapp-label");
        } catch (e) {
          errors.push(
            `${inst.name}/${phone}: stop ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      if (derived === "won" &&
        !(contact.attributes as Record<string, unknown> | null)?.automation_excluded) {
        try {
          await excludePaidContact(db, channelId, phone);
        } catch (e) {
          errors.push(
            `${inst.name}/${phone}: paid ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      if (Object.keys(patch).length === 0) continue;
      patch.updated_at = new Date().toISOString();

      const { error: updErr } = await db.from("conversations")
        .update(patch).eq("id", row.id);
      if (updErr) errors.push(`${inst.name}/${phone}: ${updErr.message}`);
    }
  }

  return json({
    ok: true,
    scanned,
    labels_updated: labelsUpdated,
    outcome_set: outcomeSet,
    errors: errors.slice(0, 10),
  });
}

/** id da etiqueta ("5519999715895:3") -> nome ("Não COMPRA"). */
async function labelCatalog(token: string): Promise<Map<string, string>> {
  const res = await instGet("/labels", token);
  if (!res.ok) throw new Error(`GET /labels ${res.status}`);
  const body = res.data as Record<string, unknown> | unknown[];
  const list = (Array.isArray(body) ? body : (body?.labels ?? [])) as Array<
    Record<string, unknown>
  >;
  const map = new Map<string, string>();
  for (const l of list) {
    const id = l?.id ?? l?.labelId;
    const name = l?.name ?? l?.title;
    if (id && name) map.set(String(id), String(name));
  }
  return map;
}

async function listChats(token: string): Promise<Chat[]> {
  const res = await instPost("/chat/find", token, {});
  if (!res.ok) throw new Error(`POST /chat/find ${res.status}`);
  const body = res.data as Record<string, unknown> | unknown[];
  const chats = Array.isArray(body) ? body : (body?.chats ?? []);
  return Array.isArray(chats) ? chats as Chat[] : [];
}

/** "556792656351@s.whatsapp.net" -> "556792656351" (formato de contacts.external_contact_id). */
function phoneOf(chatId: string | undefined): string | null {
  if (!chatId) return null;
  const digits = chatId.split("@")[0].replace(/\D/g, "");
  return digits.length >= 10 ? digits : null;
}

function isAuthorized(req: Request, url: URL): boolean {
  const auth = req.headers.get("Authorization") ?? "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  const token = bearer || url.searchParams.get("token") || "";
  const expected = optionalEnv("SYNC_SECRET") ?? env("CHATWOOT_WEBHOOK_SECRET");
  return confereSegredo(token, [expected]);
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
