// Registro de iscas digitais (lead magnets). No fim do funil o cliente vê uma OFERTA — imagem
// (capa do material) + pergunta + botões Sim/Não. Só ao tocar "Sim" o PDF é enviado (nunca
// antes). "Não" recebe um ack curto. Quem pede ganha uma etiqueta de interesse. O funil segue.
//
// Adicionar uma isca nova = +1 objeto aqui + subir a capa (capaSlot) e o PDF (slot) no
// funnel_media (funnel "mega-sorgo", day 0, active=true). Nada de código novo. Uma tabela
// dedicada seria mais "dados", mas DDL neste Supabase self-host está bloqueado (sem
// SUPABASE_DB_URL) — por isso o registro mora no código.
//
// ⚠️ botaoSim e botaoNao PRECISAM começar com "menu_": os dois webhooks (hub e uazapi) só
// roteiam cliques com esse prefixo para handleMenuClick. Fora disso o clique é ignorado.

export type Isca = {
  id: string; // id curto, ex "silagem"
  botaoSim: string; // id do botão "quero" (começa com "menu_")
  tituloSim: string; // rótulo do botão Sim (WhatsApp corta em 20 chars)
  botaoNao: string; // id do botão "agora não" (começa com "menu_")
  tituloNao: string; // rótulo do botão Não
  pergunta: string; // texto da oferta
  capaSlot: string; // slot em funnel_media (day 0) com a IMAGEM de capa da oferta
  slot: string; // slot em funnel_media (day 0) com o PDF entregue no "Sim"
  filename: string; // nome do arquivo entregue no WhatsApp
  legenda: string; // caption do documento
  etiqueta: string; // label aplicada na conversa ao entregar
  recusaMsg: string; // resposta curta ao "Agora não"
};

export const ISCAS: Isca[] = [
  {
    id: "silagem",
    botaoSim: "menu_isca_silagem",
    // título ÚNICO: no uazapi a resposta de botão volta como o título e é mapeada de volta
    // pro id em hybrid-menu.ts. "Sim, quero" colidiria com o botão de abertura da fase 5.
    tituloSim: "Quero o material 📩",
    botaoNao: "menu_isca_nao_silagem",
    tituloNao: "Agora não",
    pergunta:
      "🌾 O senhor tem interesse em receber, *de graça*, um material da *Embrapa* com o passo a passo pra fazer uma *silagem de qualidade*? 📚",
    capaSlot: "isca_silagem_capa",
    slot: "isca_silagem",
    filename: "Silagem-de-Sorgo-Embrapa.pdf",
    legenda:
      "📚 *Material gratuito* — Silagem de Sorgo, desenvolvido pela Embrapa.\n\nBom proveito e boa safra! 🌱",
    etiqueta: "interesse-silagem",
    recusaMsg:
      "Tranquilo! 👍 Se mudar de ideia é só me chamar que eu envio o material na hora.",
  },
];

export type IscaMatch = { isca: Isca; acao: "sim" | "nao" };

export function matchIsca(botao: string): IscaMatch | undefined {
  for (const i of ISCAS) {
    if (i.botaoSim === botao) return { isca: i, acao: "sim" };
    if (i.botaoNao === botao) return { isca: i, acao: "nao" };
  }
  return undefined;
}

export function iscasAtivas(): Isca[] {
  return ISCAS;
}
