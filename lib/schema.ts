/**
 * Schema v4 — Fuente de verdad
 * Cada campo está documentado con la decisión que lo originó.
 * Cambios requieren aprobación explícita.
 */
import { z } from 'zod';

// ─── Enums ──────────────────────────────────────────────

export const BrokerCodeSchema = z.enum(['MS', 'NETX360', 'GMA', 'IEB']);
export type BrokerCode = z.infer<typeof BrokerCodeSchema>;

export const BrokerTipoSchema = z.enum(['local', 'offshore']);
export type BrokerTipo = z.infer<typeof BrokerTipoSchema>;

export const BrokerPaisSchema = z.enum(['AR', 'US']);
export type BrokerPais = z.infer<typeof BrokerPaisSchema>;

/** Valores almacenados; el CEDEAR en BYMA/ARDs se indica con `forma_legal: cedear`, no con clase separada. */
const ClaseActivoBaseSchema = z.enum([
  'equity',   // acción local o extranjera; incluye depósito CEDEAR
  'bond',     // bono soberano, treasury, corporate
  'cash',     // efectivo, money market, BDP, savings
  'fund',     // FCI, mutual fund
  'option',   // call/put, long o short
  'etf',      // ETF
  'on',       // obligación negociable AR
  'letra',    // letra del tesoro AR
  'other',    // no clasificado → al glosario
]);
/** Acepta `cedear` legacy (parseos/config vieja) y lo normaliza a `equity`. */
export const ClaseActivoSchema = z.preprocess(
  (v) => (v === 'cedear' ? 'equity' : v),
  ClaseActivoBaseSchema
);
export type ClaseActivo = z.infer<typeof ClaseActivoBaseSchema>;

export const FormaLegalSchema = z.enum([
  'directa',    // activo comprado en su mercado nativo
  'cedear',     // CEDEAR argentino (envoltorio local de activo extranjero)
  'adr',        // ADR comprado offshore
  'on_local',   // ON emitida en mercado AR
  'bono_local', // bono soberano AR / letra
]);
export type FormaLegal = z.infer<typeof FormaLegalSchema>;

export const TipoTitularSchema = z.enum(['persona', 'juridica']);
export type TipoTitular = z.infer<typeof TipoTitularSchema>;

export const TipoCuentaSchema = z.enum([
  'advisory',
  'brokerage',
  'lending',
  'retirement',
  'other',
]);
export type TipoCuenta = z.infer<typeof TipoCuentaSchema>;

export const FxSourceSchema = z.enum([
  'broker',   // tasa FX provista por el broker en el archivo
  'manual',   // ingresada por el asesor en el popup de upload
  'default',  // tasa default de config admin
  'trivial',  // ya estaba en USD (offshore)
]);
export type FxSource = z.infer<typeof FxSourceSchema>;

// ─── Position ───────────────────────────────────────────

export const PositionSchema = z.object({
  // --- Cliente ---
  cliente_id: z.string().min(1),
  titular: z.string().min(1),
  titular_normalizado: z.string().min(1),
  tipo_titular: TipoTitularSchema,
  grupo_id: z.string().nullable(),

  // --- Broker / Cuenta ---
  broker: BrokerCodeSchema,
  cuenta: z.string().min(1),
  tipo_cuenta: TipoCuentaSchema.nullable(),
  productor: z.string().nullable(),
  fecha_reporte: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO 8601 date required'),

  // --- Instrumento: identificación ---
  ticker: z.string().nullable(),
  isin: z.string().nullable(),
  cusip: z.string().nullable(),
  descripcion: z.string(),

  // --- Instrumento: clasificación ---
  clase_activo: ClaseActivoSchema,
  forma_legal: FormaLegalSchema.nullable(),
  pais_emisor: z.string().length(2).nullable(), // ISO 3166-1 alpha-2

  // --- Valuación ---
  cantidad: z.number(),
  cantidad_disponible: z.number().nullable(),
  cantidad_no_disponible: z.number().nullable(),
  precio_mercado: z.number().nullable(),
  moneda: z.string().min(3).max(3), // ISO 4217
  moneda_subtipo: z.string().nullable(),
  valor_mercado_local: z.number(),
  valor_mercado_usd: z.number().nullable(),
  accrued_interest_usd: z.number().nullable(),
  fx_source: FxSourceSchema,
  pct_portfolio: z.number().nullable(),

  // --- Metadata ---
  source_file: z.string(),
  source_row: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});

export type Position = z.infer<typeof PositionSchema>;

// ─── Parse errors & warnings ────────────────────────────

export const ParseErrorSchema = z.object({
  row: z.number().int().nullable(),
  field: z.string().nullable(),
  message: z.string(),
  severity: z.enum(['error', 'warning']),
});
export type ParseError = z.infer<typeof ParseErrorSchema>;

// ─── Parse result ───────────────────────────────────────

export const ParseResultSchema = z.object({
  positions: z.array(PositionSchema),
  errors: z.array(ParseErrorSchema),
  warnings: z.array(z.string()),
  metadata: z.object({
    broker: BrokerCodeSchema,
    cuentas_detectadas: z.array(z.string()),
    fecha_reporte: z.string(),
    totales_originales: z.record(z.string(), z.number()),
    productor: z.string().nullable(),
    filename: z.string(),
  }),
});
export type ParseResult = z.infer<typeof ParseResultSchema>;

// ─── Detect result ──────────────────────────────────────

export const DetectResultSchema = z.object({
  matches: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});
export type DetectResult = z.infer<typeof DetectResultSchema>;

// ─── Consolidation session ──────────────────────────────

export const ConsolidationSessionSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  files: z.array(z.object({
    filename: z.string(),
    broker: BrokerCodeSchema,
    rows_parsed: z.number(),
    errors_count: z.number(),
    warnings_count: z.number(),
  })),
  total_positions: z.number(),
  total_aum_usd: z.number().nullable(),
  fx_manual: z.record(z.string(), z.number()).nullable(),
});
export type ConsolidationSession = z.infer<typeof ConsolidationSessionSchema>;

// ─── Standard warning codes ─────────────────────────────

export const WARNING_CODES = {
  TICKER_NO_CONFIRMADO: 'TICKER_NO_CONFIRMADO',
  TITULAR_NO_MAPEADO: 'TITULAR_NO_MAPEADO',
  PREFIJO_CUENTA_NO_CLASIFICADO: 'PREFIJO_CUENTA_NO_CLASIFICADO',
  POSICION_RESIDUAL: 'POSICION_RESIDUAL',
  CASH_NEGATIVO: 'CASH_NEGATIVO',
  TIPO_CAMBIO_ATIPICO: 'TIPO_CAMBIO_ATIPICO',
  CANTIDAD_NEGATIVA: 'CANTIDAD_NEGATIVA',
  FECHA_DESALINEADA: 'FECHA_DESALINEADA',
  CHECKSUM_DELTA: 'CHECKSUM_DELTA',
  MONEDA_SUBTIPO_NO_DETERMINADA: 'MONEDA_SUBTIPO_NO_DETERMINADA',
  CAUTELA_DETECTADA: 'CAUTELA_DETECTADA',
  FILA_TOTALIZADORA_FILTRADA: 'FILA_TOTALIZADORA_FILTRADA',
} as const;

export type WarningCode = (typeof WARNING_CODES)[keyof typeof WARNING_CODES];
