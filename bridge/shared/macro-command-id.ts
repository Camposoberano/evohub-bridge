import { claimDelivery, releaseDelivery, type DbClient } from "./supabase.ts";

function claimKey(conversationId: number, label: string): string {
  return `soberano-macro-active:${conversationId}:${label}`;
}

/** Mesmo ID enquanto a etiqueta fica aplicada; novo ID depois de consumi-la. */
export async function currentMacroRequestId(
  db: DbClient,
  conversationId: number,
  label: string,
): Promise<string> {
  const key = claimKey(conversationId, label);
  await claimDelivery(db, key, "soberano-macro-active");
  const { data, error } = await db.from("deliveries")
    .select("received_at").eq("delivery_id", key).maybeSingle();
  if (error || !data?.received_at) throw new Error("macro sem ID persistido");
  return `${conversationId}:${label}:${String(data.received_at)}`;
}

export async function clearMacroRequestId(
  db: DbClient,
  conversationId: number,
  label: string,
): Promise<void> {
  await releaseDelivery(db, claimKey(conversationId, label));
}
