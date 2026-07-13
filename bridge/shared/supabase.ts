// Cliente Supabase com service_role (bypassa RLS) — uso exclusivo server-side.
// Conecta via REST (PostgREST) no SUPABASE_URL — funciona de qualquer container.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { env } from "./env.ts";

// supabase-js narrows clients to the literal schema type. The bridge schema is
// configurable, so keep the shared client type schema-agnostic.
export type DbClient = {
  from: (relation: string) => any;
  auth: any;
  storage: any;
};

export function admin(): DbClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    db: { schema: env("SUPABASE_SCHEMA", "evohub") },
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as DbClient;
}

// Dedup por entrega: insere delivery_id; se já existe (PK conflict), retorna false
// e o caller deve ignorar o evento (já processado).
export async function claimDelivery(
  db: DbClient,
  deliveryId: string | null,
  source: string,
): Promise<boolean> {
  if (!deliveryId) return true; // sem id, não dá pra deduplicar — processa
  const { error } = await db.from("deliveries").insert({ delivery_id: deliveryId, source });
  if (error) {
    if ((error as { code?: string }).code === "23505") return false; // unique_violation
    throw error;
  }
  return true;
}

export async function releaseDelivery(
  db: DbClient,
  deliveryId: string | null,
): Promise<void> {
  if (!deliveryId) return;
  const { error } = await db.from("deliveries").delete().eq(
    "delivery_id",
    deliveryId,
  );
  if (error) throw error;
}
