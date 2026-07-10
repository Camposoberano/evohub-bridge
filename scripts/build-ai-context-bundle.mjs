import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const files = [
  "README.md",
  ".ai-context/PROMPT_CACHE_PREFIX.md",
  ".ai-context/REGRAS_DO_PROJETO.md",
  "docs/projeto-1-multiagentes-contrato.md",
];

const header = [
  "# Prompt Cache Bundle",
  "",
  "Bundle estavel para prefixo reutilizavel de LLM.",
  "Use isto no INICIO do prompt/request e coloque detalhes variaveis somente depois do breakpoint de cache.",
  "Nao inclua segredos neste arquivo.",
  "",
].join("\n");

const chunks = [header];

for (const rel of files) {
  const full = path.join(root, rel);
  try {
    const content = await readFile(full, "utf8");
    chunks.push(`## Arquivo: ${rel}\n`);
    chunks.push(content.trim());
    chunks.push("");
  } catch (error) {
    chunks.push(`## Arquivo ausente: ${rel}\n`);
    chunks.push(`Erro ao ler: ${String(error)}`);
    chunks.push("");
  }
}

const out = path.join(root, ".ai-context", "PROMPT_CACHE_BUNDLE.md");
await writeFile(out, chunks.join("\n"), "utf8");
console.log(`Bundle gerado em ${out}`);
