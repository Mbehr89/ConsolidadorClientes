import type { BondPaymentEvent, BondYieldMetrics } from './types';

const MS_PER_DAY = 86400000;
const TOL_REL = 1e-9;
const MAX_ITER = 200;

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function yearsAct365(from: Date, to: Date): number {
  const a = utcMidnight(from).getTime();
  const b = utcMidnight(to).getTime();
  return (b - a) / (365 * MS_PER_DAY);
}

function flowUsd(
  e: BondPaymentEvent,
  nominal: number,
  usdArsFxRate: number
): number {
  const base = (e.flowPer100 / 100) * nominal;
  const c = e.currency.toUpperCase();
  if (c.includes('ARS') || c.includes('PESO')) {
    if (usdArsFxRate <= 0) return base;
    return base / usdArsFxRate;
  }
  return base;
}

function npvFlows(
  flows: { t: number; amt: number }[],
  y: number
): number {
  let s = 0;
  for (const { t, amt } of flows) {
    if (t < 0) continue;
    s += amt / (1 + y) ** t;
  }
  return s;
}

/**
 * Resuelve y > -1 tal que sum(amt/(1+y)^t) = targetValue.
 */
export function solveAnnualEffectiveYield(
  flows: { t: number; amt: number }[],
  targetValue: number
): number | null {
  if (flows.length === 0 || targetValue <= 0) return null;

  // Bracketing robusto: permite TIR negativa (y > -1).
  const loFloor = -0.999999;
  let lo = loFloor;
  let hi = 2;

  let npvLo = npvFlows(flows, lo);
  if (!Number.isFinite(npvLo)) npvLo = Number.POSITIVE_INFINITY;
  if (npvLo < targetValue) {
    return null;
  }

  while (npvFlows(flows, hi) > targetValue && hi < 1e6) {
    hi *= 2;
  }
  const npvHi = npvFlows(flows, hi);
  if (!Number.isFinite(npvHi) || npvHi > targetValue) {
    return null;
  }

  for (let i = 0; i < MAX_ITER; i++) {
    const mid = (lo + hi) / 2;
    const v = npvFlows(flows, mid);
    const err = Math.abs(v - targetValue) / Math.max(targetValue, 1e-12);
    if (err < TOL_REL) return mid;
    if (v > targetValue) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function metricsFromYield(
  flows: { t: number; amt: number }[],
  y: number,
  V: number
): Pick<BondYieldMetrics, 'macaulayYears' | 'modifiedDuration' | 'convexity'> {
  if (V <= 0 || !Number.isFinite(y)) {
    return { macaulayYears: null, modifiedDuration: null, convexity: null };
  }

  let macNum = 0;
  let convNum = 0;
  for (const { t, amt } of flows) {
    if (t < 0) continue;
    const pv = amt / (1 + y) ** t;
    macNum += t * pv;
    convNum += pv * t * (t + 1);
  }

  const macaulay = macNum / V;
  const modifiedDuration = macaulay / (1 + y);
  const convexity = convNum / (V * (1 + y) ** 2);

  return {
    macaulayYears: macaulay,
    modifiedDuration,
    convexity,
  };
}

export function buildFutureFlows(
  events: BondPaymentEvent[],
  ticker: string,
  valuationDate: Date,
  nominal: number,
  usdArsFxRate: number
): { t: number; amt: number }[] {
  const key = ticker.trim().toUpperCase();
  const v0 = utcMidnight(valuationDate).getTime();
  const out: { t: number; amt: number }[] = [];

  for (const e of events) {
    if (e.asset !== key) continue;
    const ed = utcMidnight(e.date).getTime();
    if (ed < v0) continue;
    const t = yearsAct365(valuationDate, e.date);
    const amt = flowUsd(e, nominal, usdArsFxRate);
    if (!Number.isFinite(amt) || amt === 0) continue;
    out.push({ t, amt });
  }

  out.sort((a, b) => a.t - b.t);
  return out;
}

export function computeBondYieldMetrics(
  events: BondPaymentEvent[],
  ticker: string,
  valuationDate: Date,
  dirtyPricePer100: number,
  nominal: number,
  usdArsFxRate: number
): BondYieldMetrics {
  const flows = buildFutureFlows(events, ticker, valuationDate, nominal, usdArsFxRate);
  const npvAtZero = npvFlows(flows, 0);
  const V = (dirtyPricePer100 / 100) * nominal;

  if (flows.length === 0 || V <= 0) {
    return {
      ytmAnnualEffective: null,
      macaulayYears: null,
      modifiedDuration: null,
      convexity: null,
      npvAtZero,
      futureFlowsCount: flows.length,
    };
  }

  const y = solveAnnualEffectiveYield(flows, V);
  if (y == null) {
    return {
      ytmAnnualEffective: null,
      macaulayYears: null,
      modifiedDuration: null,
      convexity: null,
      npvAtZero,
      futureFlowsCount: flows.length,
    };
  }

  const { macaulayYears, modifiedDuration, convexity } = metricsFromYield(flows, y, V);

  return {
    ytmAnnualEffective: y,
    macaulayYears,
    modifiedDuration,
    convexity,
    npvAtZero,
    futureFlowsCount: flows.length,
  };
}

/** TNA nominal anual con capitalización mensual equivalente (opcional, README). */
export function teaToTnaMonthly(tea: number): number {
  return 12 * ((1 + tea) ** (1 / 12) - 1) * 100;
}
