// conversation-outcome — dashboard marca uma conversa como ganho/perdido/aberto (comercial).
// Auth: JWT do usuário do dashboard (igual connect-channel). Escreve via service role.
// Body: { conversation_id: uuid, outcome: "won"|"lost"|"open", value_cents?: number }
import { admin } from "../shared/supabase.ts";
import { env } from "../shared/env.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Outcome = "won" | "lost" | "open";

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authz = req.headers.get("Authorization") ?? "";
  const userClient = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authz } },
    auth: { persistSession: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const conversationId = (body.conversation_id as string | undefined)?.trim();
  const outcome = body.outcome as Outcome | undefined;
  const valueCentsRaw = body.value_cents;

  if (!conversationId) return json({ error: "conversation_id obrigatório" }, 400);
  if (!["won", "lost", "open"].includes(outcome ?? "")) {
    return json({ error: "outcome deve ser won|lost|open" }, 400);
  }

  const valueCents = typeof valueCentsRaw === "number" && Number.isFinite(valueCentsRaw)
    ? Math.max(0, Math.round(valueCentsRaw))
    : null;

  const db = admin();
  const patch: Record<string, unknown> = {
    outcome,
    outcome_source: "dashboard",
    outcome_set_at: outcome === "open" ? null : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (outcome === "won") patch.outcome_value_cents = valueCents;
  if (outcome === "lost" || outcome === "open") patch.outcome_value_cents = null;

  const { data, error } = await db.from("conversations")
    .update(patch).eq("id", conversationId).select("id,outcome,outcome_value_cents").maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: "conversa não encontrada" }, 404);

  return json({ ok: true, conversation: data });
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
