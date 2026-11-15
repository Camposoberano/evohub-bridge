// audience-columns — esquema de colunas nomeadas de um Público (chave estável + auditoria).
// Portado do hub CECAPE. Puro, sem acoplamento.
export type AudienceColumn = {
  id: string;
  title: string;
  key: string;
  ordinal: number;
  legacy_title?: string | null;
  active?: boolean;
};

const RESERVED = new Set(["nome", "telefone", "primeiro_nome"]);

export function hasCorruptedAudienceText(name: unknown, attributes: Record<string, string>): boolean {
  return String(name ?? "").includes("�") ||
    Object.entries(attributes).some(([key, value]) => key.includes("�") || value.includes("�"));
}

export function columnKey(title: string, existing: AudienceColumn[] = []): string {
  const base = String(title ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "campo";
  const root = RESERVED.has(base) || /^coluna_\d+$/.test(base) ? `campo_${base}` : base;
  const used = new Set(existing.map((c) => c.key.toLowerCase()));
  let key = root;
  for (let i = 2; used.has(key); i++) key = `${root}_${i}`;
  return key;
}

export function makeAudienceColumn(title: string, existing: AudienceColumn[], id: string = crypto.randomUUID()): AudienceColumn {
  const clean = String(title ?? "").trim();
  if (!clean || clean.includes("�") || clean.length > 100) throw new Error("título de coluna inválido");
  if (existing.some((c) => c.title.toLocaleLowerCase("pt-BR") === clean.toLocaleLowerCase("pt-BR"))) {
    throw new Error("já existe uma coluna com esse título");
  }
  return { id, title: clean, key: columnKey(clean, existing), ordinal: Math.max(0, ...existing.map((c) => c.ordinal)) + 1, legacy_title: null, active: true };
}

export function validAudienceColumns(value: unknown): value is AudienceColumn[] {
  if (!Array.isArray(value)) return false;
  const keys = new Set<string>(), ids = new Set<string>(), ordinals = new Set<number>();
  for (const c of value) {
    if (!c || typeof c !== "object" || typeof c.id !== "string" || typeof c.title !== "string" ||
      typeof c.key !== "string" || !/^[a-z][a-z0-9_]*$/.test(c.key) ||
      !Number.isSafeInteger(c.ordinal) || c.ordinal < 1 || !c.title.trim() ||
      keys.has(c.key) || ids.has(c.id) || ordinals.has(c.ordinal)) return false;
    keys.add(c.key); ids.add(c.id); ordinals.add(c.ordinal);
  }
  return true;
}
