import * as XLSX from "https://esm.sh/xlsx@0.18.5";
const buf = await Deno.readFile(Deno.args[0]);
const wb = XLSX.read(buf, { type: "buffer" });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" }) as Record<string,unknown>[];
const nums = rows.map(r => String(r.numeros||"").replace(/\D/g,"")).filter(d => d.length>=12);
const uniq = new Set(nums);
const badLen = nums.filter(d => d.length<12||d.length>13).length;
console.log("linhas:", rows.length, "| nums válidos:", nums.length, "| únicos:", uniq.size, "| dup internas:", nums.length-uniq.size, "| fora do padrão 12-13díg:", badLen);
