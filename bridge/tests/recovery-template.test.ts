import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { RECOVERY_ACTIONS } from "../shared/recovery-content.ts";
import {
  RECOVERY_TEMPLATE_LANG,
  RECOVERY_TEMPLATES,
} from "../shared/recovery-template.ts";

// Se uma variação ficar sem template, a recuperação falha justamente nas conversas fora
// da janela — que são a maioria (255 de 400 em 03/08). Este teste trava isso.
Deno.test("toda variacao de recuperacao tem template mapeado", () => {
  assertEquals(RECOVERY_ACTIONS.length, 4);
  for (let variation = 1; variation <= RECOVERY_ACTIONS.length; variation++) {
    const template = RECOVERY_TEMPLATES[variation];
    if (!template) {
      throw new Error(`recuperação ${variation} sem template`);
    }
  }
});

// Nomes precisam bater com os aprovados no WhatsApp Business — errar aqui só aparece
// em produção, como erro 132001 da Meta.
Deno.test("nomes dos templates sao os aprovados", () => {
  assertEquals(RECOVERY_TEMPLATES[1], "boa_vindas");
  assertEquals(RECOVERY_TEMPLATES[2], "retomada_conversa");
  assertEquals(RECOVERY_TEMPLATES[3], "convite_videos");
  assertEquals(RECOVERY_TEMPLATES[4], "tirar_duvida");
  assertEquals(RECOVERY_TEMPLATE_LANG, "pt_BR");
});

Deno.test("nomes seguem o formato aceito pela Meta (minusculo, sem espaco)", () => {
  for (const name of Object.values(RECOVERY_TEMPLATES)) {
    if (!/^[a-z0-9_]+$/.test(name)) {
      throw new Error(`nome invalido para template Meta: ${name}`);
    }
  }
});
