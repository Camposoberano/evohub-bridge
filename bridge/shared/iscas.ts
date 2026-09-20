// Registro de iscas digitais (lead magnets). Cada isca: o cliente clica no botão do fim do
// funil -> recebe um PDF (do funnel_media) e ganha uma etiqueta de interesse. O funil SEGUE.
//
// Adicionar uma isca nova = +1 objeto aqui + subir o PDF no slot indicado (funnel_media,
// funnel "mega-sorgo", active=true). Nada de código novo. Uma tabela dedicada seria mais
// "dados", mas DDL neste Supabase self-host está bloqueado (sem SUPABASE_DB_URL, migration
// 0013 parada) — por isso o registro mora no código.
//
// ⚠️ `botao` PRECISA começar com "menu_": os dois webhooks (hub-webhook e uazapi-webhook)
// só roteiam cliques com esse prefixo para handleMenuClick. Fora disso o clique é ignorado.

export type Isca = {
  id: string; // id curto, ex "silagem"
  botao: string; // id do botão/linha na lista de fechamento (começa com "menu_")
  titulo: string; // rótulo do botão (WhatsApp corta título de linha em 24 chars)
  slot: string; // slot em funnel_media (funnel mega-sorgo) que guarda o PDF
  filename: string; // nome do arquivo entregue no WhatsApp
  legenda: string; // caption do documento
  etiqueta: string; // label aplicada na conversa ao entregar
};

export const ISCAS: Isca[] = [
  {
    id: "silagem",
    botao: "menu_isca_silagem",
    titulo: "📚 Material grátis",
    slot: "isca_silagem",
    filename: "Silagem-de-Sorgo-Embrapa.pdf",
    legenda:
      "📚 *Material gratuito* — Silagem de Sorgo, desenvolvido pela Embrapa.\n\nBom proveito e boa safra! 🌱",
    etiqueta: "interesse-silagem",
  },
];

export function iscaPorBotao(botao: string): Isca | undefined {
  return ISCAS.find((i) => i.botao === botao);
}

export function iscasAtivas(): Isca[] {
  return ISCAS;
}
