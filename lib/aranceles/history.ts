import { inferFeeSchedules, isAnomaly, recomputeAnomalies } from '@/lib/aranceles/fees';
import type {
  ArancelCommission,
  ArancelImport,
  ArancelesHistory,
  CommissionFilters,
  FeeStatus,
  NormalizedRow,
} from '@/lib/aranceles/types';

export function emptyHistory(): ArancelesHistory {
  return {
    version: 1,
    updated_at: new Date().toISOString(),
    imports: [],
    commissions: [],
    fee_schedules: [],
    drive_files: {},
  };
}

/** Acepta JSON vacío / parcial (p. ej. archivo recién creado en Drive). */
export function coerceHistory(raw: unknown): ArancelesHistory {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyHistory();
  const r = raw as Partial<ArancelesHistory>;
  return {
    version: 1,
    updated_at: typeof r.updated_at === 'string' ? r.updated_at : new Date().toISOString(),
    imports: Array.isArray(r.imports) ? r.imports : [],
    commissions: Array.isArray(r.commissions) ? r.commissions : [],
    fee_schedules: Array.isArray(r.fee_schedules) ? r.fee_schedules : [],
    drive_files:
      r.drive_files && typeof r.drive_files === 'object' && !Array.isArray(r.drive_files)
        ? r.drive_files
        : {},
  };
}

export function clientKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function rowDedupKey(alyc: string, c: {
  op_number: string | null;
  client_key: string;
  trade_date: string;
  commission: number;
  instrument: string | null;
}): string | null {
  if (!c.op_number) return null;
  return [alyc.toLowerCase(), c.op_number, c.client_key, c.trade_date, c.commission.toFixed(2), c.instrument ?? ''].join('|');
}

export type ApplyImportInput = {
  alyc: string;
  filename: string;
  rows: NormalizedRow[];
  format?: string | null;
  segment?: string | null;
  periodLabel?: string | null;
  notes?: string | null;
  source?: 'manual' | 'drive';
  driveFileId?: string | null;
  driveModifiedTime?: string | null;
};

export type ApplyImportResult = {
  history: ArancelesHistory;
  importRecord: ArancelImport | null;
  inserted: number;
  duplicates: number;
};

/**
 * Agrega las filas al historial. Las operaciones con n° de operación que ya existen
 * (misma ALYC, cliente, fecha, arancel) se omiten para no duplicar planillas solapadas.
 * No recalcula tarifas: llamar a `runFeeAnalysis` después.
 */
export function applyImport(history: ArancelesHistory, input: ApplyImportInput): ApplyImportResult {
  const alyc = input.alyc.trim() || 'ALYC sin nombre';
  const existingKeys = new Set<string>();
  for (const c of history.commissions) {
    const k = rowDedupKey(c.alyc, c);
    if (k) existingKeys.add(k);
  }

  const importId = newId('imp');
  const commissions: ArancelCommission[] = [];
  let duplicates = 0;

  input.rows.forEach((row, i) => {
    const key = clientKey(row.client);
    const c: ArancelCommission = {
      id: `${importId}:${i}`,
      import_id: importId,
      alyc,
      client: row.client.trim(),
      client_key: key,
      client_external_id: row.clientExternalId,
      account_officer: row.accountOfficer,
      trade_date: row.date,
      settlement_date: row.settlementDate,
      instrument: row.instrument,
      operation: row.operation,
      quantity: row.quantity,
      amount: row.amount,
      commission: row.commission,
      commission_pct: row.commissionPct,
      currency: row.currency,
      imported_status: row.feeStatus,
      fee_status: row.feeStatus,
      expected_commission: null,
      op_number: row.opNumber,
      segment: input.segment ?? null,
      is_min_fee: row.isMinFee,
    };
    const dk = rowDedupKey(alyc, c);
    if (dk && existingKeys.has(dk)) {
      duplicates += 1;
      return;
    }
    if (dk) existingKeys.add(dk);
    commissions.push(c);
  });

  if (commissions.length === 0) {
    return { history, importRecord: null, inserted: 0, duplicates };
  }

  const importRecord: ArancelImport = {
    id: importId,
    alyc,
    filename: input.filename,
    format: input.format ?? null,
    segment: input.segment ?? null,
    period_label: input.periodLabel ?? null,
    notes: input.notes ?? null,
    row_count: commissions.length,
    imported_at: new Date().toISOString(),
    source: input.source ?? 'manual',
    drive_file_id: input.driveFileId ?? null,
    drive_modified_time: input.driveModifiedTime ?? null,
  };

  return {
    history: {
      ...history,
      imports: [...history.imports, importRecord],
      commissions: [...history.commissions, ...commissions],
    },
    importRecord,
    inserted: commissions.length,
    duplicates,
  };
}

export function removeImports(history: ArancelesHistory, importIds: readonly string[]): ArancelesHistory {
  if (importIds.length === 0) return history;
  const drop = new Set(importIds);
  return {
    ...history,
    imports: history.imports.filter((i) => !drop.has(i.id)),
    commissions: history.commissions.filter((c) => !drop.has(c.import_id)),
  };
}

/** Recalcula tarifas inferidas y estados de arancel sobre todo el historial. */
export function runFeeAnalysis(history: ArancelesHistory): ArancelesHistory {
  const fee_schedules = inferFeeSchedules(history.commissions, history.fee_schedules);
  const gmaImportIds = new Set(history.imports.filter((i) => i.format === 'gma').map((i) => i.id));
  const commissions = recomputeAnomalies(history.commissions, fee_schedules, gmaImportIds);
  return { ...history, fee_schedules, commissions };
}

// ─── Consultas ──────────────────────────────────────────

export function filterCommissions(
  commissions: readonly ArancelCommission[],
  f: CommissionFilters
): ArancelCommission[] {
  const q = f.q?.trim().toLowerCase() ?? '';
  const alyc = f.alyc?.toLowerCase() ?? null;
  return commissions.filter((c) => {
    if (alyc && c.alyc.toLowerCase() !== alyc) return false;
    if (f.client && c.client_key !== f.client) return false;
    if (f.from && c.trade_date < f.from) return false;
    if (f.to && c.trade_date > f.to) return false;
    if (f.feeStatus === 'anomaly' && !isAnomaly(c.fee_status)) return false;
    if (f.feeStatus && f.feeStatus !== 'anomaly' && c.fee_status !== f.feeStatus) return false;
    if (q) {
      const hay = [c.client, c.instrument, c.operation, c.client_external_id]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export type CurrencyTotals = Record<string, number>;

function addTo(totals: CurrencyTotals, currency: string, value: number) {
  totals[currency] = (totals[currency] ?? 0) + value;
}

export type BreakdownRow = { key: string; label: string; totals: CurrencyTotals; rows: number };

export type ArancelesSummary = {
  totals: CurrencyTotals;
  rowCount: number;
  clientCount: number;
  alycCount: number;
  anomalyCount: number;
  byAlyc: BreakdownRow[];
  byClient: BreakdownRow[];
  byMonth: BreakdownRow[];
};

function breakdown(
  rows: readonly ArancelCommission[],
  keyOf: (c: ArancelCommission) => string,
  labelOf: (c: ArancelCommission) => string
): BreakdownRow[] {
  const map = new Map<string, BreakdownRow>();
  for (const c of rows) {
    const k = keyOf(c);
    let r = map.get(k);
    if (!r) {
      r = { key: k, label: labelOf(c), totals: {}, rows: 0 };
      map.set(k, r);
    }
    addTo(r.totals, c.currency, c.commission);
    r.rows += 1;
  }
  return [...map.values()];
}

/** Total "comparable" para ordenar: suma simple (ARS domina; sólo para ranking). */
function rankValue(t: CurrencyTotals): number {
  return Object.values(t).reduce((s, v) => s + v, 0);
}

export function summarize(rows: readonly ArancelCommission[]): ArancelesSummary {
  const totals: CurrencyTotals = {};
  const clients = new Set<string>();
  const alycs = new Set<string>();
  let anomalyCount = 0;
  for (const c of rows) {
    addTo(totals, c.currency, c.commission);
    clients.add(c.client_key);
    alycs.add(c.alyc.toLowerCase());
    if (isAnomaly(c.fee_status)) anomalyCount += 1;
  }
  return {
    totals,
    rowCount: rows.length,
    clientCount: clients.size,
    alycCount: alycs.size,
    anomalyCount,
    byAlyc: breakdown(rows, (c) => c.alyc.toLowerCase(), (c) => c.alyc).sort(
      (a, b) => rankValue(b.totals) - rankValue(a.totals)
    ),
    byClient: breakdown(rows, (c) => c.client_key, (c) => c.client)
      .sort((a, b) => rankValue(b.totals) - rankValue(a.totals))
      .slice(0, 50),
    byMonth: breakdown(rows, (c) => c.trade_date.slice(0, 7), (c) => c.trade_date.slice(0, 7))
      .sort((a, b) => b.key.localeCompare(a.key))
      .slice(0, 24),
  };
}

export function sortByDateDesc(rows: readonly ArancelCommission[]): ArancelCommission[] {
  return [...rows].sort(
    (a, b) => b.trade_date.localeCompare(a.trade_date) || b.id.localeCompare(a.id)
  );
}

const ANOMALY_ORDER: Partial<Record<FeeStatus, number>> = {
  missing: 0,
  zero: 1,
  min_on_large: 2,
  below_expected: 3,
};

export function listAnomalies(rows: readonly ArancelCommission[]): ArancelCommission[] {
  return rows
    .filter((c) => isAnomaly(c.fee_status))
    .sort(
      (a, b) =>
        (ANOMALY_ORDER[a.fee_status] ?? 9) - (ANOMALY_ORDER[b.fee_status] ?? 9) ||
        b.trade_date.localeCompare(a.trade_date)
    );
}

export function anomalySummary(rows: readonly ArancelCommission[]): { status: FeeStatus; count: number }[] {
  const counts = new Map<FeeStatus, number>();
  for (const c of rows) {
    if (!isAnomaly(c.fee_status)) continue;
    counts.set(c.fee_status, (counts.get(c.fee_status) ?? 0) + 1);
  }
  return [...counts.entries()].map(([status, count]) => ({ status, count }));
}

export function listAlycs(history: ArancelesHistory): { name: string; rows: number }[] {
  const map = new Map<string, { name: string; rows: number }>();
  for (const c of history.commissions) {
    const k = c.alyc.toLowerCase();
    const r = map.get(k) ?? { name: c.alyc, rows: 0 };
    r.rows += 1;
    map.set(k, r);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export function listClients(history: ArancelesHistory): { key: string; name: string }[] {
  const map = new Map<string, string>();
  for (const c of history.commissions) {
    if (!map.has(c.client_key)) map.set(c.client_key, c.client);
  }
  return [...map.entries()]
    .map(([key, name]) => ({ key, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}
