import type { DbClient } from "./supabase.ts";

export type Json = Record<string, unknown>;

function first(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Json
    : {};
}

export function normalizeLeadAttribution(referral?: Json | null): Json {
  if (!referral) return {};
  const external = object(
    referral.externalAdReply ?? referral.external_ad_reply,
  );
  const source = Object.keys(external).length ? external : referral;
  const normalized: Json = {
    ad_id: first(
      source.ad_id,
      source.source_id,
      referral.ad_id,
      referral.source_id,
    ),
    ad_name: first(
      source.ad_name,
      source.headline,
      referral.ad_name,
      referral.headline,
    ),
    campaign_id: first(source.campaign_id, referral.campaign_id),
    campaign_name: first(source.campaign_name, referral.campaign_name),
    creative_id: first(
      source.creative_id,
      source.creativeId,
      referral.creative_id,
    ),
    creative_name: first(
      source.creative_name,
      source.body,
      referral.creative_name,
    ),
    source_url: first(source.source_url, source.sourceUrl, referral.source_url),
    source_type: first(
      source.source_type,
      source.sourceType,
      referral.source_type,
    ),
    ctwa_clid: first(source.ctwa_clid, source.ctwaClid, referral.ctwa_clid),
    media_url: first(
      source.media_url,
      source.thumbnail_url,
      referral.media_url,
    ),
  };
  for (const key of Object.keys(normalized)) {
    if (normalized[key] == null) delete normalized[key];
  }
  return { ...normalized, raw: referral };
}

export function sourceSnapshot(
  channel: Json,
  externalId: string,
  referral?: Json | null,
): Json {
  const attribution = normalizeLeadAttribution(referral);
  const sourceNumber = first(
    channel.phone_number,
    channel.display_name,
    channel.page_id,
    channel.ig_id,
    channel.name,
  );
  return {
    source_channel_name: first(channel.name),
    source_channel_type: first(channel.type),
    source_number: sourceNumber,
    source_owner_name: first(channel.owner_name),
    lead_platform_id: externalId,
    ad_id: attribution.ad_id ?? null,
    ad_name: attribution.ad_name ?? null,
    campaign_id: attribution.campaign_id ?? null,
    campaign_name: attribution.campaign_name ?? null,
    creative_id: attribution.creative_id ?? null,
    creative_name: attribution.creative_name ?? null,
    source_url: attribution.source_url ?? null,
    ctwa_clid: attribution.ctwa_clid ?? null,
    attribution,
  };
}

export function mergeLeadAttributes(
  existing: Json | null | undefined,
  channel: Json,
  externalId: string,
  referral?: Json | null,
  avatarUrl?: string | null,
): Json {
  const snapshot = sourceSnapshot(channel, externalId, referral);
  const previous = existing ?? {};
  const firstSource = object(previous.first_source);
  const firstAttribution = object(previous.first_attribution);
  const attribution = object(snapshot.attribution);
  return {
    ...previous,
    platform_id: externalId,
    channel_id: channel.id ?? null,
    channel_name: snapshot.source_channel_name,
    channel_type: snapshot.source_channel_type,
    source_number: snapshot.source_number,
    source_owner_name: snapshot.source_owner_name,
    phone_availability: channel.type === "whatsapp"
      ? "available"
      : "not_provided_by_meta",
    avatar_url: avatarUrl || previous.avatar_url || null,
    first_source: Object.keys(firstSource).length ? firstSource : {
      channel_id: channel.id ?? null,
      channel_name: snapshot.source_channel_name,
      channel_type: snapshot.source_channel_type,
      source_number: snapshot.source_number,
      source_owner_name: snapshot.source_owner_name,
    },
    first_attribution: Object.keys(firstAttribution).length
      ? firstAttribution
      : attribution,
    last_attribution: Object.keys(attribution).length
      ? attribution
      : previous.last_attribution ?? {},
    lead_profile_updated_at: new Date().toISOString(),
  };
}

export async function syncInboundCliente(
  db: DbClient,
  input: {
    channel: Json;
    externalId: string;
    customerId: string;
    name?: string | null;
    referral?: Json | null;
  },
): Promise<void> {
  if (input.channel.type !== "whatsapp") return;
  const phone = input.externalId.replace(/\D/g, "");
  if (!/^\d{10,15}$/.test(phone)) return;
  const { data: current, error: queryError } = await db.from("clientes")
    .select("*").eq("phone", phone).maybeSingle();
  if (queryError) throw queryError;
  const raw = {
    ...object(current?.raw),
    inbound: {
      channel_id: input.channel.id ?? null,
      channel_name: input.channel.name ?? null,
      source_number: input.channel.phone_number ?? input.channel.display_name ??
        input.channel.name ?? null,
      source_owner_name: input.channel.owner_name ?? null,
      attribution: normalizeLeadAttribution(input.referral),
      captured_at: new Date().toISOString(),
    },
  };
  const { error } = await db.from("clientes").upsert({
    phone,
    customer_id: input.customerId,
    source_number: current?.source_number ?? input.channel.phone_number ??
      input.channel.name ?? null,
    lead_name: input.name || current?.lead_name || null,
    enrich_status: current?.enrich_status ?? "pending",
    raw,
    updated_at: new Date().toISOString(),
  }, { onConflict: "phone" });
  if (error) throw error;
}
