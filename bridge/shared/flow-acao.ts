// flow-acao — executa o nó "Ação contato": mexe em etiquetas e nome SEM mandar mensagem;
// e os efeitos do nó Transferir (atribuir time + nota-resumo pro consultor). Portado do hub
// CECAPE e generalizado (taxonomia/rótulos genéricos, sem termos de matrícula).
//
// O runner é puro; esta é a parte impura (banco + Chatwoot), injetada como efeito. Best-effort:
// nunca lança — uma etiqueta que não aplicou não pode travar a conversa do lead.
//
//  - Nome  → `contacts.name` no banco (mesma chave canal+telefone de varsDoContato).
//  - Etiquetas → lista da CONVERSA no Chatwoot. O Chatwoot só troca a lista inteira, então é
//    get + (união com add) − (remove) + set. Precisa do `chatwoot_conversation_id`.
import type { DbClient } from "./supabase.ts";
import { assignConversationTeam, createConversationMessage, getConversationLabels, setConversationLabels } from "./chatwoot.ts";
import { type FlowAction, interpolate } from "./flow.ts";
import { classificarComJev } from "./jev.ts";
import { optionalEnv } from "./env.ts";

type Json = Record<string, unknown>;

function soDigitos(n: string): string {
  return String(n).replace(/\D/g, "");
}

/** chatwoot_conversation_id para aplicar etiqueta: pela conversa do estado ou a mais recente. */
async function chatwootConvId(
  db: DbClient,
  channel: Json,
  to: string,
  conversationId?: string | null,
): Promise<number | null> {
  try {
    if (conversationId) {
      const { data } = await db.from("conversations")
        .select("chatwoot_conversation_id").eq("id", conversationId).maybeSingle();
      const cw = data?.chatwoot_conversation_id;
      if (cw) return Number(cw);
    }
    const { data: c } = await db.from("contacts")
      .select("id").eq("channel_id", channel.id).eq("external_contact_id", soDigitos(to))
      .maybeSingle();
    if (c?.id) {
      const { data: conv } = await db.from("conversations")
        .select("chatwoot_conversation_id")
        .eq("contact_id", c.id)
        .order("updated_at", { ascending: false })
        .limit(1).maybeSingle();
      if (conv?.chatwoot_conversation_id) return Number(conv.chatwoot_conversation_id);
    }
  } catch (e) {
    console.warn("flow-action: resolução de conversa falhou:", String(e).slice(0, 160));
  }
  return null;
}

/**
 * Transferir humano COM time: encaminha a conversa pro time do Chatwoot (ex.: Comercial). Resolve
 * a conversa do Chatwoot pela mesma regra das etiquetas; sem conversa aberta, loga e pula (o nó
 * Transferir ainda silencia o bot via etiqueta). Best-effort — nunca derruba a conversa.
 */
export async function atribuirTimeConversa(
  db: DbClient,
  channel: Json,
  to: string,
  conversationId: string | null | undefined,
  teamId: number,
): Promise<void> {
  const cwId = await chatwootConvId(db, channel, to, conversationId);
  if (!cwId) {
    console.warn("flow-transfer: sem conversa no Chatwoot, time não atribuído", to.slice(-4));
    return;
  }
  const ok = await assignConversationTeam(cwId, teamId);
  console.log("flow-transfer:", to.slice(-4), `time ${teamId} ->`, ok ? "atribuído" : "falhou");
}

// Rótulos amigáveis pras variáveis mais comuns; o resto vira "chave_com_underscore" →
// "Chave com underscore". Só pra deixar a nota legível pro consultor.
const ROTULOS: Record<string, string> = {
  nome: "Nome",
  nome_completo: "Nome",
  primeiro_nome: "Nome",
  telefone: "Telefone",
  cidade: "Cidade",
  email: "E-mail",
  interesse: "Interesse",
};

function rotular(chave: string): string {
  if (ROTULOS[chave]) return ROTULOS[chave];
  const s = chave.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// contacts.attributes é poluído pelo sync de perfil (avatar, channel_id, source_id, …). Quando o
// resumo NÃO sabe quais campos o fluxo capturou (sem allowlist), este filtro corta o lixo pra nota
// não virar um dump. O caminho feliz usa o allowlist do fluxo (varsDeInput) e nem chega aqui.
function chaveDeSistema(k: string): boolean {
  if (/(_id|_url|_at)$/i.test(k)) return true;
  return /(avatar|channel|platform|source|whatsapp|profile|availab|lead_)/i.test(k);
}

// Só etiquetas da TAXONOMIA do funil entram no resumo. Controle do sistema (bot-off,
// janela-aberta, canal-nao-oficial) não interessa ao consultor. Separador ":" ou "-"
// (o Chatwoot pode normalizar). Prefixos genéricos de funil — ajuste conforme a taxonomia real.
const TAXONOMIA = ["etapa", "origem", "interesse"];
const TAX_ROTULO: Record<string, string> = { etapa: "Etapa", origem: "Origem", interesse: "Interesse" };

function linhasDeTaxonomia(labels: string[]): string[] {
  const grupos: Record<string, string[]> = {};
  for (const l of labels) {
    const m = /^([a-z]+)[:\-](.+)$/i.exec(l.trim());
    if (!m) continue;
    const pref = m[1].toLowerCase();
    if (!TAXONOMIA.includes(pref)) continue;
    (grupos[pref] ??= []).push(m[2].trim());
  }
  return TAXONOMIA
    .filter((p) => grupos[p]?.length)
    .map((p) => `• ${TAX_ROTULO[p]}: ${[...new Set(grupos[p])].join(", ")}`);
}

/**
 * Linhas "• Campo: valor" do resumo. `campos` (as variáveis capturadas pelo fluxo) é o allowlist:
 * só o que o fluxo perguntou entra, na ordem do fluxo. Sem `campos`, cai no filtro de lixo. Nome e
 * telefone sempre primeiro; etiquetas da taxonomia do funil por último.
 */
function montarLinhasResumo(
  to: string,
  vars: Record<string, string>,
  labels: string[],
  campos?: string[],
): string[] {
  const linhas: string[] = [];
  // Prefere o nome DIGITADO no fluxo (nome_completo) ao nome do PERFIL do WhatsApp (vars.nome). O
  // perfil costuma vir errado/apelido — o que o lead digitou é o que vale pro consultor.
  const nome = (vars.nome_completo || vars.nome || "").trim();
  if (nome) linhas.push(`• ${rotular("nome")}: ${nome}`);
  const tel = (vars.telefone || soDigitos(to)).trim();
  if (tel) linhas.push(`• ${rotular("telefone")}: ${tel}`);

  const jaMostrado = new Set(["nome", "nome_completo", "primeiro_nome", "telefone"]);
  if (campos?.length) {
    // Allowlist do fluxo: só os campos que os nós `input` capturaram, na ordem do fluxo.
    for (const k of campos) {
      if (jaMostrado.has(k)) continue;
      const val = String(vars[k] ?? "").trim();
      if (val) linhas.push(`• ${rotular(k)}: ${val}`);
    }
  } else {
    // Fallback (sem o fluxo em mãos): mostra as variáveis que não são lixo de sistema.
    for (const [k, v] of Object.entries(vars)) {
      if (jaMostrado.has(k) || chaveDeSistema(k)) continue;
      const val = String(v ?? "").trim();
      if (val) linhas.push(`• ${rotular(k)}: ${val}`);
    }
  }
  linhas.push(...linhasDeTaxonomia(labels));
  return linhas;
}

async function labelsDaConversa(cwId: number): Promise<string[]> {
  try {
    return await getConversationLabels(cwId);
  } catch {
    return []; // etiquetas são opcionais no resumo
  }
}

/**
 * Posta o RESUMO do lead como NOTA PRIVADA no Chatwoot (só o time vê) na transferência pro humano.
 * `resumo===true` → monta sozinho com as variáveis capturadas no fluxo + as etiquetas do funil;
 * string → usa como modelo e interpola os `{{var}}`. Best-effort: nunca derruba a conversa. Dá ao
 * consultor os dados coletados já na mão, sem ter que perguntar de novo.
 */
export async function postarResumoConsultor(
  db: DbClient,
  channel: Json,
  to: string,
  conversationId: string | null | undefined,
  resumo: boolean | string,
  vars: Record<string, string> = {},
  campos?: string[],
): Promise<void> {
  const cwId = await chatwootConvId(db, channel, to, conversationId);
  if (!cwId) {
    console.warn("flow-resumo: sem conversa no Chatwoot, resumo não postado", to.slice(-4));
    return;
  }

  let content: string;
  if (typeof resumo === "string" && resumo.trim()) {
    content = interpolate(resumo, vars).trim();
  } else {
    // Modo automático: lista o que foi capturado + etiquetas do funil.
    const linhas = montarLinhasResumo(to, vars, await labelsDaConversa(cwId), campos);
    content = `📋 *Resumo do lead* (coletado no atendimento automático)\n${linhas.join("\n")}`;
  }
  if (!content.trim()) return;

  await postarNota(cwId, content, to);
}

async function postarNota(cwId: number, content: string, to: string): Promise<void> {
  try {
    await createConversationMessage(cwId, {
      content,
      messageType: "outgoing",
      private: true, // nota privada: só o time vê, não vai pro lead
    });
    console.log("flow-resumo:", to.slice(-4), `nota postada na conversa ${cwId}`);
  } catch (e) {
    console.warn("flow-resumo: falha ao postar nota:", String(e).slice(0, 160));
  }
}

// Temperatura comercial do lead — o Jev classifica lendo o perfil inteiro. Critérios genéricos
// (Jev é julgamento; o código monta a frase da nota). Ajuste as descrições ao seu funil se quiser.
const TEMPERATURA_OPCOES = [
  { id: "quente", titulo: "Quente", descricao: "Lead pronto pra fechar: demonstra intenção clara de compra, deu os dados necessários e quer avançar agora." },
  { id: "morno", titulo: "Morno", descricao: "Lead interessado mas com pendência: falta algum dado, está comparando ou indeciso, sem urgência." },
  { id: "frio", titulo: "Frio", descricao: "Lead sem dados suficientes ou só pesquisando: respostas vagas, sem sinal de compra próxima." },
];
const TEMPERATURA_ROTULO: Record<string, string> = { quente: "🔥 QUENTE", morno: "🌤️ MORNO", frio: "❄️ FRIO" };

/**
 * Resumo QUALIFICADO: o Jev lê os dados capturados + etiquetas e classifica a temperatura do lead;
 * a nota do consultor ganha esse cabeçalho além dos dados. Sem chave / baixa confiança → posta o
 * resumo simples (nunca deixa de entregar os dados). Best-effort.
 */
export async function postarResumoQualificado(
  db: DbClient,
  channel: Json,
  to: string,
  conversationId: string | null | undefined,
  vars: Record<string, string> = {},
  campos?: string[],
): Promise<void> {
  const cwId = await chatwootConvId(db, channel, to, conversationId);
  if (!cwId) {
    console.warn("flow-qualifica: sem conversa no Chatwoot, nota não postada", to.slice(-4));
    return;
  }
  const labels = await labelsDaConversa(cwId);
  const linhas = montarLinhasResumo(to, vars, labels, campos);
  const dados = linhas.join("\n");

  // Jev lê o MESMO resumo que o consultor veria e decide a temperatura. Estado = dados + etiquetas.
  const estado = dados || "(sem dados capturados)";
  const min = Number(optionalEnv("FLOW_QUALIFY_JEV_MIN") ?? "0.5");
  const { choice, confidence } = await classificarComJev(estado, {
    instrucao: "Classifique a temperatura comercial deste lead, com base nos dados coletados no atendimento.",
    opcoes: TEMPERATURA_OPCOES,
    minConfianca: min,
    // A nota privada deve sair mesmo se o provedor de IA demorar ou não responder.
    timeoutMs: 8_000,
  });

  let cabecalho: string;
  if (choice && confidence >= min && TEMPERATURA_ROTULO[choice]) {
    cabecalho = `🤖 Qualificação (Jev): ${TEMPERATURA_ROTULO[choice]}  ·  confiança ${(confidence * 100).toFixed(0)}%`;
  } else {
    // Sem chave, erro, ou confiança baixa: não inventa temperatura — entrega os dados mesmo assim.
    cabecalho = "📋 *Resumo do lead* (coletado no atendimento automático)";
  }
  console.log("flow-qualifica:", to.slice(-4), `temperatura=${choice ?? "—"}(${confidence.toFixed(2)})`);
  await postarNota(cwId, `${cabecalho}\n${dados}`, to);
}

export async function aplicarAcaoContato(
  db: DbClient,
  channel: Json,
  to: string,
  conversationId: string | null | undefined,
  acao: FlowAction,
  vars: Record<string, string> = {},
): Promise<void> {
  // Nome
  if (acao.setNome?.trim()) {
    const nome = interpolate(acao.setNome, vars).trim();
    if (nome) {
      try {
        const { error } = await db.from("contacts")
          .update({ name: nome })
          .eq("channel_id", channel.id)
          .eq("external_contact_id", soDigitos(to));
        if (error) throw error;
      } catch (e) {
        console.warn("flow-action: setNome falhou:", String(e).slice(0, 160));
      }
    }
  }

  // Etiquetas
  const add = (acao.addLabels ?? []).map((s) => s.trim()).filter(Boolean);
  const rem = new Set(
    (acao.removeLabels ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
  if (!add.length && !rem.size) return;

  const cwId = await chatwootConvId(db, channel, to, conversationId);
  if (!cwId) {
    console.warn("flow-action: sem conversa no Chatwoot, etiquetas puladas", to.slice(-4));
    return;
  }
  try {
    const atuais = await getConversationLabels(cwId);
    const final = [...new Set([...atuais, ...add])]
      .filter((l) => !rem.has(l.toLowerCase()));
    await setConversationLabels(cwId, final);
  } catch (e) {
    console.warn("flow-action: etiquetas falharam:", String(e).slice(0, 160));
  }
}
