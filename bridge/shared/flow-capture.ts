// flow-capture — grava a resposta de uma pergunta aberta (nó `input`) no contato.
// Portado do hub CECAPE.
//
// Por que no contato e não num estado de fluxo volátil: o dado capturado (nome, cidade) é útil
// DEPOIS do fluxo — pro atendente, pro CRM, pra outro fluxo. Guardar em `contacts.attributes`
// (JSONB) deixa durável e reutilizável, e `varsDoContato` lê de volta pra os próximos `{{var}}`
// interpolarem. Mantém `flow.ts`/`flow-runner` puros: quem grava é aqui, chamado pelo flow-inbound
// (que tem banco), igual aos outros efeitos.
import type { DbClient } from "./supabase.ts";
import type { FlowInput } from "./flow.ts";

/** Variáveis cujo valor também vira o `name` do contato (nome do lead). */
const CHAVES_NOME = new Set(["nome", "nome_completo", "name", "primeiro_nome"]);

/** Limpa a resposta conforme o tipo. `numero` → só dígitos (ex.: "nota 620" → "620"). */
export function normalizarValor(valor: string, tipo?: FlowInput["tipo"]): string {
  const v = (valor ?? "").trim();
  if (tipo === "numero") return v.replace(/[^\d]/g, "");
  return v;
}

/**
 * Grava `valor` em `contacts.attributes[input.var]` do contato. Se a variável for de nome e o
 * contato ainda não tem nome (ou tem o número), atualiza também `contacts.name`. Best-effort:
 * falha de captura nunca derruba a conversa — loga e segue (o fluxo continua sem o dado).
 */
export async function capturarVarContato(
  db: DbClient,
  channelId: string,
  contactKey: string,
  input: FlowInput,
  valorBruto: string,
): Promise<void> {
  const valor = normalizarValor(valorBruto, input.tipo);
  if (!valor) return;
  try {
    const { data } = await db.from("contacts")
      .select("id,name,attributes")
      .eq("channel_id", channelId)
      .eq("external_contact_id", contactKey)
      .maybeSingle();
    if (!data?.id) return;
    const attrs = { ...((data.attributes as Record<string, unknown>) ?? {}), [input.var]: valor };
    const patch: Record<string, unknown> = { attributes: attrs };
    // nome do contato: preenche se vazio ou se ainda é o telefone cru
    const nomeAtual = String((data.name as string | undefined) ?? "").trim();
    const soDigitos = /^\+?\d+$/.test(nomeAtual);
    if (input.var === "nome_completo" || (CHAVES_NOME.has(input.var.toLowerCase()) && (nomeAtual === "" || soDigitos))) {
      patch.name = valor;
    }
    await db.from("contacts").update(patch).eq("id", data.id);
  } catch (e) {
    console.error("flow-input: captura falhou (segue sem o dado):", e instanceof Error ? e.message : e);
  }
}
