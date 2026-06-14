// uazapi — proxy autenticado pro dashboard operar o WhatsApp não-oficial.
// O browser manda { action, instance, ...params }; o bridge resolve o token da
// instância e chama a uazapi. Tokens nunca vão pro browser.
// Auth: JWT do usuário do dashboard.
import { env } from "../shared/env.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { instGet, instPost, listInstances, tokenForInstance, uazapiConfigured } from "../shared/uazapi.ts";

type Json = Record<string, unknown>;

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!uazapiConfigured()) return json({ error: "uazapi não configurado (UAZAPI_URL/UAZAPI_ADMIN_TOKEN)" }, 503);

  const userClient = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({})) as Json;
  const action = body.action as string;
  const instance = body.instance as string | undefined;

  try {
    // Ações que não precisam de instância
    if (action === "instances") {
      const list = await listInstances();
      // não devolve token pro browser
      return json({ instances: list.map(({ token: _t, ...rest }) => rest) });
    }

    // Demais ações precisam do token da instância
    if (!instance) return json({ error: "instance obrigatório" }, 400);
    const token = await tokenForInstance(instance);
    if (!token) return json({ error: "instância não encontrada" }, 404);

    switch (action) {
      case "status":
        return passthru(await instGet("/instance/status", token));
      case "connect":
        return passthru(await instPost("/instance/connect", token, { phone: body.phone ?? undefined }));
      case "disconnect":
        return passthru(await instPost("/instance/disconnect", token, {}));
      case "check": {
        const numbers = (body.numbers ?? []) as string[];
        return passthru(await instPost("/chat/check", token, { numbers }));
      }
      case "send_text":
        return passthru(await instPost("/send/text", token, { number: body.number, text: body.text, delay: body.delay }));
      case "campaign": {
        // disparo em massa com espaçamento (sender/simple)
        const payload: Json = {
          numbers: body.numbers ?? [],
          type: body.type ?? "text",
          text: body.text,
          file: body.file,
          delayMin: body.delayMin ?? 60,
          delayMax: body.delayMax ?? 180,
          scheduled_for: body.scheduled_for ?? 0,
          info: body.info,
        };
        return passthru(await instPost("/sender/simple", token, payload));
      }
      case "campaigns_list":
        return passthru(await instGet("/sender/listfolders", token));
      default:
        return json({ error: "ação desconhecida: " + action }, 400);
    }
  } catch (e) {
    return json({ error: String(e) }, 502);
  }
}

function passthru(r: { ok: boolean; status: number; data: unknown }): Response {
  return json(r.data as Json, r.ok ? 200 : r.status);
}
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
