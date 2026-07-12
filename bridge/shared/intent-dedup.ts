import type { DbClient } from "./supabase.ts";

export type CommercialIntent = "preco" | "video" | "plantio" | "nutricao";

export function brtDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function dailyIntentKey(
  channelId: string,
  contactId: string,
  intent: CommercialIntent,
  now = new Date(),
): string {
  const normalizedContact = normalizeContactId(contactId);
  return `commercial-intent:${intent}:${channelId}:${normalizedContact}:${brtDay(now)}`;
}

export function normalizeContactId(value: string): string {
  const base = value.split("@")[0].split(":")[0];
  const digits = base.replace(/\D/g, "");
  return digits || value.trim().toLocaleLowerCase("pt-BR");
}

export async function claimDailyIntent(
  db: DbClient,
  channelId: string,
  contactId: string,
  intent: CommercialIntent,
): Promise<{ claimed: boolean; key: string }> {
  const key = dailyIntentKey(channelId, contactId, intent);
  const { error } = await db.from("deliveries").insert({
    delivery_id: key,
    source: "commercial-intent-daily",
  });
  if (!error) return { claimed: true, key };
  if ((error as { code?: string }).code === "23505") {
    return { claimed: false, key };
  }
  throw error;
}

export async function releaseDailyIntent(db: DbClient, key: string): Promise<void> {
  await db.from("deliveries").delete().eq("delivery_id", key);
}
