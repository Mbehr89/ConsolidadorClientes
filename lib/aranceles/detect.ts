import { suggestMapping } from "@/lib/aranceles/aliases";
import {
  GMA_DEFAULT_ALYC,
  GMA_EXPECTED_MISSING_OPS,
  GMA_FORMAT_LABEL,
  gmaColumnMapping,
  isGmaFormat,
  normalizeGmaCurrency,
} from "@/lib/aranceles/mappers/gma";
import type { NormalizeOptions } from "@/lib/aranceles/normalize";
import type { ColumnMapping, DetectedFormat } from "@/lib/aranceles/types";

export type FormatDetection = {
  format: DetectedFormat;
  label: string;
  mapping: ColumnMapping;
  normalizeOptions: NormalizeOptions;
  suggestedAlycName?: string;
};

export function detectAndMap(headers: string[]): FormatDetection {
  if (isGmaFormat(headers)) {
    return {
      format: "gma",
      label: GMA_FORMAT_LABEL,
      mapping: gmaColumnMapping(headers),
      suggestedAlycName: GMA_DEFAULT_ALYC,
      normalizeOptions: {
        dateOrder: "mdy",
        keepMissingCommission: true,
        currencyNormalizer: normalizeGmaCurrency,
        expectedMissingOps: GMA_EXPECTED_MISSING_OPS,
      },
    };
  }

  return {
    format: "generic",
    label: "Genérico (mapeo por columnas)",
    mapping: suggestMapping(headers),
    normalizeOptions: {
      dateOrder: "auto",
      keepMissingCommission: true,
    },
  };
}
