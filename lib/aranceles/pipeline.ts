import { detectAndMap } from "@/lib/aranceles/detect";
import {
  detectIebSegment,
  iebAcdiMapping,
  iebArancelesMapping,
  iebGenericFeeMapping,
  isEmptyWorkbook,
  isIebAcdiHeaders,
  isIebArancelesHeaders,
  normalizeIebCurrency,
  resolveArancelesSegment,
  type IebSegment,
} from "@/lib/aranceles/mappers/ieb";
import { parseExcelBuffer, type ParsedSheet } from "@/lib/aranceles/parse-excel";
import {
  normalizeRows,
  type NormalizeOptions,
  type NormalizeResult,
} from "@/lib/aranceles/normalize";
import type { ColumnMapping, DetectedFormat } from "@/lib/aranceles/types";

export type ParsedImport = {
  parsed: ParsedSheet;
  format: DetectedFormat | "ieb";
  formatLabel: string;
  segment?: IebSegment;
  mapping: ColumnMapping;
  normalizeOptions: NormalizeOptions;
  empty: boolean;
  suggestedAlycName?: string;
};

export function parseImportBuffer(
  buffer: Uint8Array | ArrayBuffer,
  filename?: string,
  opts?: { fallbackDate?: string | null; forceSegment?: IebSegment },
): ParsedImport {
  let parsed: ParsedSheet;
  try {
    parsed = parseExcelBuffer(buffer);
  } catch (err) {
    // Completely empty sheet (IEB optional segments)
    if (
      err instanceof Error &&
      (err.message.includes("vacía") || err.message.includes("no contiene"))
    ) {
      return {
        parsed: {
          sheetName: "",
          headers: [],
          rows: [],
          previewRows: [],
          totalRows: 0,
        },
        format: "ieb",
        formatLabel: "IEB (segmento vacío)",
        segment: opts?.forceSegment ?? "unknown",
        mapping: {},
        normalizeOptions: { keepMissingCommission: true },
        empty: true,
        suggestedAlycName: "IEB",
      };
    }
    throw err;
  }

  if (isEmptyWorkbook(parsed.headers, parsed.totalRows)) {
    return {
      parsed,
      format: "ieb",
      formatLabel: "IEB (segmento vacío)",
      segment: opts?.forceSegment ?? detectIebSegment(parsed.headers, [], filename),
      mapping: {},
      normalizeOptions: { keepMissingCommission: true },
      empty: true,
      suggestedAlycName: "IEB",
    };
  }

  // IEB segment detection (before generic)
  if (
    isIebArancelesHeaders(parsed.headers) ||
    isIebAcdiHeaders(parsed.headers) ||
    opts?.forceSegment
  ) {
    const detected = detectIebSegment(
      parsed.headers,
      parsed.previewRows,
      filename,
    );
    // TipodeEspecie wins over upload slot for público/privado
    let segment: IebSegment = opts?.forceSegment
      ? resolveArancelesSegment(detected, opts.forceSegment)
      : detected;
    if (
      opts?.forceSegment &&
      !segment.startsWith("aranceles") &&
      opts.forceSegment !== "unknown"
    ) {
      // Non-arancel slots (acdi, diferencias, …): keep forced id
      segment = opts.forceSegment;
    }

    let mapping: ColumnMapping;
    if (isIebAcdiHeaders(parsed.headers) || segment === "acdi") {
      mapping = iebAcdiMapping(parsed.headers);
    } else if (isIebArancelesHeaders(parsed.headers)) {
      mapping = iebArancelesMapping(parsed.headers);
    } else {
      mapping = iebGenericFeeMapping(parsed.headers);
    }

    const opFallback =
      segment === "acdi"
        ? "ACDI"
        : segment === "aranceles_publico"
          ? "PUBLICO"
          : segment === "aranceles_privado"
            ? "PRIVADO"
            : segment.startsWith("aranceles")
              ? "ARANCEL"
              : segment.toUpperCase();

    return {
      parsed,
      format: "ieb",
      formatLabel: `IEB · ${segment}`,
      segment,
      mapping,
      normalizeOptions: {
        dateOrder: "auto",
        keepMissingCommission: true,
        currencyNormalizer: normalizeIebCurrency,
        fallbackDate: opts?.fallbackDate ?? null,
        operationFallback: opFallback,
      },
      empty: false,
      suggestedAlycName: "IEB",
    };
  }

  const detected = detectAndMap(parsed.headers);
  return {
    parsed,
    format: detected.format,
    formatLabel: detected.label,
    mapping: detected.mapping,
    normalizeOptions: {
      ...detected.normalizeOptions,
      fallbackDate: opts?.fallbackDate ?? null,
    },
    empty: false,
    suggestedAlycName: detected.suggestedAlycName,
  };
}

export function normalizeParsed(
  imp: ParsedImport,
  mapping?: ColumnMapping,
): NormalizeResult {
  if (imp.empty) {
    return { rows: [], errors: [], skipped: 0 };
  }
  return normalizeRows(
    imp.parsed.rows,
    mapping ?? imp.mapping,
    imp.normalizeOptions,
  );
}
