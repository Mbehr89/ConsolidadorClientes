import type {
  CanonicalField,
  ColumnMapping,
  FeeStatus,
  NormalizedRow,
} from "@/lib/aranceles/types";
import {
  GMA_EXPECTED_MISSING_OPS,
  isGmaMinFee,
  normalizeGmaCurrency,
} from "@/lib/aranceles/mappers/gma";

export type DateOrder = "dmy" | "mdy" | "auto";

function excelSerialToIso(serial: number): string | null {
  if (serial < 20000 || serial > 80000) return null;
  const utc = Date.UTC(1899, 11, 30) + serial * 86400000;
  const d = new Date(utc);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function buildIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

export function parseDateValue(
  raw: unknown,
  order: DateOrder = "auto",
): string | null {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }

  if (typeof raw === "number") {
    return excelSerialToIso(raw);
  }

  const s = String(raw).trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }

  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += 2000;

    const tryOrder = (o: "dmy" | "mdy") =>
      o === "dmy" ? buildIso(year, b, a) : buildIso(year, a, b);

    if (order === "dmy" || order === "mdy") {
      return tryOrder(order);
    }

    if (a > 12 && b <= 12) return tryOrder("dmy");
    if (b > 12 && a <= 12) return tryOrder("mdy");
    return tryOrder("dmy") ?? tryOrder("mdy");
  }

  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }

  return null;
}

export function parseNumberValue(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;

  let s = String(raw).trim();
  if (!s) return null;

  s = s.replace(/[^\d,.\-]/g, "");

  if (s.includes(",") && s.includes(".")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(",")) {
    const parts = s.split(",");
    if (parts.length === 2 && parts[1]!.length <= 2) {
      s = parts[0]!.replace(/\./g, "") + "." + parts[1];
    } else {
      s = s.replace(/,/g, "");
    }
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function getMapped(
  row: Record<string, unknown>,
  mapping: ColumnMapping,
  field: CanonicalField,
): unknown {
  const header = Object.entries(mapping).find(([, f]) => f === field)?.[0];
  if (!header) return undefined;
  return row[header];
}

function isBlank(raw: unknown): boolean {
  return raw == null || String(raw).trim() === "";
}

export type NormalizeOptions = {
  dateOrder?: DateOrder;
  /** When true, rows without commission are kept (fee_status missing/skipped). */
  keepMissingCommission?: boolean;
  currencyNormalizer?: (raw: string) => string;
  /** Treat certain ops with blank fee as expected (GMA aptos). */
  expectedMissingOps?: Set<string>;
  /** Used when the sheet has no date column (e.g. IEB ACDI). */
  fallbackDate?: string | null;
  /** Force fee_status ok rows' operation label prefix (segment tag). */
  operationFallback?: string | null;
};

export type NormalizeResult = {
  rows: NormalizedRow[];
  errors: { index: number; message: string }[];
  skipped: number;
};

export function normalizeRows(
  rows: Record<string, unknown>[],
  mapping: ColumnMapping,
  options: NormalizeOptions = {},
): NormalizeResult {
    const {
    dateOrder = "auto",
    keepMissingCommission = false,
    currencyNormalizer,
    expectedMissingOps = GMA_EXPECTED_MISSING_OPS,
    fallbackDate = null,
    operationFallback = null,
  } = options;

  const out: NormalizedRow[] = [];
  const errors: { index: number; message: string }[] = [];
  let skipped = 0;

  rows.forEach((row, index) => {
    const clientRaw = getMapped(row, mapping, "client");
    const dateRaw = getMapped(row, mapping, "date");
    const commissionRaw = getMapped(row, mapping, "commission");
    const pctRaw = getMapped(row, mapping, "commission_pct");

    const client = clientRaw != null ? String(clientRaw).trim() : "";
    const date =
      parseDateValue(dateRaw, dateOrder) ??
      (fallbackDate && /^\d{4}-\d{2}-\d{2}$/.test(fallbackDate)
        ? fallbackDate
        : null);
    const commissionParsed = parseNumberValue(commissionRaw);
    const commissionPct = parseNumberValue(pctRaw);
    const commissionBlank = isBlank(commissionRaw);

    if (!client && date == null && commissionBlank && isBlank(pctRaw)) {
      skipped += 1;
      return;
    }

    const issues: string[] = [];
    if (!client) issues.push("falta cliente");
    if (!date) issues.push("fecha inválida o vacía");

    const operationRaw = getMapped(row, mapping, "operation");
    const operation =
      operationRaw != null && String(operationRaw).trim()
        ? String(operationRaw).trim()
        : operationFallback;

    let feeStatus: FeeStatus = "ok";
    let commission = commissionParsed ?? 0;

    if (commissionBlank) {
      if (keepMissingCommission) {
        // null fee ≠ zero: mark missing, or skipped if op never charges in export
        if (operation && expectedMissingOps.has(operation.toUpperCase())) {
          feeStatus = "skipped";
        } else {
          feeStatus = "missing";
        }
        commission = 0;
      } else if (commissionParsed == null) {
        issues.push("comisión inválida o vacía");
      }
    } else if (commissionParsed == null) {
      issues.push("comisión inválida");
    } else if (commissionParsed === 0) {
      feeStatus = "zero";
    }

    if (issues.length) {
      errors.push({
        index: index + 1,
        message: issues.join("; "),
      });
      return;
    }

    const currencyRaw = getMapped(row, mapping, "currency");
    let currency =
      currencyRaw != null ? String(currencyRaw).trim() : "ARS";
    currency = currencyNormalizer
      ? currencyNormalizer(currency)
      : defaultCurrency(currency);

    const instrumentRaw = getMapped(row, mapping, "instrument");
    const alycRaw = getMapped(row, mapping, "alyc");
    const extRaw = getMapped(row, mapping, "client_external_id");
    const officerRaw = getMapped(row, mapping, "account_officer");
    const settleRaw = getMapped(row, mapping, "settlement_date");
    const opNumRaw = getMapped(row, mapping, "op_number");
    const amount = parseNumberValue(getMapped(row, mapping, "amount"));
    const netAmount = parseNumberValue(getMapped(row, mapping, "net_amount"));

    const isMinFee =
      feeStatus === "ok" && isGmaMinFee(currency, commission);

    out.push({
      client,
      clientExternalId:
        extRaw != null && String(extRaw).trim()
          ? String(extRaw).trim()
          : null,
      accountOfficer:
        officerRaw != null && String(officerRaw).trim()
          ? String(officerRaw).trim()
          : null,
      date: date!,
      settlementDate: parseDateValue(settleRaw, dateOrder),
      instrument:
        instrumentRaw != null && String(instrumentRaw).trim()
          ? String(instrumentRaw).trim()
          : null,
      operation,
      quantity: parseNumberValue(getMapped(row, mapping, "quantity")),
      amount,
      netAmount,
      commission,
      commissionPct,
      currency,
      opNumber:
        opNumRaw != null && String(opNumRaw).trim()
          ? String(opNumRaw).trim()
          : null,
      feeStatus,
      isMinFee,
      alyc:
        alycRaw != null && String(alycRaw).trim()
          ? String(alycRaw).trim()
          : null,
    });
  });

  return { rows: out, errors, skipped };
}

function defaultCurrency(raw: string): string {
  const s = raw.trim().toUpperCase();
  if (!s || s === "$" || s === "PESOS" || s === "PESO") return "ARS";
  if (s === "USD C" || s === "USDC") return "USD_C";
  if (s === "U$S" || s === "U$D" || s === "DOLAR" || s === "DÓLAR" || s.includes("USD"))
    return "USD";
  return s || "ARS";
}

export { normalizeGmaCurrency };
