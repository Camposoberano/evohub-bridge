function cell(value, phone = false) {
  let text = String(value ?? "");
  if (phone || /^[=+@\t\r-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

/** CSV UTF-8 com BOM e separador aceito pelo Excel em pt-BR. */
export function exportAudienceCsv(rows, columns) {
  const headers = ["telefone", "nome", ...columns.map((col) => col.title),
    "verificacao_whatsapp", "motivo_verificacao", "verificado_em"];
  const data = rows.map((row) => [
    row.phone, row.name ?? "",
    ...columns.map((col) => row.attributes?.[col.key] ?? row.attributes?.[col.legacy_title] ?? ""),
    row.verification?.status ?? "não verificado",
    row.verification?.reason ?? "",
    row.verification?.checked_at ?? "",
  ]);
  return "\uFEFF" + [headers, ...data].map((row, rowIndex) =>
    row.map((value, index) => cell(value, rowIndex > 0 && index === 0)).join(";")
  ).join("\r\n");
}
