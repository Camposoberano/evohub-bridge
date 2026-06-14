// Provisiona um usuário de login do dashboard no Supabase (admin/service role).
// Rodar: deno run --allow-net --allow-env --env-file=.env bridge/scripts/create-login.ts <email> <senha>
import { admin } from "../shared/supabase.ts";

const email = Deno.args[0];
const password = Deno.args[1];
if (!email || !password) {
  console.error("uso: ... create-login.ts <email> <senha>");
  Deno.exit(1);
}

const db = admin();
// deno-lint-ignore no-explicit-any
const auth = (db as any).auth.admin;
const { data, error } = await auth.createUser({ email, password, email_confirm: true });
if (error) {
  // se já existe, atualiza a senha
  if (String(error.message || error).toLowerCase().includes("already")) {
    const { data: list } = await auth.listUsers();
    // deno-lint-ignore no-explicit-any
    const u = list?.users?.find((x: any) => x.email === email);
    if (u) {
      await auth.updateUserById(u.id, { password });
      console.log("usuário já existia — senha atualizada:", email);
      Deno.exit(0);
    }
  }
  console.error("erro:", error.message ?? error);
  Deno.exit(1);
}
console.log("usuário criado:", data.user?.email);
