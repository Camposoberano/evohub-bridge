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
import { optionalEnv } from "./env.ts";
import { admin } from "./supabase.ts";
import { configuredChannel, readHybridConfig } from "./hybrid-config.ts";
import {
  buildHybridMenuPayload,
  type HybridMenuButton,
} from "./hybrid-menu.ts";

type Json = Record<string, unknown>;
type UazInstance = {
  name: string;
  number: string | null;
  status: string;
  token: string;
};

export type HybridRoute = {
  provider: "uazapi";
  instance: string;
  token: string;
  channelId: string;
};

// Cache das instâncias uazapi (recarrega a cada 60s).
let instCache: UazInstance[] = [];
let ts = 0;
const TTL_MS = 60_000;

type HybridPolicy = {
  channelAllowlist: Set<string>;
  instanceAllowlist: Set<string>;
};

async function refreshInstances() {
  const now = Date.now();
  if (instCache.length && now - ts <= TTL_MS) return;
  try {
    instCache = await listInstances();
    ts = now;
  } catch (e) {
    console.warn("hybrid: erro listando uazapi:", String(e).slice(0, 100));
  }
}

// Normaliza número pra comparação: só dígitos, sem +/espaço/traço.
function norm(n: string | null | undefined): string {
  return (n ?? "").replace(/\D/g, "");
}

function parseAllowlist(value: string | undefined): Set<string> {
  if (!value?.trim()) return new Set();
  return new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => item.toLowerCase()),
  );
}

function hybridPolicy(): HybridPolicy {
  return {
    channelAllowlist: parseAllowlist(optionalEnv("HYBRID_CHANNEL_ALLOWLIST")),
    instanceAllowlist: parseAllowlist(optionalEnv("HYBRID_INSTANCE_ALLOWLIST")),
  };
}

function channelMatchesAllowlist(
  allowlist: Set<string>,
  channelId: string,
  phoneNumberId?: string,
  channelPhone?: string,
): boolean {
  if (allowlist.size === 0) return true;
  const normalizedPhone = norm(channelPhone);
  const candidates = [
    channelId,
    phoneNumberId,
    channelPhone,
    normalizedPhone,
  ]
    .filter((value): value is string => !!value)
    .map((value) => value.toLowerCase());
  return candidates.some((value) => allowlist.has(value));
}

function instanceMatchesAllowlist(
  allowlist: Set<string>,
  instance: UazInstance,
): boolean {
  if (allowlist.size === 0) return true;
  const candidates = [
    instance.name,
    instance.number ?? "",
    norm(instance.number),
  ]
    .filter(Boolean)
    .map((value) => value.toLowerCase());
  return candidates.some((value) => allowlist.has(value));
}

// Descobre se o canal oficial tem espelho uazapi pelo número.
// channelPhone = phone_number do canal (display_phone_number da Meta, ex: "+55 11 91036-3320")
// Cruza contra os números conectados nas instâncias uazapi.
export async function getHybridRoute(
  channelId: string,
  phoneNumberId?: string,
  channelPhone?: string,
): Promise<HybridRoute | null> {
  if (!uazapiConfigured() || !channelPhone) return null;
  const stored = configuredChannel(await readHybridConfig(), channelId);
  if (stored?.enabled === false) return null;
  const policy = hybridPolicy();
  if (
    !stored &&
    policy.channelAllowlist.size === 0 && policy.instanceAllowlist.size === 0
  ) {
    console.warn(
      "hybrid: rota desativada; configure HYBRID_CHANNEL_ALLOWLIST ou HYBRID_INSTANCE_ALLOWLIST",
    );
    return null;
  }
  if (
    !stored &&
    !channelMatchesAllowlist(
      policy.channelAllowlist,
      channelId,
      phoneNumberId,
      channelPhone,
    )
  ) {
    return null;
  }
  await refreshInstances();
  const target = norm(channelPhone);
  if (!target || target.length < 10) return null;
  const match = instCache.find((i) =>
    i.status === "connected" &&
    norm(i.number) === target &&
    (stored?.instance ? i.name === stored.instance : true) &&
    (stored ? true : instanceMatchesAllowlist(policy.instanceAllowlist, i))
  );
  if (!match) return null;
  return {
    provider: "uazapi",
    instance: match.name,
    token: match.token,
    channelId,
  };
}

export type SendResult = {
  ok: boolean;
  status: number;
  data: unknown;
  via: "uazapi" | "official";
};

// Uazapi trabalha com número telefônico. IDs numéricos da Meta (LID/BSUID) também
// podem ter 10-15 dígitos, mas não são números e não devem sair pela rota híbrida.
// O projeto opera no Brasil, então aceitamos apenas E.164 brasileiro válido.
export function isHybridRecipient(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return /^55\d{10,11}$/.test(digits);
}

// Envia texto via uazapi. Retorna null se falhar (caller faz fallback pro oficial).
export async function hybridSendText(
  route: HybridRoute,
  to: string,
  text: string,
): Promise<SendResult | null> {
  try {
    const r = await uazInstPost("/send/text", route.token, {
      number: to,
      text,
    });
    if (!r.ok) {
      console.warn("hybrid text falhou, fallback oficial:", r.status);
      await recordRouteEvent(route, "fallback_requested", "text", to, r.status);
      return null;
    }
    await recordRouteEvent(route, "send_success", "text", to, r.status);
    return { ok: true, status: r.status, data: r.data, via: "uazapi" };
  } catch (e) {
    console.warn("hybrid text erro, fallback:", String(e).slice(0, 100));
    await recordRouteEvent(route, "fallback_requested", "text", to, 0);
    return null;
  }
}

// Envia mídia via uazapi. Retorna null pra fallback.
export async function hybridSendMedia(
  route: HybridRoute,
  to: string,
  mediaUrl: string,
  mediaType: string,
  opts: { caption?: string; fileName?: string; isVoice?: boolean },
): Promise<SendResult | null> {
  try {
    const body: Json = {
      number: to,
      file: mediaUrl,
      type: mediaType === "document" ? "document" : mediaType,
      text: opts.caption || undefined,
    };
    if (mediaType === "document") body.fileName = opts.fileName ?? "arquivo";
    const endpoint = "/send/media";
    if (opts.isVoice || mediaType === "audio") {
      body.type = "ptt";
      delete body.ptt;
      delete body.text;
    }
    console.log(
      "hybrid-media-req:",
      endpoint,
      JSON.stringify(body).slice(0, 400),
    );
    const r = await uazInstPost(endpoint, route.token, body);
    if (!r.ok) {
      console.warn(
        "hybrid media falhou, fallback oficial:",
        r.status,
        JSON.stringify(r.data).slice(0, 300),
      );
      await recordRouteEvent(
        route,
        "fallback_requested",
        mediaType,
        to,
        r.status,
      );
      return null;
    }
    await recordRouteEvent(route, "send_success", mediaType, to, r.status);
    return { ok: true, status: r.status, data: r.data, via: "uazapi" };
  } catch (e) {
    console.warn("hybrid media erro, fallback:", String(e).slice(0, 100));
    await recordRouteEvent(route, "fallback_requested", mediaType, to, 0);
    return null;
  }
}

// Envia botões nativos pela rota híbrida. A uazapi devolve o título selecionado
// em algumas versões; o webhook normaliza esse título para o id comercial.
export async function hybridSendMenu(
  route: HybridRoute,
  to: string,
  text: string,
  buttons: HybridMenuButton[],
  imageUrl?: string,
): Promise<SendResult | null> {
  try {
    const r = await uazInstPost(
      "/send/menu",
      route.token,
      buildHybridMenuPayload(to, text, buttons, imageUrl),
    );
    if (!r.ok) {
      console.warn(
        "hybrid menu falhou, fallback oficial:",
        r.status,
        JSON.stringify(r.data).slice(0, 300),
      );
      await recordRouteEvent(
        route,
        "fallback_requested",
        "interactive",
        to,
        r.status,
      );
      return null;
    }
    await recordRouteEvent(route, "send_success", "interactive", to, r.status);
    return { ok: true, status: r.status, data: r.data, via: "uazapi" };
  } catch (e) {
    console.warn("hybrid menu erro, fallback:", String(e).slice(0, 100));
    await recordRouteEvent(route, "fallback_requested", "interactive", to, 0);
    return null;
  }
}

async function recordRouteEvent(
  route: HybridRoute,
  eventType: "send_success" | "fallback_requested",
  messageType: string,
  recipient: string,
  status: number,
): Promise<void> {
  try {
    const digits = recipient.replace(/\D/g, "");
    await admin().from("events").insert({
      source: "hybrid",
      event_type: eventType,
      channel_id: route.channelId,
      payload: {
        provider: route.provider,
        instance: route.instance,
        message_type: messageType,
        provider_status: status,
        recipient_suffix: digits.slice(-4),
      },
      occurred_at: new Date().toISOString(),
    });
  } catch (error) {
    console.warn("hybrid event falhou:", String(error).slice(0, 100));
  }
}
