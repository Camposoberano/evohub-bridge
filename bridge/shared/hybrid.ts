// hybrid — rota híbrida AUTO-DISCOVERY: cruza phone_number do canal oficial com
// números conectados no uazapi. Se o mesmo número está no oficial E no uazapi,
// mensagens de serviço saem pelo não-oficial (R$0). Templates sempre pela oficial.
// Se uazapi falhar (offline, bloqueio web), fallback automático pra sendMeta.
//
// Zero config: não precisa de JSON manual. Basta conectar o número no uazapi
// (coexistência) e o bridge detecta sozinho.
import {
  instPost as uazInstPost,
  listInstances,
  uazapiConfigured,
} from "./uazapi.ts";

type Json = Record<string, unknown>;
type UazInstance = { name: string; number: string | null; status: string; token: string };

export type HybridRoute = {
  provider: "uazapi";
  instance: string;
  token: string;
};

// Cache das instâncias uazapi (recarrega a cada 60s).
let instCache: UazInstance[] = [];
let ts = 0;
const TTL_MS = 60_000;

async function refreshInstances() {
  const now = Date.now();
  if (instCache.length && now - ts <= TTL_MS) return;
  try {
    instCache = await listInstances();
    ts = now;
  } catch (e) { console.warn("hybrid: erro listando uazapi:", String(e).slice(0, 100)); }
}

// Normaliza número pra comparação: só dígitos, sem +/espaço/traço.
function norm(n: string | null | undefined): string {
  return (n ?? "").replace(/\D/g, "");
}

// Descobre se o canal oficial tem espelho uazapi pelo número.
// channelPhone = phone_number do canal (display_phone_number da Meta, ex: "+55 11 91036-3320")
// Cruza contra os números conectados nas instâncias uazapi.
export async function getHybridRoute(
  _channelId: string,
  _phoneNumberId?: string,
  channelPhone?: string,
): Promise<HybridRoute | null> {
  if (!uazapiConfigured() || !channelPhone) return null;
  await refreshInstances();
  const target = norm(channelPhone);
  if (!target || target.length < 10) return null;
  const match = instCache.find((i) =>
    i.status === "connected" && norm(i.number) === target
  );
  if (!match) return null;
  return { provider: "uazapi", instance: match.name, token: match.token };
}

export type SendResult = { ok: boolean; status: number; data: unknown; via: "uazapi" | "official" };

// Envia texto via uazapi. Retorna null se falhar (caller faz fallback pro oficial).
export async function hybridSendText(
  route: HybridRoute, to: string, text: string,
): Promise<SendResult | null> {
  try {
    const r = await uazInstPost("/send/text", route.token, { number: to, text });
    if (!r.ok) { console.warn("hybrid text falhou, fallback oficial:", r.status); return null; }
    return { ok: true, status: r.status, data: r.data, via: "uazapi" };
  } catch (e) { console.warn("hybrid text erro, fallback:", String(e).slice(0, 100)); return null; }
}

// Envia mídia via uazapi. Retorna null pra fallback.
export async function hybridSendMedia(
  route: HybridRoute, to: string, mediaUrl: string, mediaType: string,
  opts: { caption?: string; fileName?: string; isVoice?: boolean },
): Promise<SendResult | null> {
  try {
    const body: Json = {
      number: to,
      url: mediaUrl,
      type: mediaType === "document" ? "document" : mediaType,
      text: opts.caption || undefined,
    };
    if (mediaType === "document") body.fileName = opts.fileName ?? "arquivo";
    const endpoint = "/send/media";
    if (opts.isVoice || mediaType === "audio") {
      body.ptt = true;
      body.type = "audio";
      delete body.text;
    }
    const r = await uazInstPost(endpoint, route.token, body);
    if (!r.ok) { console.warn("hybrid media falhou, fallback oficial:", r.status); return null; }
    return { ok: true, status: r.status, data: r.data, via: "uazapi" };
  } catch (e) { console.warn("hybrid media erro, fallback:", String(e).slice(0, 100)); return null; }
}
