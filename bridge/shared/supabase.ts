// Cliente Supabase com service_role (bypassa RLS) — uso exclusivo server-side.
// Conecta via REST (PostgREST) no SUPABASE_URL — funciona de qualquer container.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { env } from "./env.ts";

export function admin(): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Dedup por entrega: insere delivery_id; se já existe (PK conflict), retorna false
// e o caller deve ignorar o evento (já processado).
export async function claimDelivery(
  db: SupabaseClient,
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
