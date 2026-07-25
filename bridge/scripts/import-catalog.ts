// Importa a planilha mestra Campo Soberano (66 produtos) pra product_categories/products.
// Snapshot único (não é fonte viva) — upsert idempotente por sku/slug, seguro rodar de novo.
//
// Fonte: aba "Produtos_66" (dados do produto) + aba "Menu_WhatsApp" (mapeamento categoria->grupo,
// já vem pronto na planilha em nível 2 da árvore do menu — não precisa adivinhar).
//
// Uso:
//   deno run --allow-read --allow-net --env-file=.env import-catalog.ts <planilha.xlsx> --inspect
//   deno run --allow-read --allow-net --env-file=.env import-catalog.ts <planilha.xlsx>
//
// --inspect: mostra contagens e o mapeamento categoria->grupo resolvido, sem gravar nada.
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Row = Record<string, unknown>;

const PRODUTOS_SHEET = "Produtos_66";
const MENU_SHEET = "Menu_WhatsApp";
// As duas primeiras linhas são título/subtítulo mesclado; a 3ª linha é o header real
// (índice 3 em 0-based pro sheet_to_json, que já pula a própria linha de header).
const HEADER_ROW_INDEX = 3;

function slugify(value: string): string {
  return value
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function str(row: Row, key: string): string | undefined {
  const v = row[key];
  if (v === undefined || v === null || v === "") return undefined;
  return String(v).trim();
}

const path = Deno.args[0];
const inspectOnly = Deno.args.includes("--inspect");
if (!path) {
  console.error("uso: import-catalog.ts <planilha.xlsx> [--inspect]");
  Deno.exit(1);
}

const wb = XLSX.read(await Deno.readFile(path), { type: "buffer" });
for (const required of [PRODUTOS_SHEET, MENU_SHEET]) {
  if (!wb.SheetNames.includes(required)) {
    console.error(`aba "${required}" não encontrada. abas disponíveis: ${wb.SheetNames.join(", ")}`);
    Deno.exit(1);
  }
}

const productRows = XLSX.utils.sheet_to_json(wb.Sheets[PRODUTOS_SHEET], {
  defval: "",
  range: HEADER_ROW_INDEX,
}) as Row[];
const menuRows = XLSX.utils.sheet_to_json(wb.Sheets[MENU_SHEET], {
  defval: "",
  range: HEADER_ROW_INDEX,
}) as Row[];

// categoria -> grupo, extraído do nível 2 da árvore de menu (já curado na planilha).
const categoryToGroup = new Map<string, string>();
for (const r of menuRows) {
  if (Number(r["Nível"]) !== 2) continue;
  const categoria = str(r, "Categoria");
  const grupo = str(r, "Grupo principal");
  if (categoria && grupo) categoryToGroup.set(categoria, grupo);
}

console.log(`produtos: ${productRows.length} linhas | grupos mapeados: ${categoryToGroup.size} categorias`);

const missingGroup = new Set<string>();
for (const r of productRows) {
  const categoria = str(r, "Categoria");
  if (categoria && !categoryToGroup.has(categoria)) missingGroup.add(categoria);
}
if (missingGroup.size) {
  console.warn("AVISO: categorias de produto sem grupo na aba Menu_WhatsApp:", [...missingGroup].join(", "));
}

if (inspectOnly) {
  console.log("\ncategoria -> grupo:");
  for (const [cat, grp] of categoryToGroup) console.log(` - ${cat} -> ${grp}`);
  const legacy = productRows.filter((r) => (str(r, "Status no site") ?? "").includes("legada"));
  console.log(`\nprodutos legados (bloqueados): ${legacy.length}`);
  for (const r of legacy) console.log(` - ${str(r, "ID")} ${str(r, "Produto")}`);
  const longNames = productRows.filter((r) => (str(r, "Nome no menu") ?? "").length > 24);
  console.log(`\nnomes de menu >24 char (serão truncados): ${longNames.length}`);
  for (const r of longNames) console.log(` - "${str(r, "Nome no menu")}"`);
  Deno.exit(0);
}

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// 1) categorias
const categoryBySlug = new Map<string, string>(); // slug -> id
const categoryNames = [...new Set(productRows.map((r) => str(r, "Categoria")).filter((v): v is string => !!v))];
for (const [i, name] of categoryNames.entries()) {
  const slug = slugify(name);
  const groupName = categoryToGroup.get(name) ?? "Outros";
  const { data, error } = await db.from("product_categories").upsert({
    slug,
    name,
    group_name: groupName,
    group_slug: slugify(groupName),
    sort_order: i,
  }, { onConflict: "slug" }).select("id").single();
  if (error) {
    console.error("erro categoria", name, error.message);
    continue;
  }
  categoryBySlug.set(slug, data.id as string);
}
console.log(`categorias gravadas: ${categoryBySlug.size}`);

// 2) produtos
let active = 0, blocked = 0, skipped = 0;
for (const [i, row] of productRows.entries()) {
  const sku = str(row, "ID");
  const name = str(row, "Produto");
  const categoryName = str(row, "Categoria");
  if (!sku || !name || !categoryName) {
    console.warn(`linha ${i + HEADER_ROW_INDEX + 2}: faltando ID/Produto/Categoria, pulando`, { sku, name, categoryName });
    skipped++;
    continue;
  }
  const categoryId = categoryBySlug.get(slugify(categoryName));
  if (!categoryId) {
    console.warn(`linha ${i + HEADER_ROW_INDEX + 2}: categoria "${categoryName}" não resolvida, pulando`);
    skipped++;
    continue;
  }

  const siteStatus = str(row, "Status no site") ?? "";
  const isLegacy = siteStatus.includes("legada");
  const status = isLegacy ? "legacy_blocked" : "active";
  if (isLegacy) blocked++; else active++;

  const { error } = await db.from("products").upsert({
    sku,
    name,
    category_id: categoryId,
    short_name: (str(row, "Nome no menu") ?? name).slice(0, 24),
    description: str(row, "Descrição comercial"),
    target_audience: str(row, "Público-alvo"),
    planting_season: str(row, "Época de plantio"),
    region: str(row, "Região/zoneamento"),
    usage_objective: str(row, "Objetivo/uso"),
    differentiators: str(row, "Características e diferenciais"),
    farmer_benefits: str(row, "Vantagens para o produtor"),
    reseller_benefits: str(row, "Vantagens para a revenda/parceiro"),
    pain_point: str(row, "Dor que resolve"),
    sales_angle: str(row, "Ângulo de venda"),
    hook: str(row, "Gancho comercial"),
    cta: str(row, "CTA"),
    keyword: str(row, "Palavra-chave"),
    auto_reply: str(row, "Resposta automática"),
    media_notes: str(row, "Mídias necessárias"),
    source_url: str(row, "Fonte oficial"),
    validation_status: str(row, "Validação") ?? "pending",
    risk_classification: str(row, "Risco"),
    site_status: siteStatus || undefined,
    notes: str(row, "Observações"),
    status,
    sort_order: i,
  }, { onConflict: "sku" });
  if (error) console.error(`linha ${i + HEADER_ROW_INDEX + 2}: erro produto ${sku}`, error.message);
}

console.log(`produtos ativos: ${active} | bloqueados: ${blocked} | pulados: ${skipped}`);
const { count } = await db.from("products").select("id", { count: "exact", head: true });
console.log("TOTAL na tabela products:", count);
