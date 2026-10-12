import { compareFeeTypeLabels } from '@/lib/aranceles/fee-types';
import {
  SEGMENT_DIMENSIONS,
  SEGMENT_LABEL,
  SIN_ASIGNAR,
  SIN_ASIGNAR_LABEL,
  type ArancelSegment,
  type SegmentDimension,
} from '@/lib/aranceles/segments';
import type { ArancelCommission } from '@/lib/aranceles/types';

export type PeriodGranularity = 'month' | 'quarter' | 'year';

export const PERIOD_GRANULARITIES: readonly PeriodGranularity[] = ['month', 'quarter', 'year'];

export function parseGranularity(raw: string | null | undefined): PeriodGranularity {
  return PERIOD_GRANULARITIES.includes(raw as PeriodGranularity) ? (raw as PeriodGranularity) : 'month';
}

/** '2026-03-15' → '2026-03' | '2026-T1' | '2026'. Las claves ordenan cronológicamente como texto. */
export function periodKey(isoDate: string, g: PeriodGranularity): string {
  const year = isoDate.slice(0, 4);
  if (g === 'year') return year;
  const month = Number(isoDate.slice(5, 7));
  if (g === 'quarter') return `${year}-T${Math.ceil(month / 3)}`;
  return isoDate.slice(0, 7);
}

type Totals = Record<string, number>;

function add(totals: Totals, currency: string, value: number) {
  totals[currency] = (totals[currency] ?? 0) + value;
}

/** ARS primero, después el resto alfabético. */
export function sortCurrencies(currencies: Iterable<string>): string[] {
  return [...new Set(currencies)].sort((a, b) =>
    a === 'ARS' ? -1 : b === 'ARS' ? 1 : a.localeCompare(b)
  );
}

/** Dimensión de las columnas de la tabla por período. */
export type ReportGroupBy = 'alyc' | SegmentDimension;

export const REPORT_GROUP_BY: readonly ReportGroupBy[] = ['alyc', ...SEGMENT_DIMENSIONS];

export const REPORT_GROUP_LABEL: Record<ReportGroupBy, string> = { alyc: 'ALYC', ...SEGMENT_LABEL };

export function parseGroupBy(raw: string | null | undefined): ReportGroupBy {
  return REPORT_GROUP_BY.includes(raw as ReportGroupBy) ? (raw as ReportGroupBy) : 'alyc';
}

type GroupableCommission = ArancelCommission & Partial<ArancelSegment>;

function groupOf(c: GroupableCommission, by: ReportGroupBy): { key: string; label: string } {
  if (by === 'alyc') return { key: c.alyc.toLowerCase(), label: c.alyc };
  const v = c[by] ?? null;
  return v ? { key: v.toLowerCase(), label: v } : { key: SIN_ASIGNAR, label: SIN_ASIGNAR_LABEL };
}

export type BrokerColumn = {
  key: string;
  groupKey: string;
  group: string;
  /** ALYC dentro del grupo cuando se agrupa por manager / advisor / grupo asesor; null si el grupo ya es la ALYC. */
  alyc: string | null;
  currency: string;
};

export type BrokerPeriodRow = {
  period: string;
  rows: number;
  cells: Record<string, number>;
  totals: Totals;
};

export type BrokerPeriodReport = {
  columns: BrokerColumn[];
  currencies: string[];
  periods: BrokerPeriodRow[];
  columnTotals: Record<string, number>;
  totals: Totals;
  rows: number;
};

export function brokerColumnKey(group: string, currency: string): string {
  return `${group.toLowerCase()}|${currency}`;
}

/**
 * Aranceles por período (filas) × grupo y moneda del arancel (columnas). El grupo es la ALYC o una
 * categoría del mapping de cuentas; en ese caso cada grupo se abre además por ALYC.
 * Períodos del más reciente al más viejo.
 */
export function buildBrokerPeriodReport(
  commissions: readonly GroupableCommission[],
  g: PeriodGranularity,
  groupBy: ReportGroupBy = 'alyc'
): BrokerPeriodReport {
  const columns = new Map<string, BrokerColumn>();
  const periods = new Map<string, BrokerPeriodRow>();
  const columnTotals: Record<string, number> = {};
  const totals: Totals = {};

  for (const c of commissions) {
    const cur = c.commission_currency;
    const grp = groupOf(c, groupBy);
    const alyc = groupBy === 'alyc' ? null : c.alyc;
    const colKey = brokerColumnKey(alyc ? `${grp.key}|${alyc}` : grp.key, cur);
    if (!columns.has(colKey)) {
      columns.set(colKey, { key: colKey, groupKey: grp.key, group: grp.label, alyc, currency: cur });
    }

    const pk = periodKey(c.trade_date, g);
    let row = periods.get(pk);
    if (!row) {
      row = { period: pk, rows: 0, cells: {}, totals: {} };
      periods.set(pk, row);
    }
    row.rows += 1;
    row.cells[colKey] = (row.cells[colKey] ?? 0) + c.commission;
    add(row.totals, cur, c.commission);
    columnTotals[colKey] = (columnTotals[colKey] ?? 0) + c.commission;
    add(totals, cur, c.commission);
  }

  const currencies = sortCurrencies([...columns.values()].map((col) => col.currency));
  const curOrder = new Map(currencies.map((cur, i) => [cur, i]));
  return {
    columns: [...columns.values()].sort(
      (a, b) =>
        Number(a.groupKey === SIN_ASIGNAR) - Number(b.groupKey === SIN_ASIGNAR) ||
        (groupBy === 'tipo' ? compareFeeTypeLabels(a.group, b.group) : a.group.localeCompare(b.group, 'es')) ||
        (a.alyc ?? '').localeCompare(b.alyc ?? '', 'es') ||
        (curOrder.get(a.currency) ?? 0) - (curOrder.get(b.currency) ?? 0)
    ),
    currencies,
    periods: [...periods.values()].sort((a, b) => b.period.localeCompare(a.period)),
    columnTotals,
    totals,
    rows: commissions.length,
  };
}

export type ClientPeriodRow = {
  key: string;
  name: string;
  rows: number;
  byPeriod: Record<string, Totals>;
  total: Totals;
};

export type ClientPeriodReport = {
  /** Cronológicos (más viejo a la izquierda) para poder leer el acumulado. */
  periods: string[];
  currencies: string[];
  clients: ClientPeriodRow[];
  periodTotals: Record<string, Totals>;
  totals: Totals;
};

/** Aranceles de cada cliente por período, con el total acumulado del rango. */
export function buildClientPeriodReport(
  commissions: readonly ArancelCommission[],
  g: PeriodGranularity
): ClientPeriodReport {
  const clients = new Map<string, ClientPeriodRow>();
  const periodTotals: Record<string, Totals> = {};
  const totals: Totals = {};
  const currencies = new Set<string>();

  for (const c of commissions) {
    const cur = c.commission_currency;
    currencies.add(cur);
    const pk = periodKey(c.trade_date, g);
    let row = clients.get(c.client_key);
    if (!row) {
      row = { key: c.client_key, name: c.client, rows: 0, byPeriod: {}, total: {} };
      clients.set(c.client_key, row);
    }
    row.rows += 1;
    add((row.byPeriod[pk] ??= {}), cur, c.commission);
    add(row.total, cur, c.commission);
    add((periodTotals[pk] ??= {}), cur, c.commission);
    add(totals, cur, c.commission);
  }

  return {
    periods: Object.keys(periodTotals).sort(),
    currencies: sortCurrencies(currencies),
    clients: [...clients.values()].sort((a, b) => a.name.localeCompare(b.name, 'es')),
    periodTotals,
    totals,
  };
}

/** Suma corrida período a período (para mostrar el acumulado en cada columna). */
export function runningTotals(periods: readonly string[], byPeriod: Record<string, Totals>): Record<string, Totals> {
  const out: Record<string, Totals> = {};
  const acc: Totals = {};
  for (const p of periods) {
    for (const [cur, v] of Object.entries(byPeriod[p] ?? {})) add(acc, cur, v);
    out[p] = { ...acc };
  }
  return out;
}
