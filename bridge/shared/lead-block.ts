// lead-block — bloqueio durável de contato (etiqueta "nao-compra" no Chatwoot).
// Diferente de pausar/cancelar UMA conversa (funil-control.ts), isto marca o CONTATO
// (sobrevive a conversa resolvida/reaberta, a um novo funil, a um "iniciar funil" manual).
// Mesmo padrão de contacts.attributes já usado pra número morto (hub-webhook.ts:
// attributes.dead/dead_reason/dead_at) -- chave nova, mesma tabela, sem migration.
import type { DbClient } from "./supabase.ts";

type Json = Record<string, unknown>;
type Db = DbClient;

export function isContactBlocked(contact: Json | null | undefined): boolean {
  const attrs = (contact?.attributes ?? {}) as Json;
  return attrs.blocked === true;
}

/** Exclui automações normais; clientes pagos podem entrar em uma campanha explícita. */
export function isContactExcludedFromAutomation(
  contact: Json | null | undefined,
): boolean {
  const attrs = (contact?.attributes ?? {}) as Json;
  return attrs.blocked === true || attrs.automation_excluded === true;
}

export async function blockContact(
  db: Db,
  contactId: string,
  reason: string,
): Promise<void> {
  const { data: contact } = await db.from("contacts").select("attributes")
    .eq("id", contactId).maybeSingle();
  const attrs = (contact?.attributes ?? {}) as Json;
  await db.from("contacts").update({
    attributes: {
      ...attrs,
      blocked: true,
      blocked_reason: reason,
      blocked_at: new Date().toISOString(),
    },
  }).eq("id", contactId);
}
