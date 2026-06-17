import { describe, expect, it } from 'vitest';
import { inferMoneyMarketSubtipo, isCashBucketPosition } from '@/lib/cash-buckets';
import { feedGlossary } from '@/lib/analysis/feed-glossary';
import { applyConfirmedGlossaryToPosition } from '@/lib/parsers/ticker-glossary';
import type { Position } from '@/lib/schema';

function basePos(overrides: Partial<Position>): Position {
  return {
    cliente_id: 'c1',
    titular: 'T',
    titular_normalizado: 't',
    tipo_titular: 'persona',
    grupo_id: null,
    broker: 'GMA',
    cuenta: '1',
    tipo_cuenta: null,
    productor: null,
    fecha_reporte: '2026-01-01',
    ticker: 'FCI123',
    isin: null,
    cusip: null,
    descripcion: 'Fondo Liquidez Pesos',
    clase_activo: 'fund',
    forma_legal: null,
    pais_emisor: null,
    cantidad: 1000,
    cantidad_disponible: null,
    cantidad_no_disponible: null,
    precio_mercado: 1,
    moneda: 'ARS',
    moneda_subtipo: null,
    valor_mercado_local: 1000,
    valor_mercado_usd: 1,
    accrued_interest_usd: null,
    fx_source: 'manual',
    pct_portfolio: null,
    source_file: 'f.xlsx',
    source_row: 1,
    warnings: [],
    ...overrides,
  };
}

describe('inferMoneyMarketSubtipo', () => {
  it('detecta MM ARS desde descripción de fondo', () => {
    expect(inferMoneyMarketSubtipo(basePos({ descripcion: 'Money Market Pesos' }))).toBe('money_market_ars');
  });

  it('detecta MM USD desde descripción', () => {
    expect(
      inferMoneyMarketSubtipo(
        basePos({ descripcion: 'Fondo Money Market Dólares', moneda: 'USD', clase_activo: 'fund' })
      )
    ).toBe('money_market_usd');
  });
});

describe('feedGlossary MM segment', () => {
  it('sugiere cash + money_market_ars para fondos MM', () => {
    const out = feedGlossary([basePos({ descripcion: 'FCI Money Market ARS' })], {}, {});
    expect(out.FCI123?.clase_sugerida).toBe('cash');
    expect(out.FCI123?.moneda_subtipo_sugerido).toBe('money_market_ars');
  });
});

describe('applyConfirmedGlossary MM', () => {
  it('aplica moneda_subtipo y reclasifica a cash', () => {
    const out = applyConfirmedGlossaryToPosition(basePos({}), {
      pais: 'AR',
      clase: 'fund',
      es_etf: false,
      nombre: 'MM',
      confirmado: true,
      moneda_subtipo: 'money_market_ars',
    });
    expect(out.clase_activo).toBe('cash');
    expect(out.moneda_subtipo).toBe('money_market_ars');
    expect(out.moneda).toBe('ARS');
    expect(isCashBucketPosition(out)).toBe(true);
  });
});
