// campaign-channel-availability — lista os canais WhatsApp elegíveis para campanha/verificação.
// Portado do hub CECAPE, generalizado (sem coluna native_chatwoot na descoberta).
import { admin } from "./supabase.ts";
import { type CwAcct, envAcct } from "./chatwoot.ts";
import { instGet, listInstances } from "./uazapi.ts";
import { isConnected } from "./campaign-channel-policy.ts";

type Db = ReturnType<typeof admin>;
type Row = Record<string, unknown>;
type Instance = Awaited<ReturnType<typeof listInstances>>[number];

export type EligibleCampaignChannel = {
  id: string;
  name: string;
  phone_number: string | null;
  external_id: string;
};
export type ChannelDiagnostic = { name: string; reason: string };

export class ChannelUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelUnavailable";
  }
}

function toChannel(row: Row): EligibleCampaignChannel {
  return {
    id: String(row.id),
    name: String(row.name),
    phone_number: String(row.phone_number ?? "") || null,
    external_id: String(row.external_id ?? ""),
  };
}

/** Somente canais marcados ativos entram na lista. Conexão transitória não muda o cadastro. */
export async function eligibleCampaignChannels(
  db: Db = admin(),
  acct: CwAcct = envAcct(),
  reconcile = false,
): Promise<
  { channels: EligibleCampaignChannel[]; unavailable: ChannelDiagnostic[] }
> {
  const { data, error } = await db.from("channels").select("*").eq(
    "type",
    "whatsapp",
  );
  if (error) throw error;
  const rows = (data ?? []) as Row[];
  const channels = rows.filter((row) => row.status === "active").map(toChannel);
  const unavailable: ChannelDiagnostic[] = [];
  if (!reconcile) return { channels, unavailable };

  // Descoberta de novas instâncias. Uma falha da Uazapi não retira canais ativos já cadastrados.
  let instances: Instance[];
  try {
    instances = await listInstances();
  } catch {
    return {
      channels,
      unavailable: [{ name: "Uazapi", reason: "descoberta indisponível" }],
    };
  }
  const counts = new Map<string, number>();
  for (const inst of instances) {
    counts.set(inst.name, (counts.get(inst.name) ?? 0) + 1);
  }
  for (const inst of instances) {
    if (
      !inst.name || counts.get(inst.name) !== 1 || !isConnected(inst.status) ||
      rows.some((row) => row.external_id === inst.name)
    ) continue;
    try {
      const config = await instGet("/chatwoot/config", inst.token);
      if (!config.ok || !config.data || typeof config.data !== "object") {
        continue;
      }
      const c = config.data as Row;
      const id = Number(c.chatwoot_inbox_id ?? c.inbox_id);
      const account = Number(c.chatwoot_account_id ?? c.account_id);
      const url = String(c.chatwoot_url ?? c.url ?? "").replace(/\/+$/, "");
      if (
        c.enabled !== true || !Number.isSafeInteger(id) || id < 1 ||
        account !== Number(acct.accountId) ||
        url !== acct.url.replace(/\/+$/, "")
      ) continue;
      if (rows.some((row) => Number(row.chatwoot_inbox_id) === id)) continue;
      const response = await fetch(
        `${acct.url}/api/v1/accounts/${acct.accountId}/inboxes/${id}`,
        {
          headers: { api_access_token: acct.adminToken ?? acct.token },
        },
      );
      if (!response.ok) continue;
      const inbox = await response.json() as Row;
      const identifier = String(
        inbox.inbox_identifier ??
          (inbox.channel as Row | undefined)?.inbox_identifier ?? "",
      );
      if (Number(inbox.id) !== id || !identifier) continue;
      const { data: created, error: insertError } = await db.from("channels")
        .insert({
          type: "whatsapp",
          name: inst.name,
          status: "active",
          external_id: inst.name,
          phone_number: inst.number,
          chatwoot_inbox_id: id,
          chatwoot_inbox_identifier: identifier,
        }).select("*").single();
      if (insertError || !created) {
        unavailable.push({
          name: inst.name,
          reason: "falha ao registrar novo canal",
        });
        continue;
      }
      rows.push(created as Row);
      channels.push(toChannel(created as Row));
    } catch {
      unavailable.push({
        name: inst.name,
        reason: "não foi possível conferir nova inbox",
      });
    }
  }
  return { channels, unavailable };
}

export async function assertEligibleCampaignChannel(
  channelId: string,
  db: Db = admin(),
): Promise<EligibleCampaignChannel> {
  const { channels } = await eligibleCampaignChannels(db);
  const channel = channels.find((item) => item.id === channelId);
  if (!channel) throw new ChannelUnavailable("Canal inexistente ou inativo");
  return channel;
}
