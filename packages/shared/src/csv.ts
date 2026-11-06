// CSV parsing and serialization (FR-IMP-001/002, FR-RPT-002). RFC 4180 quoting, UTF-8 with an
// optional BOM, comma or semicolon delimiters. Exports neutralise spreadsheet formulas: a cell
// starting with = + - @ TAB or CR is prefixed with an apostrophe.

const FORMULA_START = /^[=+\-@\t\r]/;

export function neutralizeFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

function quote(value: string): string {
  return /[",\r\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = Array.isArray(value) ? value.join("; ") : String(value);
  return quote(neutralizeFormula(text));
}

/** Rows of cells → CSV text (CRLF line endings, UTF-8 BOM so spreadsheets detect encoding). */
export function toCsv(rows: unknown[][]): string {
  return `﻿${rows.map((row) => row.map(toCsvCell).join(",")).join("\r\n")}\r\n`;
}

/** Pick the delimiter from the header line (outside quotes): semicolon wins only if it's more common. */
export function detectDelimiter(text: string): "," | ";" {
  let commas = 0;
  let semis = 0;
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && ch === ",") commas++;
    else if (!quoted && ch === ";") semis++;
  }
  return semis > commas ? ";" : ",";
}

export interface ParsedCsv {
  header: string[];
  rows: string[][];
}

/**
 * Parse CSV text. Throws on unterminated quotes. `maxRows` stops early (data rows, excluding the
 * header) so previews don't parse whole files.
 */
export function parseCsv(input: string, maxRows = Number.POSITIVE_INFINITY): ParsedCsv {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  let i = 0;
  const pushRecord = () => {
    record.push(field);
    field = "";
    if (!(record.length === 1 && record[0] === "")) records.push(record);
    record = [];
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      pushRecord();
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (records.length > maxRows) break;
    } else field += ch;
    i++;
  }
  if (quoted) throw new Error("Unterminated quoted field");
  if (field !== "" || record.length > 0) pushRecord();
  const [header = [], ...rows] = records;
  return { header: header.map((h) => h.trim()), rows: rows.slice(0, maxRows) };
}
