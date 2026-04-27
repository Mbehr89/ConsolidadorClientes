import type { BondPaymentEvent } from './types';
import { parseFlowRegimeValue } from './flow-regime';

export function reviveBondEventsFromApi(raw: Array<Record<string, unknown>>): BondPaymentEvent[] {
  return raw.map(
    (r) =>
      ({
        asset: String(r.asset),
        issuer: r.issuer != null && String(r.issuer).trim() !== '' ? String(r.issuer).trim() : undefined,
        date: new Date(String(r.date)),
        currency: String(r.currency ?? 'USD'),
        flowPer100: Number(r.flowPer100),
        couponPer100: r.couponPer100 != null ? Number(r.couponPer100) : undefined,
        amortizationPer100: r.amortizationPer100 != null ? Number(r.amortizationPer100) : undefined,
        residualPctOfPar: r.residualPctOfPar != null ? Number(r.residualPctOfPar) : undefined,
        flowRegime: parseFlowRegimeValue(r.flowRegime),
      }) as BondPaymentEvent
  );
}
