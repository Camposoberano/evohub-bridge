import type { DbClient } from "./supabase.ts";

type Json = Record<string, unknown>;

function digits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function customerIdentityKey(
  channelId: string,
  externalId: string,
  phone?: string | null,
): { key: string; normalizedPhone: string | null } {
  const d = digits(phone || externalId);
  if (/^\d{10,15}$/.test(d)) {
    return { key: `phone:${d}`, normalizedPhone: `+${d}` };
  }
  return { key: `channel:${channelId}:${externalId}`, normalizedPhone: null };
}

export async function ensureCustomer(
  db: DbClient,
  input: {
    channelId: string;
    externalId: string;
    phone?: string | null;
    name?: string | null;
    avatarUrl?: string | null;
    attributes?: Json;
  },
): Promise<string> {
  const identity = customerIdentityKey(
    input.channelId,
    input.externalId,
    input.phone,
  );
  const { data: existing } = await db.from("customers")
    .select("id,display_name,canonical_phone,avatar_url,attributes")
    .eq("identity_key", identity.key).maybeSingle();
  const { data, error } = await db.from("customers").upsert({
    identity_key: identity.key,
    canonical_phone: identity.normalizedPhone || existing?.canonical_phone ||
      null,
    display_name: input.name || existing?.display_name || null,
    avatar_url: input.avatarUrl || existing?.avatar_url || null,
    attributes: {
      ...((existing?.attributes as Json) ?? {}),
      ...(input.attributes ?? {}),
    },
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "identity_key" }).select("id,display_name").single();
  if (error) throw error;

  return data.id as string;
}

export function customerFromContact(
  contact: Json | null | undefined,
): Json | null {
  return (contact?.customers as Json | undefined) ?? null;
}
