import type { BondYieldMetrics } from './types';

export type PortfolioLineMetricsInput = {
  ticker: string;
  weightPct: number;
  metrics: BondYieldMetrics;
};

export type PortfolioBondMetricsSummary = {
  ytm: number | null;
  modDuration: number | null;
};

/** Ponderación por peso % de cartera (solo filas con peso > 0). */
export function summarizeWeightedBondMetrics(
  lines: PortfolioLineMetricsInput[],
  filter?: (row: PortfolioLineMetricsInput) => boolean
): PortfolioBondMetricsSummary {
  const subset = (filter ? lines.filter(filter) : lines).filter((row) => row.weightPct > 0);
  const ytmLines = subset.filter(
    ({ metrics }) => metrics.ytmAnnualEffective != null && Number.isFinite(metrics.ytmAnnualEffective)
  );
  const durLines = subset.filter(
    ({ metrics }) => metrics.modifiedDuration != null && Number.isFinite(metrics.modifiedDuration)
  );
  const sumWYtm = ytmLines.reduce((s, { weightPct }) => s + weightPct, 0);
  const sumWDur = durLines.reduce((s, { weightPct }) => s + weightPct, 0);

  return {
    ytm:
      sumWYtm > 0
        ? ytmLines.reduce(
            (s, { weightPct, metrics }) =>
              s + (weightPct / sumWYtm) * (metrics.ytmAnnualEffective as number),
            0
          )
        : null,
    modDuration:
      sumWDur > 0
        ? durLines.reduce(
            (s, { weightPct, metrics }) =>
              s + (weightPct / sumWDur) * (metrics.modifiedDuration as number),
            0
          )
        : null,
  };
}

export function pickHomogeneousPortfolioMetrics(
  ars: PortfolioBondMetricsSummary,
  usd: PortfolioBondMetricsSummary,
  hasArsBonds: boolean,
  hasUsdBonds: boolean
): PortfolioBondMetricsSummary {
  if (hasUsdBonds && !hasArsBonds) return usd;
  if (hasArsBonds && !hasUsdBonds) return ars;
  return { ytm: null, modDuration: null };
}

export function paymentCurrencyByTickerFromEvents(
  events: { asset: string; currency: string }[],
  normalizeTicker: (t: string) => string
): Map<string, 'ARS' | 'USD'> {
  const map = new Map<string, 'ARS' | 'USD'>();
  for (const ev of events) {
    const key = normalizeTicker(ev.asset);
    if (map.has(key)) continue;
    const c = ev.currency.toUpperCase();
    map.set(key, c.includes('ARS') || c.includes('PESO') ? 'ARS' : 'USD');
  }
  return map;
}
