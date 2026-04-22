import { describe, expect, it } from 'vitest';
import { computeBondYieldMetrics } from '@/lib/bonds/metrics';
import type { BondPaymentEvent } from '@/lib/bonds/types';

describe('computeBondYieldMetrics', () => {
  it('computes YTM and duration for simple 2-flow bond', () => {
    const events: BondPaymentEvent[] = [
      {
        asset: 'TEST',
        date: new Date(Date.UTC(2026, 0, 1)),
        currency: 'USD',
        flowPer100: 5,
      },
      {
        asset: 'TEST',
        date: new Date(Date.UTC(2026, 6, 1)),
        currency: 'USD',
        flowPer100: 105,
      },
    ];
    const valuation = new Date(Date.UTC(2025, 0, 1));
    const m = computeBondYieldMetrics(events, 'TEST', valuation, 85, 100, 1);
    expect(m.futureFlowsCount).toBe(2);
    expect(m.ytmAnnualEffective).not.toBeNull();
    expect(m.modifiedDuration).not.toBeNull();
    expect(m.macaulayYears).not.toBeNull();
  });

  it('supports negative YTM when price is above future flow value', () => {
    const events: BondPaymentEvent[] = [
      {
        asset: 'NEG',
        date: new Date(Date.UTC(2026, 0, 1)),
        currency: 'USD',
        flowPer100: 100,
      },
    ];
    const valuation = new Date(Date.UTC(2025, 0, 1));
    const m = computeBondYieldMetrics(events, 'NEG', valuation, 120, 100, 1);
    expect(m.futureFlowsCount).toBe(1);
    expect(m.ytmAnnualEffective).not.toBeNull();
    expect(m.ytmAnnualEffective!).toBeLessThan(0);
  });
});
