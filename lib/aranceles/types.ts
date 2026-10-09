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
  row_count: number;
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
  currency: string;
  /** Estado tal como vino del archivo (antes del análisis de tarifas). */
  imported_status: FeeStatus;
  fee_status: FeeStatus;
  expected_commission: number | null;
  op_number: string | null;
  segment: string | null;
  is_min_fee: boolean;
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
};

export type CommissionFilters = {
  alyc?: string | null;
  client?: string | null;
  from?: string | null;
  to?: string | null;
  q?: string | null;
  feeStatus?: FeeStatus | 'anomaly' | null;
};
