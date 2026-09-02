import { describe, expect, it } from 'vitest';
import { pickHomogeneousPortfolioMetrics, summarizeWeightedBondMetrics } from '@/lib/bonds/portfolio-metrics';
import type { BondYieldMetrics } from '@/lib/bonds/types';

function met(partial: Partial<BondYieldMetrics>): BondYieldMetrics {
  return {
    ytmAnnualEffective: null,
    macaulayYears: null,
    modifiedDuration: null,
    convexity: null,
    npvAtZero: 0,
    futureFlowsCount: 0,
    ...partial,
  };
}

describe('summarizeWeightedBondMetrics', () => {
  it('aggregates ytm and duration independently by weight', () => {
    const summary = summarizeWeightedBondMetrics([
      { ticker: 'AL30', weightPct: 60, metrics: met({ ytmAnnualEffective: 0.12, modifiedDuration: 4 }) },
      { ticker: 'GD30', weightPct: 40, metrics: met({ ytmAnnualEffective: 0.08, modifiedDuration: 2 }) },
    ]);
    expect(summary.ytm).toBeCloseTo(0.12 * 0.6 + 0.08 * 0.4, 8);
    expect(summary.modDuration).toBeCloseTo(4 * 0.6 + 2 * 0.4, 8);
  });

  it('keeps duration when ytm is missing on a line', () => {
    const summary = summarizeWeightedBondMetrics([
      { ticker: 'AL30', weightPct: 50, metrics: met({ modifiedDuration: 3 }) },
      { ticker: 'GD30', weightPct: 50, metrics: met({ ytmAnnualEffective: 0.1, modifiedDuration: 5 }) },
    ]);
    expect(summary.ytm).toBeCloseTo(0.1, 8);
    expect(summary.modDuration).toBeCloseTo(4, 8);
  });
});

describe('pickHomogeneousPortfolioMetrics', () => {
  it('returns USD metrics when portfolio is USD-only', () => {
    const usd = { ytm: 0.08, modDuration: 4.1 };
    const ars = { ytm: null, modDuration: null };
    expect(pickHomogeneousPortfolioMetrics(ars, usd, false, true)).toEqual(usd);
  });

  it('returns null headline metrics for mixed ARS/USD portfolios', () => {
    const usd = { ytm: 0.08, modDuration: 4.1 };
    const ars = { ytm: 0.12, modDuration: 2.5 };
    expect(pickHomogeneousPortfolioMetrics(ars, usd, true, true)).toEqual({
      ytm: null,
      modDuration: null,
    });
  });
});
