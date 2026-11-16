// flow-goto — execução do nó "Ir para fluxo": carrega o fluxo-alvo publicado e continua nele.
// Portado do hub CECAPE.
//
// Um goto aponta pra um `flow_definitions.id`. Carregamos a VERSÃO publicada (snapshot imutável
// em `flow_versions`, pinada em `current_version`) — não o rascunho — e fixamos a referência em
// `flowId:version`, pra que republicar o alvo no meio da conversa não troque o fluxo do contato
// nem embaralhe os step_id.
//
// GATE: tudo isto só roda com `FLOW_GOTO_ENABLED=true`, que o operador liga DEPOIS de aplicar a
// migration `0018_campaign_flow_state_flow_ref.sql` (a coluna `flow_ref`). Sem o gate, o nó goto
// apenas encerra o fluxo e loga o destino. Assim o deploy do código nunca toca a coluna antes
// dela existir.
import { type DbClient, publicTable } from "./supabase.ts";
import { optionalEnv } from "./env.ts";
import type { Flow } from "./flow.ts";

/** Goto executa? Só quando o operador liga o env (após rodar a migration 0018). */
export function gotoHabilitado(): boolean {
  return optionalEnv("FLOW_GOTO_ENABLED") === "true";
}

/** Limite de saltos encadeados (goto→goto) numa mesma passada. Evita laço entre fluxos. */
export const MAX_GOTO_HOPS = 5;

export type FluxoAlvo = { flow: Flow; ref: string };

/** Separa `flowId:version` → { flowId, version }. Sem versão → só o id. */
export function parseFlowRef(ref: string): { flowId: string; version: number | null } {
  const i = ref.lastIndexOf(":");
  if (i < 0) return { flowId: ref, version: null };
  const v = Number(ref.slice(i + 1));
  return { flowId: ref.slice(0, i), version: Number.isFinite(v) ? v : null };
}

/**
 * Carrega o graph de uma versão publicada do fluxo. `version` ausente → a `current_version` da
 * definição. Devolve o Flow + a referência pinada (`flowId:version`), ou null se o fluxo não
 * existe / não tem versão publicada (nesse caso o chamador encerra e loga).
 */
export async function carregarFluxoPublicado(
  db: DbClient,
  flowId: string,
  version?: number | null,
): Promise<FluxoAlvo | null> {
  try {
    let ver = version ?? null;
    if (ver === null) {
      const { data: def } = await publicTable(db, "flow_definitions")
        .select("current_version").eq("id", flowId).maybeSingle();
      ver = (def?.current_version as number | null) ?? null;
      if (!ver) return null; // sem versão publicada
    }
    const { data: v } = await publicTable(db, "flow_versions")
      .select("graph_json,version").eq("flow_id", flowId).eq("version", ver).maybeSingle();
    if (!v?.graph_json) return null;
    return { flow: v.graph_json as Flow, ref: `${flowId}:${v.version}` };
  } catch (e) {
    console.error("flow-goto: carregar fluxo publicado falhou:", flowId, String(e).slice(0, 160));
    return null;
  }
}
