"use client";
import { createClient } from "@supabase/supabase-js";

// Valores públicos (anon key é feita pro browser; URLs são públicas). Fallback embutido
// pra o build do Next funcionar sem precisar de build-args no Coolify. RLS protege os dados.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://bancortovital.soberano.pro";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc4MDc4ODA2MCwiZXhwIjo0OTM2NDYxNjYwLCJyb2xlIjoiYW5vbiJ9.kEp1VTNRbo94J-WMsMtYXJm2qBbrLgq2eB7qCOsVfw8";
const DB_SCHEMA = process.env.NEXT_PUBLIC_SUPABASE_SCHEMA || "evohub";

export const BRIDGE_URL = process.env.NEXT_PUBLIC_BRIDGE_URL || "https://cofre.camposoberano.com.br";
export const HUB_FRONTEND = process.env.NEXT_PUBLIC_HUB_FRONTEND || "https://app.evohub.evolutionfoundation.com.br";
export const CHATWOOT_URL = process.env.NEXT_PUBLIC_CHATWOOT_URL || "https://gerenciador.soberano.pro";
export const CHATWOOT_ACCOUNT_ID = process.env.NEXT_PUBLIC_CHATWOOT_ACCOUNT_ID || "2";

export function chatwootConversationUrl(chatwootConversationId) {
  if (!chatwootConversationId) return null;
  return `${CHATWOOT_URL}/app/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${chatwootConversationId}`;
}

export const supabase = createClient(URL, ANON, {
  db: { schema: DB_SCHEMA },
  auth: { persistSession: true, autoRefreshToken: true },
});
