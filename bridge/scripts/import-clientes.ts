// Importa as 2 listas (xlsx) na tabela clientes, dedup por número, preferência LISTA 1.
// Uso: deno run --allow-read --allow-net --env-file=.env import-clientes.ts <l1.xlsx> <l2.xlsx>
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const L1_NUM = "5519971596836"; // lista 1 (preferência)
const L2_NUM = "5519999715895"; // lista 2

function nums(path: string): Set<string> {
  const wb = XLSX.read(Deno.readFileSync(path), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" }) as Record<string, unknown>[];
  return new Set(rows.map((r) => String(r.numeros ?? Object.values(r)[0] ?? "").replace(/\D/g, "")).filter((d) => d.length >= 12 && d.length <= 13));
}

const l1 = nums(Deno.args[0]);
const l2 = nums(Deno.args[1]);
const all = [...new Set([...l1, ...l2])];

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const rows = all.map((phone) => {
  const in1 = l1.has(phone), in2 = l2.has(phone);
  return { phone, in_list1: in1, in_list2: in2, source_number: in1 ? L1_NUM : L2_NUM, enrich_status: "pending" };
});

let ins = 0;
for (let i = 0; i < rows.length; i += 500) {
  const batch = rows.slice(i, i + 500);
  const { error } = await db.from("clientes").upsert(batch, { onConflict: "phone", ignoreDuplicates: true });
  if (error) { console.log("erro lote", i, error.message); break; }
  ins += batch.length;
  console.log(`importados ${ins}/${rows.length}`);
}
const { count } = await db.from("clientes").select("phone", { count: "exact", head: true });
console.log("TOTAL na tabela:", count);
