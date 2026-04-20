/**
 * Parser router.
 * Registrá cada parser acá. detect() los prueba todos y elige el de mayor confidence.
 */
import type { WorkBook } from 'xlsx';
import type { BrokerCode, DetectResult, ParseResult } from '../schema';
import type { BrokerParser, ParseOptions } from './types';
import { netx360Parser } from './netx360';
import { msParser } from './ms';
import { iebParser } from './ieb';
import { gmaParser } from './gma';

/**
 * Registry de parsers implementados.
 * Agregar un broker = implementar BrokerParser + push acá.
 */
const PARSERS: BrokerParser[] = [
  netx360Parser,
  msParser,
  iebParser,
  gmaParser,
];

export interface DetectAllResult {
  /** Parser ganador (mayor confidence) o null si ninguno matcheó */
  parser: BrokerParser | null;
  /** Resultado de detección del ganador */
  result: DetectResult | null;
  /** Todos los resultados, para debug / fallback UI */
  all: Array<{ code: BrokerCode; result: DetectResult }>;
}

/**
 * Detecta automáticamente qué broker corresponde a un workbook.
 * Si hay empate o ambigüedad (múltiples confidence > 0.5), devuelve
 * el de mayor confidence pero la UI debería ofrecer selector manual.
 */
export function detectBroker(workbook: WorkBook, filename: string): DetectAllResult {
  const all = PARSERS.map((parser) => ({
    code: parser.code,
    result: parser.detect(workbook, filename),
  }));

  const matches = all
    .filter((r) => r.result.matches)
    .sort((a, b) => b.result.confidence - a.result.confidence);

  if (matches.length === 0) {
    return { parser: null, result: null, all };
  }

  const best = matches[0]!;
  const parser = PARSERS.find((p) => p.code === best.code) ?? null;

  return { parser, result: best.result, all };
}

/**
 * Parsea un workbook con un parser específico (ya identificado).
 * Usar cuando el usuario seleccionó broker manualmente.
 */
export function parseWithBroker(
  brokerCode: BrokerCode,
  workbook: WorkBook,
  filename: string,
  opts: ParseOptions
): ParseResult {
  const parser = PARSERS.find((p) => p.code === brokerCode);
  if (!parser) {
    return {
      positions: [],
      errors: [
        {
          row: null,
          field: null,
          message: `Parser no implementado para broker: ${brokerCode}`,
          severity: 'error',
        },
      ],
      warnings: [],
      metadata: {
        broker: brokerCode,
        cuentas_detectadas: [],
        fecha_reporte: '',
        totales_originales: {},
        productor: null,
        filename,
      },
    };
  }

  return parser.parse(workbook, filename, opts);
}

/**
 * Registra un parser en runtime (útil para tests o plugins dinámicos).
 */
export function registerParser(parser: BrokerParser): void {
  const existing = PARSERS.findIndex((p) => p.code === parser.code);
  if (existing >= 0) {
    PARSERS[existing] = parser;
  } else {
    PARSERS.push(parser);
  }
}
