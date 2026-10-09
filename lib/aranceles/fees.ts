import { GMA_LARGE_NOTIONAL, GMA_MIN_FEES, isGmaMinFee } from '@/lib/aranceles/mappers/gma';
import {
  ANOMALY_STATUSES,
  type ArancelCommission,
  type FeeSchedule,
  type FeeStatus,
} from '@/lib/aranceles/types';

const SCHEDULE_PERCENTS = [0.2, 0.5, 1.0];
const TRADING_OPS = new Set(['COMPRA', 'VENTA', 'PUBLICO', 'PRIVADO']);

function near(a: number, b: number, tol = 0.03) {
  return Math.abs(a - b) <= tol;
}

function scheduleKey(alyc: string, clientKey: string, currency: string) {
  return `${alyc.toLowerCase()}|${clientKey}|${currency}`;
}

type Bucket = {
  alyc: string;
  client: string;
  client_key: string;
  currency: string;
  counts: Map<number, number>;
};

/**
 * Infiere tarifas fijas / % por ALYC + cliente + moneda a partir del historial.
 * Conserva las tarifas manuales y reemplaza las inferidas.
 */
export function inferFeeSchedules(
  commissions: readonly ArancelCommission[],
  existing: readonly FeeSchedule[],
  now = new Date().toISOString()
): FeeSchedule[] {
  const fixed = new Map<string, Bucket>();
  const pct = new Map<string, Bucket>();

  const bump = (
    target: Map<string, Bucket>,
    c: ArancelCommission,
    value: number
  ) => {
    const k = scheduleKey(c.alyc, c.client_key, c.currency);
    let b = target.get(k);
    if (!b) {
      b = { alyc: c.alyc, client: c.client, client_key: c.client_key, currency: c.currency, counts: new Map() };
      target.set(k, b);
    }
    b.counts.set(value, (b.counts.get(value) ?? 0) + 1);
  };

  for (const c of commissions) {
    if (c.imported_status === 'skipped' || c.imported_status === 'missing') continue;
    const p = c.commission_pct;
    const cur = c.currency === 'USD_C' ? 'USD' : c.currency;

    if (c.commission > 0 && c.commission < 1000) {
      const looksMin =
        isGmaMinFee(c.currency, c.commission) ||
        isGmaMinFee(cur, c.commission) ||
        (p != null && p < 0.05 && c.commission <= 50);
      const looksFixedBlankPct = p == null || Math.abs(p) < 0.0001;
      if (looksMin || looksFixedBlankPct) {
        bump(fixed, c, Math.round(c.commission * 100) / 100);
      }
    }

    if (p != null && p > 0.05) {
      const schedule = SCHEDULE_PERCENTS.find((s) => near(p, s, 0.02));
      const value = schedule ?? Math.round(p * 100) / 100;
      if (schedule || p >= 0.1) bump(pct, c, value);
    }
  }

  const inferred: FeeSchedule[] = [];
  const emit = (buckets: Map<string, Bucket>, feeType: 'fixed' | 'percent') => {
    for (const b of buckets.values()) {
      const ranked = [...b.counts.entries()].sort((x, y) => y[1] - x[1]);
      const top = ranked[0];
      if (!top || top[1] < 2) continue;
      const total = ranked.reduce((s, [, n]) => s + n, 0);
      const knownMin = GMA_MIN_FEES[b.currency];
      const notes =
        feeType === 'fixed'
          ? knownMin != null && Math.abs(top[0] - knownMin) < 0.05
            ? `Mínimo observado ${top[0]} ${b.currency} (${top[1]}/${total})`
            : `Fijo modal ${top[0]} (${top[1]}/${total})`
          : `% cartilla modal ${top[0]} (${top[1]}/${total})`;
      inferred.push({
        id: `inf:${scheduleKey(b.alyc, b.client_key, b.currency)}:${feeType}`,
        alyc: b.alyc,
        client: b.client,
        client_key: b.client_key,
        currency: b.currency,
        fee_type: feeType,
        amount: top[0],
        source: 'inferred',
        confidence: total > 0 ? top[1] / total : 0,
        sample_count: top[1],
        notes,
        updated_at: now,
      });
    }
  };
  emit(fixed, 'fixed');
  emit(pct, 'percent');

  const manual = existing.filter((s) => s.source === 'manual');
  return [...manual, ...inferred].sort(
    (a, b) =>
      a.client.localeCompare(b.client, 'es') ||
      a.alyc.localeCompare(b.alyc, 'es') ||
      a.currency.localeCompare(b.currency) ||
      a.fee_type.localeCompare(b.fee_type)
  );
}

/**
 * Recalcula fee_status / expected_commission con las tarifas y las heurísticas GMA
 * (mínimo en notional alto, faltantes inesperados). Devuelve nuevas filas.
 */
export function recomputeAnomalies(
  commissions: readonly ArancelCommission[],
  schedules: readonly FeeSchedule[],
  /** Importaciones en formato GMA/ESCO: sólo a esas se les aplican los mínimos GMA. */
  gmaImportIds: ReadonlySet<string> = new Set()
): ArancelCommission[] {
  const ordered = [...schedules].sort((a, b) => {
    if (a.source !== b.source) return a.source === 'manual' ? -1 : 1;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });
  const fixedBy = new Map<string, number>();
  const pctBy = new Map<string, number>();
  for (const s of ordered) {
    const k = scheduleKey(s.alyc, s.client_key, s.currency);
    if (s.fee_type === 'fixed' && !fixedBy.has(k)) fixedBy.set(k, s.amount);
    if (s.fee_type === 'percent' && !pctBy.has(k)) pctBy.set(k, s.amount);
  }

  return commissions.map((c) => {
    if (c.imported_status === 'skipped') {
      return { ...c, fee_status: 'skipped' as FeeStatus, expected_commission: null };
    }

    const isGma = gmaImportIds.has(c.import_id);
    const k = scheduleKey(c.alyc, c.client_key, c.currency);
    const expectedFixed = fixedBy.get(k) ?? (isGma ? GMA_MIN_FEES[c.currency] : undefined) ?? null;
    const expectedPct = pctBy.get(k) ?? null;
    const absGross = c.amount != null ? Math.abs(c.amount) : null;
    const op = (c.operation ?? '').toUpperCase();
    const isTrading = TRADING_OPS.has(op) || op.includes('COMPRA') || op.includes('VENTA');

    let status: FeeStatus = 'ok';
    let expected: number | null = expectedFixed;

    if (c.imported_status === 'missing') {
      status = !isTrading && op.startsWith('AP') ? 'skipped' : 'missing';
    } else if (c.commission === 0) {
      status = 'zero';
    } else {
      const minFee = isGma && isGmaMinFee(c.currency, c.commission);
      if (minFee && absGross != null && absGross > GMA_LARGE_NOTIONAL && isTrading) {
        status = 'min_on_large';
        expected =
          expectedPct != null && absGross > 0 ? (absGross * expectedPct) / 100 : expectedFixed;
      } else if (
        expectedFixed != null &&
        expectedFixed > 0 &&
        (c.commission_pct == null || Math.abs(c.commission_pct) < 0.05) &&
        c.commission + 0.005 < expectedFixed
      ) {
        status = 'below_expected';
        expected = expectedFixed;
      } else if (
        expectedPct != null &&
        absGross != null &&
        absGross > 0 &&
        c.commission_pct != null &&
        c.commission_pct + 0.05 < expectedPct * 0.5
      ) {
        status = 'below_expected';
        expected = (absGross * expectedPct) / 100;
      }
    }

    return { ...c, fee_status: status, expected_commission: expected };
  });
}

export function isAnomaly(status: FeeStatus): boolean {
  return ANOMALY_STATUSES.includes(status);
}
