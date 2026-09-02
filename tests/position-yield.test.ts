import { describe, expect, it } from 'vitest';
import { computeBondYieldMetrics } from '@/lib/bonds/metrics';
import { computeBondYieldMetricsForPosition, isBondYieldPosition } from '@/lib/bonds/position-yield';
import { tickerEligibleForBondYield } from '@/lib/bonds/ticker-normalize';
import type { BondPaymentEvent } from '@/lib/bonds/types';
import type { Position } from '@/lib/schema';

function pos(overrides: Partial<Position>): Position {
  return {
    cliente_id: 'c1',
    titular: 'T',
    titular_normalizado: 't',
    tipo_titular: 'persona',
    grupo_id: null,
    broker: 'IEB',
    cuenta: '1',
    tipo_cuenta: null,
    productor: null,
    fecha_reporte: '2026-01-01',
    ticker: 'AL30',
    isin: null,
    cusip: null,
    descripcion: 'Bono',
    clase_activo: 'bond',
    forma_legal: null,
    pais_emisor: null,
    cantidad: 100,
    cantidad_disponible: null,
    cantidad_no_disponible: null,
    precio_mercado: 85,
    moneda: 'USD',
    moneda_subtipo: null,
    valor_mercado_local: 85000,
    valor_mercado_usd: 85,
    accrued_interest_usd: null,
    fx_source: 'manual',
    pct_portfolio: null,
    source_file: 'ieb.xlsx',
    source_row: 10,
    warnings: [],
    ...overrides,
  };
}

const al30Events: BondPaymentEvent[] = [
  {
    asset: 'AL30',
    date: new Date(Date.UTC(2027, 0, 1)),
    currency: 'USD',
    flowPer100: 105,
  },
];
const valuation = new Date(Date.UTC(2026, 0, 1));

describe('tickerEligibleForBondYield', () => {
  it('rejects cash and currency tickers', () => {
    expect(tickerEligibleForBondYield('CASH')).toBe(false);
    expect(tickerEligibleForBondYield('PESOS')).toBe(false);
    expect(tickerEligibleForBondYield('USD')).toBe(false);
    expect(tickerEligibleForBondYield('AL30')).toBe(true);
  });
});

describe('isBondYieldPosition', () => {
  it('rejects cash even if ticker collides with a bond calendar name', () => {
    expect(isBondYieldPosition(pos({ ticker: 'CASH', clase_activo: 'cash' }))).toBe(false);
    expect(isBondYieldPosition(pos({ ticker: 'AL30', clase_activo: 'cash' }))).toBe(false);
  });

  it('rejects equity, funds and money market', () => {
    expect(isBondYieldPosition(pos({ ticker: 'GGAL', clase_activo: 'equity' }))).toBe(false);
    expect(isBondYieldPosition(pos({ ticker: 'FCI1', clase_activo: 'fund' }))).toBe(false);
    expect(
      isBondYieldPosition(pos({ ticker: 'MMARS', clase_activo: 'fund', moneda_subtipo: 'money_market_ars' }))
    ).toBe(false);
  });

  it('accepts bonds, ON and letras', () => {
    expect(isBondYieldPosition(pos({ clase_activo: 'bond' }))).toBe(true);
    expect(isBondYieldPosition(pos({ ticker: 'ON1', clase_activo: 'on' }))).toBe(true);
    expect(isBondYieldPosition(pos({ ticker: 'S31O6', clase_activo: 'letra' }))).toBe(true);
  });
});

describe('computeBondYieldMetricsForPosition', () => {
  it('does not invent TIR or duration for cash, even with same source_row as a bond', () => {
    const bond = pos({ source_row: 10, ticker: 'AL30', clase_activo: 'bond' });
    const cash = pos({
      source_row: 10,
      ticker: 'CASH',
      clase_activo: 'cash',
      precio_mercado: 1,
      cantidad: 1000,
      valor_mercado_usd: 1000,
    });
    const bondMet = computeBondYieldMetricsForPosition(bond, al30Events, valuation);
    const cashMet = computeBondYieldMetricsForPosition(cash, al30Events, valuation);
    expect(bondMet?.ytmAnnualEffective).not.toBeNull();
    expect(cashMet).toBeNull();
  });

  it('does not invent metrics if cash ticker is present in the calendar', () => {
    const cashEvents: BondPaymentEvent[] = [
      {
        asset: 'CASH',
        date: new Date(Date.UTC(2027, 0, 1)),
        currency: 'USD',
        flowPer100: 100,
      },
    ];
    const cash = pos({ ticker: 'CASH', clase_activo: 'cash', precio_mercado: 1 });
    expect(computeBondYieldMetricsForPosition(cash, cashEvents, valuation)).toBeNull();
    const raw = computeBondYieldMetrics(cashEvents, 'CASH', valuation, 100, 100, 1);
    expect(raw.ytmAnnualEffective).toBeNull();
    expect(raw.modifiedDuration).toBeNull();
    expect(raw.futureFlowsCount).toBe(0);
  });
});
