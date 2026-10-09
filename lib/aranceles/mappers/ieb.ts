import type { CanonicalField, ColumnMapping } from "@/lib/aranceles/types";

export type IebSegment =
  | "aranceles_publico"
  | "aranceles_privado"
  | "diferencias"
  | "acdi"
  | "notas"
  | "licitaciones"
  | "aranceles" // generic before PUBLICO/PRIVADO split
  | "unknown";

export const IEB_SEGMENTS: {
  id: IebSegment;
  label: string;
  fileHint: string;
  required: false;
}[] = [
  {
    id: "aranceles_publico",
    label: "Aranceles — público",
    fileHint: "Aranceles_1.xlsx",
    required: false,
  },
  {
    id: "aranceles_privado",
    label: "Aranceles — privado",
    fileHint: "Aranceles_2.xlsx",
    required: false,
  },
  {
    id: "diferencias",
    label: "Diferencias (SENEBI)",
    fileHint: "Diferencias.xlsx",
    required: false,
  },
  {
    id: "acdi",
    label: "ACDI (FCI)",
    fileHint: "ACDI.xlsx",
    required: false,
  },
  {
    id: "notas",
    label: "Notas débito / crédito",
    fileHint: "Notas_Debito_y_Credito.xlsx",
    required: false,
  },
  {
    id: "licitaciones",
    label: "Licitaciones",
    fileHint: "Licitaciones.xlsx",
    required: false,
  },
];

function norm(h: string): string {
  return h
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

export function isIebArancelesHeaders(headers: string[]): boolean {
  const set = new Set(headers.map(norm));
  return (
    set.has("arancelmonto") &&
    set.has("cliente") &&
    set.has("comitente") &&
    set.has("fechaoperacion")
  );
}

export function isIebAcdiHeaders(headers: string[]): boolean {
  const set = new Set(headers.map(norm));
  return set.has("comision") && set.has("nombredelfondo") && set.has("cliente");
}

/** Empty workbook / no headers — valid optional IEB segment. */
export function isEmptyWorkbook(headers: string[], rowCount: number): boolean {
  return headers.length === 0 || rowCount === 0;
}

export function detectIebSegment(
  headers: string[],
  previewRows: Record<string, unknown>[],
  filename?: string,
): IebSegment {
  const fn = (filename ?? "").toLowerCase();
  if (isIebAcdiHeaders(headers) || fn.includes("acdi")) return "acdi";
  if (fn.includes("diferencia") || fn.includes("senebi")) return "diferencias";
  if (fn.includes("licitacion")) return "licitaciones";
  if (fn.includes("nota")) return "notas";

  if (isIebArancelesHeaders(headers)) {
    const especieKey = headers.find((h) => norm(h) === "tipodeespecie");
    if (especieKey) {
      const values = previewRows
        .map((r) => String(r[especieKey] ?? "").trim().toUpperCase())
        .filter(Boolean);
      if (values.some((v) => v === "PUBLICO")) return "aranceles_publico";
      if (values.some((v) => v === "PRIVADO")) return "aranceles_privado";
    }
    if (fn.includes("aranceles_1") || fn.includes("publico"))
      return "aranceles_publico";
    if (fn.includes("aranceles_2") || fn.includes("privado"))
      return "aranceles_privado";
    return "aranceles";
  }

  return "unknown";
}

export function iebArancelesMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  for (const header of headers) {
    const n = norm(header);
    let field: CanonicalField = "ignore";
    if (n === "cliente") field = "client";
    else if (n === "comitente") field = "client_external_id";
    else if (n === "fechaoperacion") field = "date";
    else if (n === "ticker") field = "instrument";
    else if (n === "tipodeespecie") field = "operation";
    else if (n === "arancelmonto") field = "commission";
    else if (n === "totalpesificado") field = "amount";
    else if (n === "moneda") field = "currency";
    else if (n === "id") field = "op_number";
    else if (n === "oficialcuenta") field = "account_officer";
    mapping[header] = field;
  }
  return mapping;
}

export function iebAcdiMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  for (const header of headers) {
    const n = norm(header);
    let field: CanonicalField = "ignore";
    if (n === "cliente") field = "client";
    else if (n === "comitente") field = "client_external_id";
    else if (n === "nombredelfondo") field = "instrument";
    else if (n === "tipodeespecie") field = "operation";
    else if (n === "comision") field = "commission";
    else if (n === "importe") field = "amount";
    else if (n === "cantidad") field = "quantity";
    else if (n === "moneda") field = "currency";
    else if (n === "id") field = "op_number";
    else if (n === "productor") field = "account_officer";
    mapping[header] = field;
  }
  return mapping;
}

/** Placeholder mapping for segments without a sample schema yet. */
export function iebGenericFeeMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  for (const header of headers) {
    const n = norm(header);
    let field: CanonicalField = "ignore";
    if (n.includes("cliente") || n === "denominacion") field = "client";
    else if (n.includes("comitente") && n.includes("numero"))
      field = "client_external_id";
    else if (n.includes("fecha")) field = "date";
    else if (n.includes("arancel") || n.includes("comision") || n === "importe")
      field = n.includes("%") ? "commission_pct" : "commission";
    else if (n.includes("moneda")) field = "currency";
    else if (n.includes("ticker") || n.includes("especie") || n.includes("fondo"))
      field = "instrument";
    mapping[header] = field;
  }
  return mapping;
}

export function normalizeIebCurrency(raw: string): string {
  const s = raw.trim().toUpperCase();
  if (!s || s === "$" || s === "PESOS" || s === "ARS" || s === "PESO")
    return "ARS";
  if (
    s === "DOLAR EXT." ||
    s === "DOLAR EXT" ||
    s === "USD EXT" ||
    s === "USD_EXT"
  )
    return "USD_EXT";
  if (s.includes("USD") || s === "U$D" || s === "DOLAR") return "USD";
  return s;
}

/** Prefer TipodeEspecie over upload slot / filename. */
export function resolveArancelesSegment(
  detected: IebSegment,
  forced?: IebSegment,
): IebSegment {
  if (
    detected === "aranceles_publico" ||
    detected === "aranceles_privado"
  ) {
    return detected;
  }
  if (
    forced === "aranceles_publico" ||
    forced === "aranceles_privado" ||
    forced === "aranceles"
  ) {
    return forced;
  }
  return detected === "aranceles" ? "aranceles" : detected;
}

export const IEB_DEFAULT_ALYC = "IEB";
export const IEB_FORMAT_LABEL = "IEB (segmentos)";
