import type { DbClient } from "./supabase.ts";

type Json = Record<string, unknown>;

function digits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function customerIdentityKey(
  channelId: string,
  externalId: string,
  phone?: string | null,
): { key: string; normalizedPhone: string | null } {
  const d = digits(phone || externalId);
  if (/^\d{10,15}$/.test(d)) {
    return { key: `phone:${d}`, normalizedPhone: `+${d}` };
  }
  return { key: `channel:${channelId}:${externalId}`, normalizedPhone: null };
}

/**
 * Telefone brasileiro real: 55 + DDD + 8 ou 9 dígitos = 12 ou 13.
 *
 * A chave de identidade aceita 10 a 15 dígitos, o que é largo demais: PSID do Facebook e
 * LID do WhatsApp são numéricos e caem nessa faixa. Em 07/08 havia 26 "telefones" de 14-15
 * dígitos em `customers` (21 do WhatsApp, 5 do Instagram) que são identificador interno,
 * não número. Esses não podem entrar na prospecção — viram lixo que ninguém consegue ligar.
 */
function isTelefoneReal(digitsOnly: string): boolean {
  return /^\d{12,13}$/.test(digitsOnly);
}

/**
 * Espelha o contato na lista de prospecção (`clientes`), que é o que o painel mostra.
 *
 * Até 07/08 essa tabela só era preenchida por `scripts/import-clientes.ts`, uma importação
 * manual: 9.172 linhas paradas, todas do mesmo número de origem. Quem chegava pelo WhatsApp
 * entrava em `contacts`/`customers` e nunca cruzava para cá — eram 216 leads que
 * conversaram de verdade e não apareciam no painel.
 *
 * `ignoreDuplicates` é essencial: sem ele o upsert sobrescreveria as 9.172 linhas
 * importadas, zerando `enrich_status='done'` e apagando nome e avatar já coletados.
 * Deixa `on_whatsapp` nulo de propósito — é assim que o loop de enriquecimento
 * (shared/enrich.ts) encontra a linha e completa o resto sozinho.
 */
async function espelharNaProspeccao(
  db: DbClient,
  customerId: string,
  normalizedPhone: string,
  name?: string | null,
): Promise<void> {
  const phone = normalizedPhone.replace(/\D/g, "");
  if (!isTelefoneReal(phone)) return;
  // `clientes.phone` é só dígitos; `customers.canonical_phone` vem com "+". Comparar os dois
  // sem normalizar nunca casa — foi por isso que a lista parecia não ter os leads novos.
  const { error } = await db.from("clientes").upsert({
    phone,
    customer_id: customerId,
    lead_name: name || null,
  }, { onConflict: "phone", ignoreDuplicates: true });
  if (error) {
    // Prospecção é espelho, não caminho crítico: falhar aqui não pode derrubar a entrada
    // da mensagem do lead.
    console.error("espelharNaProspeccao:", error.message);
  }
}

export async function ensureCustomer(
  db: DbClient,
  input: {
    channelId: string;
    externalId: string;
    phone?: string | null;
    name?: string | null;
    avatarUrl?: string | null;
    attributes?: Json;
  },
): Promise<string> {
  const identity = customerIdentityKey(
    input.channelId,
    input.externalId,
    input.phone,
  );
  const { data: existing } = await db.from("customers")
    .select("id,display_name,canonical_phone,avatar_url,attributes")
    .eq("identity_key", identity.key).maybeSingle();
  const { data, error } = await db.from("customers").upsert({
    identity_key: identity.key,
    canonical_phone: identity.normalizedPhone || existing?.canonical_phone ||
      null,
    display_name: input.name || existing?.display_name || null,
    avatar_url: input.avatarUrl || existing?.avatar_url || null,
    attributes: {
      ...((existing?.attributes as Json) ?? {}),
      ...(input.attributes ?? {}),
    },
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "identity_key" }).select("id,display_name").single();
  if (error) throw error;

  const customerId = data.id as string;
  if (identity.normalizedPhone) {
    await espelharNaProspeccao(
      db,
      customerId,
      identity.normalizedPhone,
      input.name ?? (existing?.display_name as string | null),
    );
  }
  return customerId;
}

export function customerFromContact(
  contact: Json | null | undefined,
): Json | null {
  return (contact?.customers as Json | undefined) ?? null;
}
