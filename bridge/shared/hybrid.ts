// hybrid — rota híbrida: canal oficial Meta pode ter uma instância uazapi espelho
// pra enviar mensagens de serviço (R$0) em vez da API oficial (R$0,035/msg a partir
// de 01/10/2026). Templates sempre saem pela oficial. Se uazapi falhar (offline,
// bloqueio web), fallback automático pra sendMeta.
//
// Config em soberano-config/hybrid-routes.json:
//   { "<channel_id>": { "provider": "uazapi", "instance": "<nome_instancia>" } }
//
// Suporta extensão futura pra ryzeapi (provider: "ryzeapi").
import { admin } from "./supabase.ts";
import {
  instPost as uazInstPost,
  tokenForInstance as uazTokenForInstance,
  uazapiConfigured,
} from "./uazapi.ts";

const BUCKET = "soberano-config";
const FILE = "hybrid-routes.json";

type Json = Record<string, unknown>;

export type HybridRoute = {
  provider: "uazapi" | "ryzeapi";
  instance: string;
  enabled?: boolean;
};

let cache: Record<string, HybridRoute> | null = null;
let ts = 0;
const TTL_MS = 30_000;

async function dl(): Promise<Record<string, HybridRoute>> {
  try {
    // deno-lint-ignore no-explicit-any
    const { data } = await (admin() as any).storage.from(BUCKET).download(FILE);
    if (data) return JSON.parse(await data.text());
  } catch { /* arquivo ainda não existe = sem rotas */ }
  return {};
}

async function refresh() {
  const now = Date.now();
  if (cache && now - ts <= TTL_MS) return;
  cache = await dl();
  ts = now;
}

// Busca por channel_id OU phone_number_id (chaves flexíveis no JSON).
export async function getHybridRoute(channelId: string, phoneNumberId?: string): Promise<HybridRoute | null> {
  if (!uazapiConfigured()) return null;
  await refresh();
  const r = cache![channelId] ?? (phoneNumberId ? cache![phoneNumberId] : undefined);
  if (!r || r.enabled === false) return null;
  return r;
}

export async function getAllRoutes(): Promise<Record<string, HybridRoute>> {
  await refresh();
  return { ...cache! };
}

export async function setRoute(channelId: string, route: HybridRoute | null): Promise<void> {
  const routes = await dl();
  if (route) routes[channelId] = route;
  else delete routes[channelId];
  const blob = new Blob([JSON.stringify(routes, null, 2)], { type: "application/json" });
  // deno-lint-ignore no-explicit-any
  await (admin() as any).storage.from(BUCKET).upload(FILE, blob, {
    upsert: true, contentType: "application/json",
  });
  cache = routes;
  ts = Date.now();
}

export type SendResult = { ok: boolean; status: number; data: unknown; via: "uazapi" | "official" };

// Envia texto via uazapi. Retorna null se instância offline/não encontrada (caller faz fallback).
export async function hybridSendText(
  route: HybridRoute, to: string, text: string,
): Promise<SendResult | null> {
  if (route.provider !== "uazapi") return null;
  const token = await uazTokenForInstance(route.instance);
  if (!token) return null;
  try {
    const r = await uazInstPost("/send/text", token, { number: to, text });
    if (!r.ok) { console.warn("hybrid text falhou, fallback oficial:", r.status); return null; }
    return { ok: true, status: r.status, data: r.data, via: "uazapi" };
  } catch (e) { console.warn("hybrid text erro, fallback:", String(e).slice(0, 100)); return null; }
}

// Envia mídia via uazapi. Retorna null pra fallback.
export async function hybridSendMedia(
  route: HybridRoute, to: string, mediaUrl: string, mediaType: string,
  opts: { caption?: string; fileName?: string; isVoice?: boolean },
): Promise<SendResult | null> {
  if (route.provider !== "uazapi") return null;
  const token = await uazTokenForInstance(route.instance);
  if (!token) return null;
  try {
    const body: Json = {
      number: to,
      file: mediaUrl,
      text: opts.caption || undefined,
    };
    if (mediaType === "document") body.docName = opts.fileName ?? "arquivo";
    // uazapi /send/file detecta tipo automaticamente pela URL/content-type.
    // Para voz (PTT), usamos /send/audio com ptt=true.
    let endpoint = "/send/file";
    if (opts.isVoice || mediaType === "audio") {
      endpoint = "/send/audio";
      body.ptt = true;
      body.file = mediaUrl;
      delete body.text;
    }
    const r = await uazInstPost(endpoint, token, body);
    if (!r.ok) { console.warn("hybrid media falhou, fallback oficial:", r.status); return null; }
    return { ok: true, status: r.status, data: r.data, via: "uazapi" };
  } catch (e) { console.warn("hybrid media erro, fallback:", String(e).slice(0, 100)); return null; }
}
