import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classificarIntencaoComercial,
  extrairAreaHectares,
  isAreaAcimaDosPacotes,
  pacotePorId,
  pacotePorResposta,
  PACOTES_COMERCIAIS,
  textoCondicaoComercial,
  textoPacote,
  textoPerguntaUso,
  usoPorResposta,
} from "../shared/funil-comercial.ts";

Deno.test("preço tem precedência sobre intenção técnica ou de uso", () => {
  assertEquals(
    classificarIntencaoComercial("Quanto custa para silagem?"),
    "preco",
  );
  assertEquals(
    classificarIntencaoComercial("Tenho interesse em pastejo"),
    "uso",
  );
  assertEquals(
    classificarIntencaoComercial("Qual o espaçamento?"),
    "duvida_tecnica",
  );
  assertEquals(
    classificarIntencaoComercial("Quero conhecer melhor"),
    "interesse_geral",
  );
  assertEquals(classificarIntencaoComercial("Bom dia"), null);
});

Deno.test("pacotes seguem a correspondência aprovada e sem preço automático", () => {
  assertEquals(PACOTES_COMERCIAIS, [
    { id: "tam_4kg", area: 1, quilos: 4, titulo: "1 hectare" },
    { id: "tam_10kg", area: 2, quilos: 10, titulo: "2 hectares" },
    { id: "tam_20kg", area: 4, quilos: 20, titulo: "4 hectares" },
  ]);
  assertEquals(pacotePorId("tam_10kg")?.quilos, 10);
  assertEquals(pacotePorResposta("2 hectares 10 kg")?.id, "tam_10kg");
  assertEquals(pacotePorResposta("meio hectare")?.quilos, 2);
  const copy = textoPacote(pacotePorId("tam_4kg")!);
  assertEquals(copy.includes("R$"), false);
  assertEquals(copy.includes("30%"), false);
  assertEquals(copy.includes("desconto"), false);
  assertEquals(copy.includes("Cícero confirma a cotação exata"), true);
  assertEquals(textoCondicaoComercial().includes("acima de 100 kg"), false);
});

Deno.test("pergunta e reconhecimento de uso são neutros", () => {
  assertEquals(textoPerguntaUso().includes("milho"), false);
  assertEquals(usoPorResposta("uso_pastejo"), "pastejo");
  assertEquals(usoPorResposta("quero para silagem"), "silagem");
  assertEquals(usoPorResposta("produção de leite"), null);
});

Deno.test("área acima de quatro hectares aceita texto livre", () => {
  assertEquals(extrairAreaHectares("5 hectares"), 5);
  assertEquals(extrairAreaHectares("6,5 ha"), 6.5);
  assertEquals(isAreaAcimaDosPacotes("4 hectares"), false);
  assertEquals(isAreaAcimaDosPacotes("5 ha"), true);
  assertEquals(isAreaAcimaDosPacotes("2 hectares"), false);
});
