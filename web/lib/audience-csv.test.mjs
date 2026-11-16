import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeAudienceCsv, hasReplacementCharacter, parseAudienceCsv } from "./audience-csv.mjs";

test("preserva colunas livres, acentos, virgula em aspas e quebra de linha", () => {
  const result = parseAudienceCsv('Nome;Telefone;Escola;Nota\n"Ana, Maria";5588999990000;"São José";"9,5"');
  assert.deepEqual(result.headers, ["Escola", "Nota"]);
  assert.deepEqual(result.rows[0], { name: "Ana, Maria", phone: "5588999990000", attributes: { Escola: "São José", Nota: "9,5" } });
});

test("aceita BOM UTF-8 e exportação Windows-1252 sem trocar acentos por �", () => {
  const bytes = new TextEncoder().encode("\uFEFFNome,Telefone\nJosé,5588999990000");
  assert.equal(parseAudienceCsv(decodeAudienceCsv(bytes)).rows[0].name, "José");
  const legacy = Uint8Array.of(...Buffer.from("Nome;Telefone2;Munic", "ascii"), 0xed, ...Buffer.from("pio\nJo", "ascii"), 0xe3, ...Buffer.from("o;5588999990000;S", "ascii"), 0xe3, ...Buffer.from("o Jos", "ascii"), 0xe9);
  const parsed = parseAudienceCsv(decodeAudienceCsv(legacy));
  assert.equal(parsed.rows[0].name, "João");
  assert.equal(parsed.rows[0].phone, "5588999990000");
  assert.deepEqual(parsed.headers, ["Município"]);
  assert.equal(parsed.rows[0].attributes["Município"], "São José");
});

test("identifica perda já ocorrida sem inventar a letra", () => {
  assert.equal(hasReplacementCharacter("JO�O"), true);
  assert.equal(hasReplacementCharacter("JOÃO"), false);
});

test("número da matrícula permanece coluna de negócio", () => {
  const parsed = parseAudienceCsv("Nome,Telefone,Número da matrícula\nAna,5588999990000,12345");
  assert.deepEqual(parsed.headers, ["Número da matrícula"]);
  assert.equal(parsed.rows[0].attributes["Número da matrícula"], "12345");
});

test("separador dentro de cabeçalho entre aspas não muda o delimitador", () => {
  const parsed = parseAudienceCsv('"Nome, completo";TELEFONE2;"Curso; turno"\r\n"Ana, Maria";5588999990000;"Odonto; noite"');
  assert.equal(parsed.rows[0].name, "Ana, Maria");
  assert.equal(parsed.rows[0].phone, "5588999990000");
  assert.deepEqual(parsed.headers, ["Curso; turno"]);
  assert.equal(parsed.rows[0].attributes["Curso; turno"], "Odonto; noite");
});

test("aceita CSV Unicode UTF-16LE do Excel e detecta texto já perdido", () => {
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Nome;Telefone\r\nJoão;5588999990000", "utf16le")]);
  assert.equal(parseAudienceCsv(decodeAudienceCsv(utf16)).rows[0].name, "João");
  assert.throws(() => parseAudienceCsv("Nome;Telefone\nJO�O;5588999990000"), /contém �/);
});

test("não troca aspas curvas nem acentos do Windows-1252", () => {
  const bytes = Uint8Array.of(...Buffer.from("Nome;Telefone;Observacao\n", "ascii"), 0x93,
    ...Buffer.from("Jo", "ascii"), 0xe3, ...Buffer.from("o", "ascii"), 0x94,
    ...Buffer.from(";5588999990000;cora", "ascii"), 0xe7, ...Buffer.from("ao", "ascii"));
  const parsed = parseAudienceCsv(decodeAudienceCsv(bytes));
  assert.equal(parsed.rows[0].name, "“João”");
  assert.equal(parsed.rows[0].attributes.Observacao, "coraçao");
});

test("header NOME + TELEFONE: identifica pessoa e telefone, preserva extras", () => {
  const parsed = parseAudienceCsv(
    "NOME;TELEFONE2;NOMEMUNICIPIO\nMARIA CLARA LUNA DA SILVA;88999990000;Fortaleza",
  );
  assert.equal(parsed.nameColumn, "NOME");
  assert.equal(parsed.phoneColumn, "TELEFONE2");
  assert.equal(parsed.rows[0].name, "MARIA CLARA LUNA DA SILVA");
  assert.equal(parsed.rows[0].attributes.NOMEMUNICIPIO, "Fortaleza");
});
