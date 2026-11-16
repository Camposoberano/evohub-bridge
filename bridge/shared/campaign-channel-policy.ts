// campaign-channel-policy — regras puras de estado/identidade de canal. Portado do hub CECAPE.
export type InstanceState = { status: string; number: string | null };
export type ChannelState = {
  status?: unknown;
  phone_number?: unknown;
  native_chatwoot?: unknown;
  chatwoot_inbox_id?: unknown;
  chatwoot_inbox_identifier?: unknown;
};
export type NativeInboxState = { id: number; identifier: string } | null;

export function isConnected(status: string): boolean {
  return ["connected", "open"].includes(status.trim().toLowerCase());
}

export function channelIdentityProblem(
  row: ChannelState,
  inst: InstanceState,
  native: NativeInboxState,
): string | null {
  if (row.status !== "active") return "canal inativo";
  const local = String(row.phone_number ?? "").replace(/\D/g, "");
  const provider = String(inst.number ?? "").replace(/\D/g, "");
  if (local && provider && local !== provider) return "número divergente";
  const inboxId = Number(row.chatwoot_inbox_id);
  if (
    !Number.isSafeInteger(inboxId) || inboxId < 1 ||
    !row.chatwoot_inbox_identifier
  ) return "inbox não vinculada";
  if (
    row.native_chatwoot === true &&
    (!native || native.id !== inboxId ||
      native.identifier !== row.chatwoot_inbox_identifier)
  ) {
    return "integração Chatwoot divergente";
  }
  return null;
}
