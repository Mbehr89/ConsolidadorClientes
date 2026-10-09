import type { CanonicalField, ColumnMapping } from "@/lib/aranceles/types";

/** Normalized header fragments that identify a GMA / ESCO export. */
const GMA_REQUIRED = [
  "comitente (denominacion)",
  "comitente (numero)",
  "arancel (importe)",
  "fecha de concertacion",
  "numero",
];

/** Ops that systematically omit arancel in GMA exports (not undercharge). */
export const GMA_EXPECTED_MISSING_OPS = new Set([
  "APTOMCONC",
  "APCOLCON",
  "CSBNG",
  "VSBNG",
]);

/** Empiric minimum fees from ESCO_BEHR sample (confirm with tarifario). */
export const GMA_MIN_FEES: Record<string, number> = {
  ARS: 19.9,
  USD: 0.2,
  USD_C: 0.2,
};

export const GMA_LARGE_NOTIONAL = 1_000_000;

function norm(h: string): string {
  return h
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

export function isGmaFormat(headers: string[]): boolean {
  const set = new Set(headers.map(norm));
  return GMA_REQUIRED.every((m) => set.has(m));
}

/**
 * Fixed column map for GMA exports.
 * Cliente = Denominación (titular), no el oficial de cuenta.
 */
export function gmaColumnMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  for (const header of headers) {
    const n = norm(header);
    let field: CanonicalField = "ignore";
    if (n === "comitente (denominacion)") field = "client";
    else if (n === "comitente (numero)") field = "client_external_id";
    else if (n === "comitente (oficial de cuenta)") field = "account_officer";
    else if (n === "fecha de concertacion") field = "date";
    else if (n === "fecha de liquidacion") field = "settlement_date";
    else if (n === "instrumento (abreviatura)") field = "instrument";
    else if (n === "tipo de operacion (abreviatura)") field = "operation";
    else if (n === "cantidad") field = "quantity";
    else if (n === "bruto") field = "amount";
    else if (n === "neto") field = "net_amount";
    else if (n === "arancel (importe)") field = "commission";
    else if (n === "arancel (%)") field = "commission_pct";
    else if (n === "moneda (simbolo)") field = "currency";
    else if (n === "numero") field = "op_number";
    mapping[header] = field;
  }
  return mapping;
}

export function normalizeGmaCurrency(raw: string): string {
  const s = raw.trim().toUpperCase();
  if (!s || s === "$" || s === "ARS" || s === "PESOS" || s === "PESO")
    return "ARS";
  if (s === "USD C" || s === "USDC" || s === "USD_C") return "USD_C";
  if (
    s === "U$D" ||
    s === "USD" ||
    s === "DOLAR" ||
    s === "DÓLAR" ||
    s.includes("USD")
  )
    return "USD";
  return s;
}

export function isGmaMinFee(currency: string, fee: number): boolean {
  const min = GMA_MIN_FEES[currency];
  if (min == null) return false;
  return Math.abs(fee - min) < 0.05;
}

export const GMA_FORMAT_LABEL = "GMA / ESCO (comitentes + arancel)";
export const GMA_DEFAULT_ALYC = "ESCO";
