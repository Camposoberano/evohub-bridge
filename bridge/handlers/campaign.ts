// campaign — motor de campanha gated (oficial). action:
//   status  -> lista campanhas + contagem por estado
//   start   -> dispara template oficial pra lista; cada número fica "awaiting"
// O "resume" (resposta -> sequência) é no hub-webhook. Auth: JWT do dashboard.
import { admin } from "../shared/supabase.ts";
import { env } from "../shared/env.ts";
import { sendMeta } from "../shared/hub.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type Campaign, numKey, readCampaigns, type Step, writeCampaigns } from "../shared/campaigns.ts";

type Json = Record<string, unknown>;

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const uc = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  if (!(await uc.auth.getUser()).data?.user) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({})) as Json;
  const action = body.action as string;
  const state = await readCampaigns();

  if (action === "status") {
    const counts: Record<string, { awaiting: number; active: number; done: number }> = {};
    for (const t of Object.values(state.targets)) {
      counts[t.campaignId] = counts[t.campaignId] ?? { awaiting: 0, active: 0, done: 0 };
      counts[t.campaignId][t.status]++;
    }
    return json({ campaigns: state.campaigns, counts });
  }

  if (action === "start") {
    const numbers = [...new Set(((body.numbers ?? []) as string[]).map(numKey).filter((d) => d.length >= 12))];
    const template = body.template as string;
    const language = (body.language as string) ?? "pt_BR";
    if (!template || numbers.length === 0) return json({ error: "template e numbers obrigatórios" }, 400);

    // canal whatsapp oficial (EVO Hub)
    const { data: ch } = await admin().from("channels").select("id,phone_number_id").eq("type", "whatsapp").not("phone_number_id", "is", null).limit(1).maybeSingle();
    if (!ch?.phone_number_id) return json({ error: "canal whatsapp oficial sem phone_number_id" }, 404);
    const { data: secret } = await admin().from("channel_secrets").select("channel_token").eq("channel_id", ch.id).maybeSingle();
    const token = secret?.channel_token as string | undefined;
    if (!token) return json({ error: "canal sem token" }, 404);

    const camp: Campaign = {
      id: "camp_" + new Date().toISOString().replace(/\D/g, "").slice(0, 14),
      name: (body.name as string) ?? template,
      template, language,
      steps: (body.steps as Step[]) ?? [],
      delayMin: Number(body.delayMin ?? 1), delayMax: Number(body.delayMax ?? 3),
      createdAt: new Date().toISOString(),
    };
    state.campaigns.push(camp);

    let sent = 0, failed = 0;
    for (const to of numbers) {
      const r = await sendMeta(token, `${ch.phone_number_id}/messages`, {
        messaging_product: "whatsapp", to, type: "template",
        template: { name: template, language: { code: language }, components: (body.components as Json[]) ?? [] },
      });
      if (r.ok) { sent++; state.targets[to] = { campaignId: camp.id, status: "awaiting", step: 0, ts: new Date().toISOString() }; }
      else failed++;
    }
    await writeCampaigns(state);
    return json({ ok: true, campaign: camp.id, sent, failed, awaiting: sent });
  }

  return json({ error: "ação desconhecida: " + action }, 400);
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
