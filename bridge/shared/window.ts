// window — estado da janela de mensagem livre da Meta por conversa.
// 24h da última msg do CLIENTE; 72h quando a conversa veio de anúncio CTWA/free entry point
// (conversations.origem = 'anuncio'). Só vale pra canal OFICIAL (phone_number_id) — canais
// não-oficiais (ryzeapi/uazapi) não têm janela.
import type { DbClient } from "./supabase.ts";

type Json = Record<string, unknown>;

export const WINDOW_24H_MS = 24 * 60 * 60 * 1000;
export const WINDOW_72H_MS = 72 * 60 * 60 * 1000;

export type WindowState = {
  aberta: boolean;
  tipo: "24h" | "72h" | "sem-janela";
  expiraEm: number | null; // ms epoch; null = sem entrada (nunca abriu) ou canal sem janela
  restanteMs: number | null;
};

export async function windowState(db: DbClient, conv: Json, channel: Json): Promise<WindowState> {
  if (!channel.phone_number_id) return { aberta: true, tipo: "sem-janela", expiraEm: null, restanteMs: null };

  const { data: lastIn } = await db.from("messages").select("sent_at")
    .eq("conversation_id", conv.id).eq("direction", "in")
    .order("sent_at", { ascending: false }).limit(1).maybeSingle();
  const lastInMs = lastIn?.sent_at ? Date.parse(lastIn.sent_at as string) : NaN;
  const tipo = conv.origem === "anuncio" ? "72h" as const : "24h" as const;
  if (Number.isNaN(lastInMs)) return { aberta: false, tipo, expiraEm: null, restanteMs: null };

  const win = tipo === "72h" ? WINDOW_72H_MS : WINDOW_24H_MS;
  const expiraEm = lastInMs + win;
  const restanteMs = expiraEm - Date.now();
  return { aberta: restanteMs > 0, tipo, expiraEm, restanteMs };
}
