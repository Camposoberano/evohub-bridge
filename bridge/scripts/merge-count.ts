import * as XLSX from "https://esm.sh/xlsx@0.18.5";
async function nums(path: string) {
  const wb = XLSX.read(await Deno.readFile(path), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" }) as Record<string,unknown>[];
  const cols = Object.keys(rows[0]||{});
  const arr = rows.map(r => String(r.numeros ?? r.numero ?? r.telefone ?? Object.values(r)[0] ?? "").replace(/\D/g,"")).filter(d => d.length>=12 && d.length<=13);
  return { cols, set: new Set(arr), n: arr.length };
}
const l1 = await nums(Deno.args[0]);
const l2 = await nums(Deno.args[1]);
console.log("lista2 colunas:", l2.cols.join(" | "));
let overlap = 0; for (const x of l2.set) if (l1.set.has(x)) overlap++;
const total = new Set([...l1.set, ...l2.set]);
console.log("L1 únicos:", l1.set.size, "| L2 únicos:", l2.set.size, "| nos DOIS:", overlap);
console.log("TOTAL único (merge):", total.size, "| só L1:", l1.set.size-overlap, "| só L2:", l2.set.size-overlap, "| ambos(pref L1):", overlap);
