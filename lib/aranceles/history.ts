import { operationCategoryLabel } from '@/lib/aranceles/categories';
import {
  annotateFeeCurrencies,
  inferFeeSchedules,
  isAnomaly,
  recomputeAnomalies,
} from '@/lib/aranceles/fees';
import {
  ACDI_REISSUE_GAP,
  acdiPositionKey,
  alycKey,
  boletoNumber,
  contentFingerprint,
  contentKey,
  isAcdiReissueGap,
  reissueKey,
  currentAlycName,
  currentCurrency,
  fingerprintDifferences,
  idScope,
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
      ? inheritMissingProducers(collapseReissuedBoletos(
          r.commissions.map((c) => ({
            ...c,
            alyc: currentAlycName(c.alyc),
            currency: currentCurrency(c.currency),
            commission_currency: currentCurrency(c.commission_currency ?? c.currency),
            commission_fx: c.commission_fx ?? null,
            trading_group: c.trading_group ?? null,
            also_in_imports: Array.isArray(c.also_in_imports) ? c.also_in_imports : [],
          })),
          Array.isArray(r.imports) ? r.imports : []
        ))
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

/**
 * IEB a veces cambia el boleto de una operación.
 * - Títulos: misma cuenta, fecha, instrumento y arancel (el bruto de la orden puede cambiar), en dos
 *   importaciones. Queda la importación más nueva. Dos boletos dentro del mismo archivo se conservan:
 *   son dos operaciones.
 * - FCI: una posición por cuenta, día, fondo y moneda cuando los boletos son de series distintas
 *   (se distancian 100.000 o más). Pueden cambiar el arancel, la cantidad y el sufijo ARS/USD del fondo,
 *   y las dos copias pueden venir en el mismo archivo. Queda la serie que volvió en el archivo más nuevo;
 *   si se vieron juntas, la del boleto más alto. Dos boletos cercanos son dos suscripciones y se conservan.
 */
export function collapseReissuedBoletos(
  commissions: readonly ArancelCommission[],
  imports: readonly { id: string; imported_at: string }[]
): ArancelCommission[] {
  const importedAt = new Map(imports.map((i) => [i.id, i.imported_at]));
  const seenAt = (c: ArancelCommission) => {
    const times = [c.import_id, ...(c.also_in_imports ?? [])].map((id) => importedAt.get(id) ?? '');
    return times.reduce((max, t) => (t > max ? t : max), '');
  };
  const drop = new Set<string>();

  const groups = new Map<string, ArancelCommission[]>();
  for (const c of commissions) {
    if (alycKey(c.alyc) !== 'ieb' || !operationKey(c)) continue;
    const list = groups.get(reissueKey(c)) ?? [];
    list.push(c);
    groups.set(reissueKey(c), list);
  }
  for (const list of groups.values()) {
    const fileIds = new Set(list.map((c) => c.import_id));
    if (fileIds.size < 2) continue;
    const latest = [...fileIds].sort((a, b) => (importedAt.get(b) ?? '').localeCompare(importedAt.get(a) ?? ''))[0]!;
    for (const c of list) if (c.import_id !== latest) drop.add(c.id);
  }

  const positions = new Map<string, ArancelCommission[]>();
  for (const c of commissions) {
    if (drop.has(c.id)) continue;
    const key = acdiPositionKey(c);
    if (!key || !operationKey(c)) continue;
    const list = positions.get(key) ?? [];
    list.push(c);
    positions.set(key, list);
  }
  for (const list of positions.values()) {
    const byOp = new Map<string, { op: string; at: string; ids: string[]; rank: number }>();
    for (const c of list) {
      const op = operationKey(c)!;
      const e = byOp.get(op) ?? { op, at: '', ids: [], rank: boletoNumber(c.op_number) ?? 0 };
      const at = seenAt(c);
      if (at > e.at) e.at = at;
      e.ids.push(c.id);
      byOp.set(op, e);
    }
    if (byOp.size < 2) continue;
    const ops = [...byOp.values()].sort((a, b) => a.rank - b.rank);
    const series: (typeof ops)[] = [];
    for (const op of ops) {
      const current = series[series.length - 1];
      const prev = current?.[current.length - 1];
      if (current && prev && op.rank - prev.rank < ACDI_REISSUE_GAP) current.push(op);
      else series.push([op]);
    }
    if (series.length < 2) continue;
    const ranked = series
      .map((s) => ({
        at: s.reduce((max, e) => (e.at > max ? e.at : max), ''),
        rank: s[s.length - 1]!.rank,
        s,
      }))
      .sort((a, b) => b.at.localeCompare(a.at) || b.rank - a.rank);
    for (const loser of ranked.slice(1)) for (const e of loser.s) for (const id of e.ids) drop.add(id);
  }

  return drop.size === 0 ? [...commissions] : commissions.filter((c) => !drop.has(c.id));
}

/**
 * El Excel de IEB a veces deja vacío el productor en las filas en dólares.
 * Si la cuenta, en ese mes, tiene un solo productor en las otras filas, se lo copiamos.
 * Si en el mes no hay ninguna, se usa el productor cuando la cuenta tuvo uno solo en todo el historial.
 * Si tuvo más de uno, la fila sigue sin productor.
 */
export function inheritMissingProducers(commissions: readonly ArancelCommission[]): ArancelCommission[] {
  const byAccountMonth = new Map<string, Set<string>>();
  const byAccount = new Map<string, Set<string>>();
  const nameOf = new Map<string, string>();
  for (const c of commissions) {
    const numero = c.details?.productor_numero?.trim();
    const account = c.client_external_id?.trim();
    if (!numero || !account || !c.trade_date) continue;
    const accountKey = `${alycKey(c.alyc)}|${account}`;
    const monthKey = `${accountKey}|${c.trade_date.slice(0, 7)}`;
    const inMonth = byAccountMonth.get(monthKey) ?? new Set<string>();
    inMonth.add(numero);
    byAccountMonth.set(monthKey, inMonth);
    const ever = byAccount.get(accountKey) ?? new Set<string>();
    ever.add(numero);
    byAccount.set(accountKey, ever);
    const name = c.details?.productor?.trim();
    if (name && !nameOf.has(numero)) nameOf.set(numero, name);
  }
  let changed = false;
  const next = commissions.map((c) => {
    if (c.details?.productor_numero?.trim() || !c.client_external_id?.trim() || !c.trade_date) return c;
    const accountKey = `${alycKey(c.alyc)}|${c.client_external_id.trim()}`;
    const inMonth = byAccountMonth.get(`${accountKey}|${c.trade_date.slice(0, 7)}`);
    const ever = byAccount.get(accountKey);
    const numero = inMonth?.size === 1 ? [...inMonth][0]! : ever?.size === 1 ? [...ever][0]! : null;
    if (!numero) return c;
    changed = true;
    return {
      ...c,
      details: {
        ...c.details,
        productor_numero: numero,
        productor: c.details?.productor?.trim() || nameOf.get(numero) || c.details?.productor || '',
      },
    };
  });
  return changed ? next : [...commissions];
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
  /**
   * Operaciones ya cargadas que este archivo actualizó: la fecha de un ACDI, o el boleto
   * nuevo de una operación reemitida. No se duplican.
   */
  updated: number;
};

/**
 * Agrega las filas al historial sin duplicar (ver dedup.ts):
 * - mismo número de operación y mismos datos → ya estaba: no se agrega y se anota este archivo como
 *   otra fuente de la operación;
 * - mismo número con datos distintos → conflicto: no se agrega ni se pisa, se informa.
 *   Excepción ACDI: esas planillas antes no traían fecha. El mismo ID se actualiza con el año y mes nuevos;
 * - otro número, pero misma cuenta, fecha, instrumento y arancel (aunque cambie el bruto) → es la misma operación
 *   de títulos. Queda una fila: se le escribe el boleto y el bruto nuevos, para que un archivo posterior la encuentre;
 * - FCI con otro boleto de otra serie (a 100.000 o más) para la misma cuenta, día, fondo y moneda → es la misma
 *   posición. El archivo nuevo la reemplaza. Si las dos copias vienen en este archivo, queda el boleto más alto.
 *   Dos boletos cercanos son dos suscripciones y se guardan las dos;
 * - línea repetida dentro del mismo archivo → se guarda una sola vez.
 * No recalcula tarifas: llamar a `runFeeAnalysis` después.
 */
export function applyImport(history: ArancelesHistory, input: ApplyImportInput): ApplyImportResult {
  const alyc = canonicalAlycName(history, input.alyc);
  const segment = input.segment ?? null;

  const byOperation = new Map<string, ArancelCommission[]>();
  const byContent = new Map<string, ArancelCommission[]>();
  /** Operaciones ya guardadas, por contenido. Sirve para reconocer la misma operación con otro boleto. */
  const byFingerprint = new Map<string, ArancelCommission[]>();
  /** Una posición de FCI ya guardada o aceptada en este archivo. */
  const byPosition = new Map<string, ArancelCommission>();
  for (const c of history.commissions) {
    const op = operationKey(c);
    if (op) {
      byOperation.set(op, [...(byOperation.get(op) ?? []), c]);
      const fp = reissueKey(c);
      byFingerprint.set(fp, [...(byFingerprint.get(fp) ?? []), c]);
    } else byContent.set(contentKey(c), [...(byContent.get(contentKey(c)) ?? []), c]);
    const pos = acdiPositionKey(c);
    if (pos) byPosition.set(pos, c);
  }

  const boletoRank = (op: string | null | undefined) => boletoNumber(op) ?? 0;

  const reindexOp = (prev: ArancelCommission, oldOp: string | null) => {
    if (oldOp) byOperation.set(oldOp, (byOperation.get(oldOp) ?? []).filter((x) => x.id !== prev.id));
    const newOp = operationKey(prev);
    if (newOp) byOperation.set(newOp, [...(byOperation.get(newOp) ?? []), prev]);
  };

  const reindexFingerprint = (prev: ArancelCommission, oldFp: string) => {
    const newFp = reissueKey(prev);
    if (oldFp === newFp) return;
    byFingerprint.set(oldFp, (byFingerprint.get(oldFp) ?? []).filter((x) => x.id !== prev.id));
    byFingerprint.set(newFp, [...(byFingerprint.get(newFp) ?? []), prev]);
  };

  /** El archivo que llega pisa la posición de FCI. No se abre una segunda fila. */
  const replacePosition = (prev: ArancelCommission, incoming: ArancelCommission) => {
    const oldOp = operationKey(prev);
    const oldPos = acdiPositionKey(prev);
    const oldFp = reissueKey(prev);
    prev.op_number = incoming.op_number;
    prev.client = incoming.client;
    prev.client_key = incoming.client_key;
    prev.client_external_id = incoming.client_external_id;
    prev.account_officer = incoming.account_officer ?? prev.account_officer;
    prev.trade_date = incoming.trade_date;
    prev.settlement_date = incoming.settlement_date;
    prev.instrument = incoming.instrument;
    prev.operation = incoming.operation;
    prev.quantity = incoming.quantity;
    prev.amount = incoming.amount;
    prev.commission = incoming.commission;
    prev.commission_pct = incoming.commission_pct;
    prev.currency = incoming.currency;
    prev.commission_currency = incoming.commission_currency;
    prev.imported_status = incoming.imported_status;
    prev.fee_status = incoming.fee_status;
    prev.is_min_fee = incoming.is_min_fee;
    if (incoming.details) prev.details = { ...prev.details, ...incoming.details };
    reindexOp(prev, oldOp);
    reindexFingerprint(prev, oldFp);
    if (oldPos && oldPos !== acdiPositionKey(prev) && byPosition.get(oldPos)?.id === prev.id) byPosition.delete(oldPos);
    const newPos = acdiPositionKey(prev);
    if (newPos) byPosition.set(newPos, prev);
  };

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
  let updatedRows = 0;

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
      if (idScope(prev.segment) === 'acdi' && idScope(c.segment) === 'acdi') {
        replacePosition(prev, c);
        alsoIn.add(prev.id);
        updatedRows += 1;
        return;
      }
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
    const pos = acdiPositionKey(c);
    const positioned = pos ? byPosition.get(pos) : undefined;
    if (positioned && operationKey(positioned) !== op && isAcdiReissueGap(positioned.op_number, c.op_number)) {
      const inThisFile = positioned.import_id === importId;
      if (!inThisFile || boletoRank(c.op_number) > boletoRank(positioned.op_number)) replacePosition(positioned, c);
      if (inThisFile) repeatedInFile += 1;
      else {
        alsoIn.add(positioned.id);
        updatedRows += 1;
      }
      return;
    }
    const twin =
      !pos && alycKey(c.alyc) === 'ieb'
        ? (byFingerprint.get(reissueKey(c)) ?? []).find((e) => operationKey(e) !== op)
        : undefined;
    if (twin) {
      const oldOp = operationKey(twin);
      const oldFp = reissueKey(twin);
      twin.op_number = c.op_number;
      twin.amount = c.amount;
      reindexOp(twin, oldOp);
      reindexFingerprint(twin, oldFp);
      alsoIn.add(twin.id);
      updatedRows += 1;
      return;
    }
    insertedOps.add(op);
    commissions.push(c);
    if (pos) byPosition.set(pos, c);
    byOperation.set(op, [...(byOperation.get(op) ?? []), c]);
  });

  if (input.rows.length === 0) {
    return { history, importRecord: null, inserted: 0, duplicates, repeatedInFile, conflicts, enriched: 0, updated: updatedRows };
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
      commissions: inheritMissingProducers(
        collapseReissuedBoletos([...updated, ...commissions], [...history.imports, importRecord])
      ),
    },
    importRecord,
    inserted: commissions.length,
    duplicates,
    repeatedInFile,
    conflicts,
    enriched: enrich.size,
    updated: updatedRows,
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
