/**
 * Interface común de parser.
 * Sumar un broker = implementar BrokerParser + registrar en el router.
 */
import type { WorkBook } from 'xlsx';
import type {
  BrokerCode,
  DetectResult,
  ParseResult,
} from '../schema';

/**
 * Opciones inyectadas al parser en runtime.
 * Los parsers NO acceden a stores directamente — todo llega via opts.
 */
export interface ParseOptions {
  /** FX manual ARS/USD ingresado por el asesor (para posiciones sin FX del broker) */
  fx_manual?: number;

  /** Fecha de reporte override (para IEB que no trae fecha en el archivo) */
  fecha_reporte_override?: string; // ISO 8601

  /** Mapping cuenta → titular (para GMA y MS que no traen nombre) */
  mapping_cuentas?: Record<string, string>;

  /** Mapping cuenta → productor/manager (principalmente GMA) */
  mapping_productor?: Record<string, string>;

  /** Mapping cuenta → advisor */
  mapping_advisor?: Record<string, string>;

  /** Mapping cuenta → tipo_cuenta (para MS: advisory/brokerage/lending) */
  mapping_tipo_cuenta?: Record<string, string>;

  /** Metadata de tickers para clasificación (desde tickers-metadata store) */
  tickers_metadata?: Record<string, TickerMeta>;

  /** Mapping alias de titulares para normalización cross-broker */
  aliases?: Record<string, string>;
}

export interface TickerMeta {
  pais: string | null;
  clase: string;
  es_etf: boolean;
  nombre: string;
  confirmado: boolean;
}

/**
 * Interface que cada parser de broker debe implementar.
 *
 * detect() es stateless y rápido — solo mira headers/estructura.
 * parse() hace el trabajo pesado y devuelve ParseResult validado por Zod.
 */
export interface BrokerParser {
  /** Código del broker que este parser maneja */
  readonly code: BrokerCode;

  /**
   * Detecta si un workbook corresponde a este broker.
   * Debe ser rápido (<10ms) y no modificar el workbook.
   * @returns confidence 0-1, reason descriptiva.
   */
  detect(workbook: WorkBook, filename: string): DetectResult;

  /**
   * Parsea el workbook y devuelve posiciones normalizadas.
   * Puede emitir warnings sin frenar; errors para problemas graves.
   * @throws nunca — errores van en ParseResult.errors
   */
  parse(workbook: WorkBook, filename: string, opts: ParseOptions): ParseResult;
}
