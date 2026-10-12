import { operationCategoryLabel } from '@/lib/aranceles/categories';
import {
  annotateFeeCurrencies,
  inferFeeSchedules,
  isAnomaly,
  recomputeAnomalies,
} from '@/lib/aranceles/fees';
import {
  alycKey,
  contentFingerprint,
  contentKey,
  currentAlycName,
  currentCurrency,
  fingerprintDifferences,
  normalizeOpNumber,
  operationKey,
  type DedupConflict,
} from '@/lib/aranceles/dedup';
import { coerceSettings } from '@/lib/aranceles/settings';
import { detectTradingGroups } from '@/lib/aranceles/trading';
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
    imports: Array.isArray(r.imports) ? r.imports.map((i) => ({ ...i, alyc: currentAlycName(i.alyc) })) : [],
    commissions: Array.isArray(r.commissions)
      ? r.commissions.map((c) => ({
          ...c,
          alyc: currentAlycName(c.alyc),
          currency: currentCurrency(c.currency),
          commission_currency: currentCurrency(c.commission_currency ?? c.currency),
          commission_fx: c.commission_fx ?? null,
          trading_group: c.trading_group ?? null,
          also_in_imports: Array.isArray(c.also_in_imports) ? c.also_in_imports : [],
        }))
      : [],
    fee_schedules: Array.isArray(r.fee_schedules)
      ? r.fee_schedules.map((s) => ({ ...s, alyc: currentAlycName(s.alyc), currency: currentCurrency(s.currency) }))
      : [],
    drive_files:
      r.drive_files && typeof r.drive_files === 'object' && !Array.isArray(r.drive_files)
        ? r.drive_files
        : {},
    settings: coerceSettings(r.settings),
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

/** Reusa el nombre ya guardado si es la misma ALYC escrita distinto ("Gma " → "GMA", "ESCO" → "GMA"). */
export function canonicalAlycName(history: ArancelesHistory, alyc: string): string {
  const trimmed = currentAlycName(alyc.trim()) || 'ALYC sin nombre';
  const key = alycKey(trimmed);
  return history.commissions.find((c) => alycKey(c.alyc) === key)?.alyc
    ?? history.imports.find((i) => alycKey(i.alyc) === key)?.alyc
    ?? trimmed;
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
  repeatedInFile: number;
  conflicts: DedupConflict[];
  /** Operaciones ya cargadas a las que este archivo les completó datos de detalle. */
  enriched: number;
};

/**
 * Agrega las filas al historial sin duplicar (ver dedup.ts):
 * - mismo número de operación y mismos datos → ya estaba: no se agrega y se anota este archivo como
 *   otra fuente de la operación;
 * - mismo número con datos distintos → conflicto: no se agrega ni se pisa, se informa;
 * - línea repetida dentro del mismo archivo → se guarda una sola vez.
 * No recalcula tarifas: llamar a `runFeeAnalysis` después.
 */
export function applyImport(history: ArancelesHistory, input: ApplyImportInput): ApplyImportResult {
  const alyc = canonicalAlycName(history, input.alyc);
  const segment = input.segment ?? null;

  const byOperation = new Map<string, ArancelCommission[]>();
  const byContent = new Map<string, ArancelCommission[]>();
  for (const c of history.commissions) {
    const op = operationKey(c);
    if (op) byOperation.set(op, [...(byOperation.get(op) ?? []), c]);
    else byContent.set(contentKey(c), [...(byContent.get(contentKey(c)) ?? []), c]);
  }

  const importId = newId('imp');
  const commissions: ArancelCommission[] = [];
  const alsoIn = new Set<string>();
  const seenInFile = new Set<string>();
  const insertedOps = new Set<string>();
  const contentUsed = new Map<string, number>();
  const conflicts: DedupConflict[] = [];
  /** Datos de detalle (p. ej. productor) que traía el archivo y le faltaban a la operación ya cargada. */
  const enrich = new Map<string, Record<string, string>>();
  let duplicates = 0;
  let repeatedInFile = 0;

  const built = input.rows.map((row, i) => {
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
      commission_currency: row.currency,
      commission_fx: null,
      imported_status: row.feeStatus,
      fee_status: row.feeStatus,
      expected_commission: null,
      op_number: normalizeOpNumber(row.opNumber),
      segment,
      is_min_fee: row.isMinFee,
      trading_group: null,
      also_in_imports: [],
      ...(row.details && Object.keys(row.details).length ? { details: row.details } : {}),
    };
    return c;
  });

  // Un mismo n° con datos distintos dentro del archivo es ambiguo (columna de id mal leída o
  // archivo corrupto): no se importa ninguna de esas filas.
  const fileVariants = new Map<string, { first: ArancelCommission; fps: Set<string> }>();
  for (const c of built) {
    const op = operationKey(c);
    if (!op) continue;
    const v = fileVariants.get(op) ?? { first: c, fps: new Set<string>() };
    v.fps.add(contentFingerprint(c));
    fileVariants.set(op, v);
  }

  built.forEach((c) => {
    const op = operationKey(c);
    const variants = op ? fileVariants.get(op) : undefined;
    if (variants && variants.fps.size > 1) {
      conflicts.push({
        op_number: c.op_number ?? '',
        client: c.client,
        trade_date: c.trade_date,
        differences: [
          'n° repetido en el mismo archivo con datos distintos',
          ...fingerprintDifferences(variants.first, c),
        ],
        existing_commission: variants.first.commission,
        incoming_commission: c.commission,
        existing_import_id: '',
      });
      return;
    }

    if (!op) {
      const ck = contentKey(c);
      const existing = byContent.get(ck) ?? [];
      const used = contentUsed.get(ck) ?? 0;
      const match = existing[used];
      if (match) {
        contentUsed.set(ck, used + 1);
        alsoIn.add(match.id);
        duplicates += 1;
        return;
      }
      commissions.push(c);
      return;
    }

    const fp = contentFingerprint(c);
    if (seenInFile.has(`${op}|${fp}`)) {
      repeatedInFile += 1;
      return;
    }
    seenInFile.add(`${op}|${fp}`);

    const existing = byOperation.get(op) ?? [];
    const same = existing.find((e) => contentFingerprint(e) === fp);
    if (same) {
      alsoIn.add(same.id);
      duplicates += 1;
      const missing = Object.entries(c.details ?? {}).filter(([k, v]) => v && !same.details?.[k]);
      if (missing.length) enrich.set(same.id, { ...enrich.get(same.id), ...Object.fromEntries(missing) });
      return;
    }
    if (existing.length > 0 && !insertedOps.has(op)) {
      const prev = existing[0]!;
      conflicts.push({
        op_number: c.op_number ?? '',
        client: c.client,
        trade_date: c.trade_date,
        differences: fingerprintDifferences(prev, c),
        existing_commission: prev.commission,
        incoming_commission: c.commission,
        existing_import_id: prev.import_id,
      });
      return;
    }
    insertedOps.add(op);
    commissions.push(c);
  });

  if (input.rows.length === 0) {
    return { history, importRecord: null, inserted: 0, duplicates, repeatedInFile, conflicts, enriched: 0 };
  }

  const importRecord: ArancelImport = {
    id: importId,
    alyc,
    filename: input.filename,
    format: input.format ?? null,
    segment,
    period_label: input.periodLabel ?? null,
    notes: input.notes ?? null,
    row_count: commissions.length,
    duplicate_count: duplicates,
    repeated_in_file: repeatedInFile,
    conflicts,
    imported_at: new Date().toISOString(),
    source: input.source ?? 'manual',
    drive_file_id: input.driveFileId ?? null,
    drive_modified_time: input.driveModifiedTime ?? null,
  };

  const updated = history.commissions.map((c) => {
    if (!alsoIn.has(c.id)) return c;
    const extra = enrich.get(c.id);
    return {
      ...c,
      also_in_imports: [...(c.also_in_imports ?? []), importId],
      ...(extra ? { details: { ...c.details, ...extra } } : {}),
    };
  });

  return {
    history: {
      ...history,
      imports: [...history.imports, importRecord],
      commissions: [...updated, ...commissions],
    },
    importRecord,
    inserted: commissions.length,
    duplicates,
    repeatedInFile,
    conflicts,
    enriched: enrich.size,
  };
}

/**
 * Saca las importaciones del historial. Una operación que también venía en otro archivo no se borra:
 * pasa a depender de ese otro archivo.
 */
export function removeImports(history: ArancelesHistory, importIds: readonly string[]): ArancelesHistory {
  if (importIds.length === 0) return history;
  const drop = new Set(importIds);
  const commissions: ArancelCommission[] = [];
  for (const c of history.commissions) {
    const others = (c.also_in_imports ?? []).filter((id) => !drop.has(id));
    if (!drop.has(c.import_id)) {
      commissions.push(others.length === (c.also_in_imports ?? []).length ? c : { ...c, also_in_imports: others });
      continue;
    }
    const [next, ...rest] = others;
    if (next) commissions.push({ ...c, import_id: next, also_in_imports: rest });
  }
  return {
    ...history,
    imports: history.imports.filter((i) => !drop.has(i.id)),
    commissions,
  };
}

/** Operaciones que hoy dependen de cada importación (propias + compartidas con otros archivos). */
export function importUsage(history: ArancelesHistory): Record<string, { own: number; shared: number }> {
  const out: Record<string, { own: number; shared: number }> = {};
  for (const c of history.commissions) {
    const others = c.also_in_imports ?? [];
    const ownEntry = (out[c.import_id] ??= { own: 0, shared: 0 });
    if (others.length) ownEntry.shared += 1;
    else ownEntry.own += 1;
    for (const id of others) (out[id] ??= { own: 0, shared: 0 }).shared += 1;
  }
  return out;
}

/** Recalcula tarifas inferidas y estados de arancel sobre todo el historial. */
export function runFeeAnalysis(history: ArancelesHistory): ArancelesHistory {
  const gmaImportIds = new Set(history.imports.filter((i) => i.format === 'gma').map((i) => i.id));
  const annotated = annotateFeeCurrencies(history.commissions, gmaImportIds);
  const fee_schedules = inferFeeSchedules(annotated, history.fee_schedules);
  const commissions = detectTradingGroups(
    recomputeAnomalies(annotated, fee_schedules, gmaImportIds),
    gmaImportIds
  );
  return { ...history, fee_schedules, commissions };
}

// ─── Consultas ──────────────────────────────────────────

/** Meses con operaciones ("AAAA-MM"), del más reciente al más viejo. */
export function listMonths(commissions: readonly Pick<ArancelCommission, 'trade_date'>[]): string[] {
  return [...new Set(commissions.map((c) => c.trade_date.slice(0, 7)))].sort((a, b) => b.localeCompare(a));
}

export function filterCommissions<T extends ArancelCommission>(
  commissions: readonly T[],
  f: CommissionFilters
): T[] {
  const q = f.q ? clientKey(f.q) : '';
  const alyc = f.alyc?.toLowerCase() ?? null;
  return commissions.filter((c) => {
    if (alyc && c.alyc.toLowerCase() !== alyc) return false;
    if (f.client && c.client_key !== f.client) return false;
    if (f.from && c.trade_date.slice(0, f.from.length) < f.from) return false;
    if (f.to && c.trade_date.slice(0, f.to.length) > f.to) return false;
    if (f.feeStatus === 'anomaly' && !isAnomaly(c.fee_status)) return false;
    if (f.feeStatus && f.feeStatus !== 'anomaly' && c.fee_status !== f.feeStatus) return false;
    if (q) {
      const hay = clientKey(
        [
          c.client,
          c.instrument,
          c.operation,
          operationCategoryLabel(c.operation),
          c.client_external_id,
          c.op_number,
          c.trading_group ? 'posible trading' : null,
        ]
          .filter(Boolean)
          .join(' ')
      );
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

export function breakdown<T extends ArancelCommission>(
  rows: readonly T[],
  keyOf: (c: T) => string,
  labelOf: (c: T) => string
): BreakdownRow[] {
  const map = new Map<string, BreakdownRow>();
  for (const c of rows) {
    const k = keyOf(c);
    let r = map.get(k);
    if (!r) {
      r = { key: k, label: labelOf(c), totals: {}, rows: 0 };
      map.set(k, r);
    }
    addTo(r.totals, c.commission_currency, c.commission);
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
    addTo(totals, c.commission_currency, c.commission);
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

export function sortByDateDesc<T extends ArancelCommission>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) => b.trade_date.localeCompare(a.trade_date) || b.id.localeCompare(a.id)
  );
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
