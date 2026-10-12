import type { DedupConflict } from '@/lib/aranceles/dedup';
import type { ArancelesSettings } from '@/lib/aranceles/settings';

export type FeeStatus =
  | 'ok'
  | 'missing'
  | 'zero'
  | 'below_expected'
  | 'min_on_large'
  | 'skipped';

export const ANOMALY_STATUSES: readonly FeeStatus[] = [
  'missing',
  'zero',
  'below_expected',
  'min_on_large',
];

export const FEE_STATUS_LABEL: Record<FeeStatus, string> = {
  ok: 'OK',
  missing: 'Sin arancel',
  zero: 'Arancel cero',
  below_expected: 'Menor al esperado',
  min_on_large: 'Mínimo en notional alto',
  skipped: 'Sin arancel (esperado)',
};

export type CanonicalField =
  | 'client'
  | 'client_external_id'
  | 'account_officer'
  | 'date'
  | 'settlement_date'
  | 'instrument'
  | 'operation'
  | 'quantity'
  | 'amount'
  | 'net_amount'
  | 'commission'
  | 'commission_pct'
  | 'currency'
  | 'op_number'
  | 'alyc'
  | 'ignore';

export type ColumnMapping = Record<string, CanonicalField>;

export type NormalizedRow = {
  client: string;
  clientExternalId: string | null;
  accountOfficer: string | null;
  date: string;
  settlementDate: string | null;
  instrument: string | null;
  operation: string | null;
  quantity: number | null;
  amount: number | null;
  netAmount: number | null;
  commission: number;
  commissionPct: number | null;
  currency: string;
  opNumber: string | null;
  feeStatus: FeeStatus;
  isMinFee: boolean;
  alyc: string | null;
  /** Columnas propias de un formato que no tienen campo canónico (p. ej. Modo / Aplica de las notas IEB). */
  details?: Record<string, string>;
};

export type DetectedFormat = 'gma' | 'generic' | 'ieb';

/** Registro de una importación (archivo) dentro del historial JSON. */
export type ArancelImport = {
  id: string;
  alyc: string;
  filename: string;
  format: string | null;
  segment: string | null;
  period_label: string | null;
  notes: string | null;
  /** Operaciones nuevas que agregó este archivo. */
  row_count: number;
  /** Operaciones del archivo que ya estaban en el historial (no se duplicaron). */
  duplicate_count?: number;
  /** Líneas repetidas dentro del mismo archivo (mismo número y mismos datos). */
  repeated_in_file?: number;
  /** Mismo número de operación ya cargado con datos distintos: no se importaron. */
  conflicts?: DedupConflict[];
  imported_at: string;
  source: 'manual' | 'drive';
  drive_file_id: string | null;
  drive_modified_time: string | null;
};

/** Operación con arancel, una por fila importada. */
export type ArancelCommission = {
  id: string;
  import_id: string;
  alyc: string;
  client: string;
  client_key: string;
  client_external_id: string | null;
  account_officer: string | null;
  trade_date: string;
  settlement_date: string | null;
  instrument: string | null;
  operation: string | null;
  quantity: number | null;
  amount: number | null;
  commission: number;
  commission_pct: number | null;
  /** Moneda de la operación (Bruto / Neto). */
  currency: string;
  /** Moneda en la que está expresado `commission`; puede diferir de la operación (ver fees.ts). */
  commission_currency: string;
  /** Tipo de cambio implícito (ARS por USD) cuando `commission_currency` ≠ `currency`. */
  commission_fx: number | null;
  /** Estado tal como vino del archivo (antes del análisis de tarifas). */
  imported_status: FeeStatus;
  fee_status: FeeStatus;
  expected_commission: number | null;
  op_number: string | null;
  segment: string | null;
  is_min_fee: boolean;
  /** Boletos consecutivos de compra/venta con montos casi iguales (ver trading.ts). */
  trading_group: TradingGroup | null;
  /**
   * Otras importaciones que también traían esta operación. Si se borra `import_id`, la operación
   * pasa a la siguiente en vez de perderse.
   */
  also_in_imports?: string[];
  /** Columnas propias del formato (p. ej. notas IEB: modo Bruto/Neto, aplica SI/NO, descripción). */
  details?: Record<string, string>;
  /**
   * Arancel a cobrar cargado a mano (SENEBI que la ALYC liquida sin arancel), en la moneda de la operación.
   * `commission` queda como vino del archivo; los reportes usan este importe (ver segments.ts).
   */
  manual_commission?: number | null;
};

export type TradingGroup = {
  id: string;
  /** Primer y último n° de boleto del grupo. */
  from: string;
  to: string;
  /**
   * Sumas de ventas y compras en valor absoluto. `importe`: Bruto en la moneda de la operación (misma moneda).
   * `cantidad`: nominales de una misma especie operada en monedas distintas (p. ej. dólar MEP).
   */
  sells: number;
  buys: number;
  basis?: 'importe' | 'cantidad';
  /** Especie base cuando `basis` es `cantidad`. */
  instrument?: string | null;
  /** `false`: boletos del mismo día que no son seguidos. */
  consecutive?: boolean;
};

export type FeeSchedule = {
  id: string;
  alyc: string;
  client: string;
  client_key: string;
  currency: string;
  fee_type: 'fixed' | 'percent';
  amount: number;
  source: 'inferred' | 'manual';
  confidence: number | null;
  sample_count: number | null;
  notes: string | null;
  updated_at: string;
};

export type DriveFileRecord = {
  file_id: string;
  name: string;
  path: string;
  modified_time: string | null;
  processed_at: string;
  status: 'imported' | 'empty' | 'needs_mapping' | 'error';
  message: string | null;
  import_ids: string[];
};

export type ArancelesHistory = {
  version: 1;
  updated_at: string;
  imports: ArancelImport[];
  commissions: ArancelCommission[];
  fee_schedules: FeeSchedule[];
  drive_files: Record<string, DriveFileRecord>;
  /** Alícuotas de liquidación, productores, arreglos comerciales y cambios de cuenta. */
  settings?: ArancelesSettings;
};

export type CommissionFilters = {
  alyc?: string | null;
  client?: string | null;
  from?: string | null;
  to?: string | null;
  q?: string | null;
  feeStatus?: FeeStatus | 'anomaly' | null;
};
