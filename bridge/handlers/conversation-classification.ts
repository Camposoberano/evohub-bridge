// conversation-classification — registra a UF declarada pelo contato no dashboard.
// Auth: JWT do usuário do dashboard; grava via service role, sem consultar mensagens/DDD.
// Body: { conversation_id: uuid, region: UF|null }
import { admin } from "../shared/supabase.ts";
import { env } from "../shared/env.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BRAZILIAN_STATES = new Set([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
  "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC",
  "SP", "SE", "TO",
]);

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authz = req.headers.get("Authorization") ?? "";
  const userClient = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authz } },
    auth: { persistSession: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) return json({ error: "unauthorized" }, 401);

  const payload: unknown = await req.json().catch(() => ({}));
  const body = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const conversationId = typeof body.conversation_id === "string"
    ? body.conversation_id.trim()
    : "";
  const rawRegion = body.region;
  const region = typeof rawRegion === "string" ? rawRegion.trim().toUpperCase() : null;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId)) {
    return json({ error: "conversation_id inválido" }, 400);
  }
  if (rawRegion !== null && typeof rawRegion !== "string") {
    return json({ error: "region deve ser uma UF ou null" }, 400);
  }
  if (region && !BRAZILIAN_STATES.has(region)) {
    return json({ error: "region deve conter uma UF brasileira válida" }, 400);
  }

  const db = admin();
  const { data: conversation, error: conversationError } = await db.from("conversations")
    .select("id").eq("id", conversationId).maybeSingle();
  if (conversationError) return json({ error: conversationError.message }, 500);
  if (!conversation) return json({ error: "conversa não encontrada" }, 404);

  const { data, error } = await db.from("leads_qualification").upsert({
    conversation_id: conversationId,
    region: region || null,
  }, { onConflict: "conversation_id" }).select("conversation_id,region").single();
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true, classification: data });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
