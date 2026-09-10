// ancoragem-preco — a resposta ao lead que ABRE a conversa perguntando o preço.
//
// Ele veio do anúncio: o Facebook e o Instagram oferecem "Qual é o custo da semente por
// hectare?" como pergunta pronta, e em 03-08/09 isso foi 15 das 35 conversas sociais. A
// pergunta diz "me interessei", não "já quero fechar" — e o produto é semente original, mais
// cara que a concorrência. O número solto, antes de qualquer construção de valor, afasta.
//
// Então a ancoragem responde de verdade (ele não fica no vácuo) sem entregar o valor: diz o
// que justifica o preço e promete o número em seguida. A apresentação do funil segue no seu
// ritmo e é ela que constrói o resto.
//
// O texto NÃO carrega número nem data de validade. Foi decisão explícita depois de dois
// achados: "30% de desconto" não existe (os reais são 5%, 15% e 20%, por volume) e a
// "Promoção SAFRINHA — válida até 10/08/2026" seguiu sendo enviada 120 vezes em 14 dias com
// a validade vencida havia 28 dias. Promessa que o número seguinte desmente destrói a
// confiança exatamente no momento mais frágil.
import { optionalEnv } from "./env.ts";

const PADRAO = [
  "Boa pergunta! 😊 Antes do valor, duas coisas que fazem diferença:",
  "",
  "🌱 *Semente original*, com procedência e laudo — não é semente de saco.",
  "🚚 *Frete grátis* para todo o Brasil, sem mínimo.",
  "💸 E o desconto *cresce com o volume* — chega a 20% no pacote maior.",
  "",
  "Já te mostro os valores certinhos pra sua área. 👇",
].join("\n");

/**
 * Texto da ancoragem. Configurável por env para que a promessa comercial possa mudar sem
 * deploy — é o tipo de conteúdo que muda mais rápido que código.
 */
export function textoDeAncoragem(): string {
  const custom = (optionalEnv("FUNIL_ANCORAGEM_PRECO") ?? "").trim();
  return custom || PADRAO;
}

/**
 * Guarda contra os dois erros que já aconteceram: valor e data.
 *
 * VALOR porque a ancoragem existe justamente para vir antes do número — citar um preço aqui
 * anula o propósito. DATA porque a "Promoção SAFRINHA — válida até 10/08/2026" seguiu saindo
 * 120 vezes em 14 dias com a validade vencida havia 28 dias, e ninguém percebeu.
 *
 * Percentual NÃO entra: "desconto até 20%" é verdade (5%, 15% e 20% por volume) e é o que dá
 * peso à ancoragem. O que quebrou a confiança antes foi o "30%", que não existe — e contra
 * isso o remédio é o texto ser revisado, não uma regex.
 */
export function temValorOuData(texto: string): boolean {
  return /r\$\s*\d|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/i.test(texto);
}
