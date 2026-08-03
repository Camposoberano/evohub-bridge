import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { RECOVERY_ACTIONS } from "../shared/recovery-content.ts";
import {
  RECOVERY_TEMPLATE_LANG,
  templateFor,
} from "../shared/recovery-template.ts";

const WABA_5895 = "743886211614541";
const WABA_6836 = "100191609666845";

// Se uma variação ficar sem template, a recuperação falha justamente nas conversas fora
// da janela — que são a maioria (255 de 400 em 03/08).
Deno.test("toda variacao tem template nas duas WABAs oficiais", () => {
  assertEquals(RECOVERY_ACTIONS.length, 4);
  for (const waba of [WABA_5895, WABA_6836]) {
    for (let v = 1; v <= 4; v++) {
      if (!templateFor(waba, v)) {
        throw new Error(`waba ${waba} variação ${v} sem template`);
      }
    }
  }
});

// O erro de 03/08: templates foram criados numa WABA e o envio saiu por outra, gerando
// "(#132001) Template name does not exist in the translation". O mapa é POR WABA.
Deno.test("template e resolvido por WABA, nao global", () => {
  assertEquals(templateFor(WABA_5895, 1), "bem_vindo");
  assertEquals(templateFor(WABA_6836, 1), "boa_noite");
  assertEquals(templateFor("108121798773503", 1), null); // WABA de outra conta
  assertEquals(templateFor(null, 1), null);
  assertEquals(templateFor(undefined, 1), null);
});

Deno.test("variacao fora do intervalo nao inventa template", () => {
  assertEquals(templateFor(WABA_5895, 0), null);
  assertEquals(templateFor(WABA_5895, 5), null);
});

Deno.test("nomes seguem o formato aceito pela Meta", () => {
  for (const waba of [WABA_5895, WABA_6836]) {
    for (let v = 1; v <= 4; v++) {
      const name = templateFor(waba, v)!;
      if (!/^[a-z0-9_]+$/.test(name)) {
        throw new Error(`nome invalido para template Meta: ${name}`);
      }
    }
  }
  assertEquals(RECOVERY_TEMPLATE_LANG, "pt_BR");
});
