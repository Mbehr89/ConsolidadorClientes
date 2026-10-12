import * as XLSX from "xlsx";

export type ParsedSheet = {
  sheetName: string;
  headers: string[];
  rows: Record<string, unknown>[];
  previewRows: Record<string, unknown>[];
  totalRows: number;
};

function cellToString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) {
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${value.getFullYear()}-${m}-${d}`;
  }
  if (typeof value === "number") {
    // Excel serial date heuristic for date-like numbers is handled later
    return String(value);
  }
  return String(value).trim();
}

function uniqueHeaders(raw: unknown[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    const base = cellToString(h) || `Columna ${i + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

export function parseExcelBuffer(buffer: Uint8Array | ArrayBuffer): ParsedSheet {
  const workbook = XLSX.read(buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer, {
    type: "array",
    cellDates: true,
  });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    // Empty optional IEB segments arrive as workbooks without usable sheets
    return {
      sheetName: "",
      headers: [],
      rows: [],
      previewRows: [],
      totalRows: 0,
    };
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return { sheetName, headers: [], rows: [], previewRows: [], totalRows: 0 };
  }
  const matrix = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(
    sheet,
    {
      header: 1,
      defval: "",
      blankrows: false,
      // Valor real de la celda: el texto formateado recorta decimales (ej. Arancel (%) 0,00410959 → "0.00").
      raw: true,
    },
  );

  if (!matrix.length) {
    return {
      sheetName,
      headers: [],
      rows: [],
      previewRows: [],
      totalRows: 0,
    };
  }

  // Find the first non-empty row as header
  let headerIdx = 0;
  for (let i = 0; i < Math.min(matrix.length, 20); i++) {
    const row = matrix[i] ?? [];
    const nonEmpty = row.filter((c) => cellToString(c) !== "").length;
    if (nonEmpty >= 2) {
      headerIdx = i;
      break;
    }
  }

  const headers = uniqueHeaders(matrix[headerIdx] ?? []);
  const dataRows = matrix.slice(headerIdx + 1).filter((row) =>
    row.some((c) => cellToString(c) !== ""),
  );

  const rows: Record<string, unknown>[] = dataRows.map((row) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] ?? "";
    });
    return obj;
  });

  return {
    sheetName,
    headers,
    rows,
    previewRows: rows.slice(0, 25),
    totalRows: rows.length,
  };
}
