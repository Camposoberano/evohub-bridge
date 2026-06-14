// Mostra, por instância uazapi, a config de Chatwoot (url/account/inbox/enabled).
// Pra entender qual instância pertence a qual Chatwoot.
import { listInstances, instGet } from "../shared/uazapi.ts";

const insts = await listInstances();
for (const i of insts) {
  let cw = "—";
  try {
    const r = await instGet("/chatwoot/config", i.token);
    const d = (r.data || {}) as Record<string, unknown>;
    cw = `enabled=${d.enabled} url=${d.url ?? "-"} account=${d.account_id ?? "-"} inbox=${d.inbox_id ?? "-"}`;
  } catch (e) { cw = "ERR " + String(e).slice(0, 40); }
  console.log(`${i.name} | ${i.number} | ${i.status}\n   chatwoot: ${cw}`);
}
