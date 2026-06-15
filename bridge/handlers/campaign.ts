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

const SEND_CONCURRENCY = 5;
const SEND_TIMEOUT_MS = 25_000;

type WaChannel = {
  id: string;
  name: string;
  phone_number_id: string;
  phone_number: string | null;
  display_name: string | null;
  status: string;
};

async function resolveWhatsAppChannel(channelId?: string): Promise<WaChannel | null> {
  const db = admin();
  const cols = "id,name,phone_number_id,phone_number,display_name,status";
  if (channelId) {
    const { data: ch } = await db.from("channels").select(cols)
      .eq("id", channelId).eq("type", "whatsapp").maybeSingle();
    return ch?.phone_number_id ? ch as WaChannel : null;
  }
  const { data: active } = await db.from("channels").select(cols)
    .eq("type", "whatsapp").eq("status", "active").not("phone_number_id", "is", null)
    .order("connected_at", { ascending: false }).limit(1).maybeSingle();
  if (active) return active as WaChannel;
  const { data: any } = await db.from("channels").select(cols)
    .eq("type", "whatsapp").not("phone_number_id", "is", null)
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  return any?.phone_number_id ? any as WaChannel : null;
}

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
    const official = await resolveWhatsAppChannel();
    return json({ campaigns: state.campaigns, counts, officialChannel: official });
  }

  if (action === "start") {
    const numbers = [...new Set(((body.numbers ?? []) as string[]).map(numKey).filter((d) => d.length >= 12))];
    const template = body.template as string;
    const language = (body.language as string) ?? "pt_BR";
    if (!template || numbers.length === 0) return json({ error: "template e numbers obrigatórios" }, 400);

    const ch = await resolveWhatsAppChannel(body.channel_id as string | undefined);
    if (!ch?.phone_number_id) {
      return json({ error: "nenhum canal WhatsApp oficial ativo com phone_number_id — conecte em /conexoes" }, 404);
    }
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

    // componentes do template: header de mídia (imagem/vídeo/documento) se informado.
    let components = (body.components as Json[]) ?? [];
    const hm = body.headerMedia as Json | undefined; // { format:"image"|"video"|"document", link }
    if (hm?.link && hm?.format) {
      const fmt = String(hm.format).toLowerCase();
      components = [{ type: "header", parameters: [{ type: fmt, [fmt]: { link: hm.link } }] }, ...components];
    }

    const metaPath = `${ch.phone_number_id}/messages`;
    const payload = { messaging_product: "whatsapp", type: "template", template: { name: template, language: { code: language }, components } };

    let sent = 0, failed = 0; const errors: string[] = [];
    await mapPool(numbers, SEND_CONCURRENCY, async (to) => {
      const r = await sendMetaWithTimeout(token, metaPath, { ...payload, to });
      if (r.ok) {
        sent++;
        state.targets[to] = { campaignId: camp.id, status: "awaiting", step: 0, ts: new Date().toISOString() };
      } else {
        failed++;
        if (errors.length < 3) {
          const detail = (r.data as Json)?.error ?? r.data;
          errors.push(r.timedOut ? "timeout" : JSON.stringify(detail).slice(0, 120));
        }
      }
    });

    try {
      await writeCampaigns(state);
    } catch (e) {
      return json({ error: String(e), campaign: camp.id, sent, failed, partial: true }, 500);
    }
    return json({
      ok: true, campaign: camp.id, sent, failed, total: numbers.length, awaiting: sent, errors,
      channel: { id: ch.id, name: ch.name, phone_number: ch.phone_number, display_name: ch.display_name },
    });
  }

  return json({ error: "ação desconhecida: " + action }, 400);
}

async function sendMetaWithTimeout(
  channelToken: string,
  path: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; data: unknown; timedOut?: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ ok: false; status: 0; data: { error: string }; timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, status: 0, data: { error: "timeout" }, timedOut: true }), SEND_TIMEOUT_MS);
  });
  try {
    return await Promise.race([sendMeta(channelToken, path, body), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function mapPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
