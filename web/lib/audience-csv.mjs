// Parser de CSV de públicos: detecta delimitador, cabeçalho, coluna de nome/telefone e colunas
// extras. Portado do hub CECAPE, generalizado (sem heurísticas de header específicas de faculdade).
export function parseAudienceCsv(text) {
  const source = String(text ?? "").replace(/^﻿/, "");
  if (!source.trim()) return { headers: [], rows: [] };
  if (source.includes("�")) throw new Error("O arquivo contém �; confira a fonte original antes de importar.");
  const rows = [];
  let row = [], cell = "", quoted = false;
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  let commas = 0, semicolons = 0, inHeaderQuote = false;
  for (let i = 0; i < firstLine.length; i++) {
    if (firstLine[i] === '"') {
      if (inHeaderQuote && firstLine[i + 1] === '"') i++;
      else inHeaderQuote = !inHeaderQuote;
    } else if (!inHeaderQuote && firstLine[i] === ",") commas++;
    else if (!inHeaderQuote && firstLine[i] === ";") semicolons++;
  }
  const delimiter = semicolons > commas ? ";" : ",";
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (c === delimiter && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && source[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("CSV com aspas sem fechamento");
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (!rows.length) return { headers: [], rows: [] };
  const first = rows[0].map((v) => v.toLocaleLowerCase("pt-BR"));
  const isPhoneTitle = (v) => {
    const key = String(v).normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[^a-z0-9]/g, "");
    return /^(?:tel|telefone|fone|phone|whats(?:app)?|celular|numerodetelefone)\d*$/.test(key);
  };
  const hasHeader = first.some((v) => /nome|name|contato/.test(v) || isPhoneTitle(v));
  const data = hasHeader ? rows.slice(1) : rows;
  const width = Math.max(...rows.map((r) => r.length));
  const headers = hasHeader ? [...rows[0]] : Array.from({ length: width }, (_, i) => `Coluna ${i + 1}`);
  while (headers.length < width) headers.push(`Coluna ${headers.length + 1}`);
  let phoneIndex = headers.findIndex(isPhoneTitle);
  const titleKey = (v) => String(v).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
  const nameTitles = ["nome", "name", "contato", "nomecontato", "nomecompleto"];
  let nameIndex = -1;
  for (const title of nameTitles) {
    nameIndex = headers.findIndex((v) => titleKey(v) === title);
    if (nameIndex >= 0) break;
  }
  if (phoneIndex < 0) {
    let best = -1;
    for (let i = 0; i < width; i++) {
      const score = data.filter((r) => String(r[i] ?? "").replace(/\D/g, "").length >= 10).length;
      if (score > best) { best = score; phoneIndex = i; }
    }
  }
  if (nameIndex < 0 && width > 1) nameIndex = phoneIndex === 0 ? 1 : 0;
  const extras = headers.map((title, index) => ({ title: title.trim() || `Coluna ${index + 1}`, index }))
    .filter(({ index }) => index !== phoneIndex && index !== nameIndex);
  if (new Set(extras.map((c) => c.title.toLocaleLowerCase("pt-BR"))).size !== extras.length) {
    throw new Error("O CSV tem cabeçalhos repetidos. Renomeie as colunas antes de importar.");
  }
  return {
    nameColumn: nameIndex >= 0 ? headers[nameIndex] : null,
    phoneColumn: phoneIndex >= 0 ? headers[phoneIndex] : null,
    headers: extras.map((c) => c.title),
    rows: data.map((r) => ({
      name: nameIndex >= 0 ? (r[nameIndex] ?? "") : "",
      phone: r[phoneIndex] ?? "",
      attributes: Object.fromEntries(extras.map(({ title, index }) => [title, r[index] ?? ""])),
    })).filter((r) => r.phone),
  };
}

export function decodeAudienceCsv(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le", { fatal: true }).decode(bytes);
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be", { fatal: true }).decode(bytes);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    // Exportações do Excel em português também chegam em Windows-1252.
    // A tentativa UTF-8 é fatal para não gravar nomes com U+FFFD (�).
    if (!(error instanceof TypeError)) throw error;
    return new TextDecoder("windows-1252", { fatal: true }).decode(bytes);
  }
}

export function hasReplacementCharacter(value) {
  return String(value ?? "").includes("�");
}
