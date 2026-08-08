import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isDuvidaTecnicaIntent,
  isPlantioIntent,
  isPrecoIntent,
} from "../shared/intent.ts";

// Frases LITERAIS do banco (08/08/2026), colhidas das mensagens de entrada. Todas chegaram
// digitadas, nenhuma casou com detector nenhum, e o funil seguiu para a peça seguinte como
// se nada tivesse sido perguntado.
Deno.test("reconhece a duvida tecnica que o produtor digita", () => {
  for (
    const t of [
      "Qual melhor espaço entre linhas",
      "É melhor plantar ele a lance ou na linha",
      "Quantas sementes por hectare",
      "Meu plantio é irrigado com mangueira de gotejo. No caso de plantio a lanço nao serve",
      "Entao é igual a capim, nao tem espaçamento?",
      "E pra quais animais esse mega sorgo serve??",
      "Aves e peixes então nao??",
      "qual o espaçamento entre linhas",
    ]
  ) {
    if (!isDuvidaTecnicaIntent(t)) throw new Error(`nao reconheceu: ${t}`);
  }
});

// Preço tem precedência: a tabela já é resposta pronta e automática. Uma pergunta que cita
// hectare mas quer saber o valor não pode virar nota privada e ficar esperando humano.
Deno.test("preco vence a duvida tecnica quando os dois aparecem", () => {
  for (
    const t of [
      "quanto custa a semente por hectare",
      "qual o valor pra 2 hectares",
      "preço da semente pra irrigação",
    ]
  ) {
    if (!isPrecoIntent(t)) throw new Error(`deveria ser preco: ${t}`);
    if (isDuvidaTecnicaIntent(t)) {
      throw new Error(`preco vazou pra duvida tecnica: ${t}`);
    }
  }
});

// Conversa fiada não pode pausar o funil e chamar atendente à toa.
Deno.test("conversa comum NAO dispara duvida tecnica", () => {
  for (
    const t of [
      "Bom dia",
      "Tudo bem",
      "Ha ta ok",
      "Quero saber mais",
      "Corte e silagem",
      "2 hectares",
      "Vou plantar na safrinha em fevereiro.",
      "",
    ]
  ) {
    if (isDuvidaTecnicaIntent(t)) throw new Error(`falso positivo: ${t}`);
  }
});

// PLANTIO_RE exige "como plantar"/"plantio"/"manejo"/"adubação". É por isso que as frases
// acima passavam batido: elas falam de plantio sem usar nenhuma dessas palavras. Este teste
// fixa a lacuna que motivou o detector novo — se alguém ampliar PLANTIO_RE um dia, aqui
// quebra e obriga a decidir qual dos dois responde.
Deno.test("as frases reais nao eram cobertas por isPlantioIntent", () => {
  assertEquals(isPlantioIntent("Qual melhor espaço entre linhas"), false);
  assertEquals(isPlantioIntent("Quantas sementes por hectare"), false);
  assertEquals(isPlantioIntent("E pra quais animais esse mega sorgo serve??"), false);
  // contraprova: quando a palavra existe, plantio continua sendo o dono
  assertEquals(isPlantioIntent("como plantar o sorgo"), true);
});
