import { describe, expect, it } from 'vitest';
import type { Position } from '@/lib/schema';
import { accountsFromPositions, aumOf, consolidate, equityOf, rankAssets, sectorOf, sum } from '@/lib/exposure/engine';
import type { ExposureAccount } from '@/lib/exposure/types';

/** Las tres cuentas del prototipo. El motor no las trae hardcodeadas. */
const DEMO: ExposureAccount[] = [
  {
    id: 'DEMO1',
    name: 'DEMO1',
    broker: 'MS',
    cuenta: 'DEMO1',
    titular: 'Demo',
    grupoId: null,
    asset: [300000, 150000, 0, 50000],
    region: [400000, 0, 0, 50000, 0, 0],
    direct: { MSFT: 100000, MELI: 50000 },
    etf: { SPY: 100000, IWM: 50000 },
    lines: [],
    unclassified: 0,
  },
  {
    id: 'B-DEMO1',
    name: 'B-DEMO1',
    broker: 'MS',
    cuenta: 'B-DEMO1',
    titular: 'Demo',
    grupoId: null,
    asset: [0, 200000, 0, 50000],
    region: [200000, 0, 0, 0, 0, 0],
    direct: {},
    etf: {},
    lines: [],
    unclassified: 0,
  },
  {
    id: 'DEMO2-SOCIEDAD',
    name: 'DEMO2-SOCIEDAD',
    broker: 'MS',
    cuenta: 'DEMO2-SOCIEDAD',
    titular: 'Demo',
    grupoId: null,
    asset: [200000, 50000, 25000, 25000],
    region: [160000, 0, 0, 60000, 30000, 25000],
    direct: { NVDA: 80000, NU: 40000 },
    etf: { KWEB: 30000, ILF: 20000, VNQ: 30000 },
    lines: [],
    unclassified: 0,
  },
];

function percents(values: number[]): number[] {
  const base = sum(values);
  return values.map((value) => (base > 0 ? (value / base) * 100 : 0));
}

function position(over: Partial<Position>): Position {
  return {
    cliente_id: 'c1',
    titular: 'Titular',
    titular_normalizado: 'titular',
    tipo_titular: 'persona',
    grupo_id: null,
    broker: 'MS',
    cuenta: '1',
    tipo_cuenta: null,
    productor: null,
    fecha_reporte: '2026-11-06',
    ticker: 'MSFT',
    isin: null,
    cusip: null,
    descripcion: 'Microsoft',
    clase_activo: 'equity',
    forma_legal: 'directa',
    pais_emisor: 'US',
    cantidad: 1,
    cantidad_disponible: null,
    cantidad_no_disponible: null,
    precio_mercado: 1,
    moneda: 'USD',
    moneda_subtipo: null,
    valor_mercado_usd: 100,
    valor_mercado_local: 100,
    accrued_interest_usd: null,
    fx_source: 'trivial',
    pct_portfolio: null,
    source_file: 'ms.xlsx',
    source_row: 1,
    warnings: [],
    ...over,
  };
}

describe('exposición', () => {
  const book = consolidate(DEMO);

  it('suma 1.050.000 y 500.000 de renta variable', () => {
    expect(sum(DEMO.map(aumOf))).toBe(1_050_000);
    expect(sum(DEMO.map(equityOf))).toBe(500_000);
    expect(book.asset[0]).toBe(500_000);
  });

  it('sector sin look-through: 36 / 0 / 10 / 8 / 0 / 0 / 6 / 40', () => {
    const sector = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const account of DEMO) {
      sectorOf(account, false).forEach((value, index) => {
        sector[index]! += value;
      });
    }
    expect(percents(sector).map((value) => Math.round(value))).toEqual([36, 0, 10, 8, 0, 0, 6, 40]);
  });

  it('sector con look-through', () => {
    const sector = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const account of DEMO) {
      sectorOf(account, true).forEach((value, index) => {
        sector[index]! += value;
      });
    }
    const got = percents(sector).map((value) => Math.round(value * 100) / 100);
    expect(got).toEqual([45.58, 3.98, 16.66, 13.13, 3.84, 3.99, 10.4, 2.42]);
  });

  it('Microsoft es 21,2% de la renta variable, directo más SPY', () => {
    const msft = rankAssets(DEMO).find((row) => row.key === 'MSFT');
    expect(msft?.direct).toBe(100_000);
    expect(msft?.via).toBeCloseTo(5930, 5);
    expect(msft?.pctOfEquity).toBeCloseTo(21.2, 1);
  });

  it('en cada cuenta los sectores cierran la renta variable y las regiones cierran lo invertido', () => {
    for (const account of DEMO) {
      expect(sum(sectorOf(account, true))).toBeCloseTo(equityOf(account), 6);
      expect(sum(sectorOf(account, false))).toBeCloseTo(equityOf(account), 6);
      expect(sum(account.region)).toBeCloseTo(aumOf(account) - account.asset[3], 6);
    }
  });

  it('GOOG y GOOGL se agrupan, y un ticker desconocido no entra en Otros', () => {
    const accounts = accountsFromPositions([
      position({ ticker: 'GOOG', descripcion: 'Alphabet C', valor_mercado_usd: 40, valor_mercado_local: 40 }),
      position({ ticker: 'GOOGL', descripcion: 'Alphabet A', valor_mercado_usd: 60, valor_mercado_local: 60, source_row: 2 }),
      position({ ticker: 'ZZZZ', descripcion: 'Desconocido', valor_mercado_usd: 25, valor_mercado_local: 25, source_row: 3, pais_emisor: null }),
      position({ ticker: 'OPT', clase_activo: 'option', valor_mercado_usd: 0, valor_mercado_local: 0, source_row: 4 }),
    ]);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.direct.GOOGL).toBe(100);
    expect(accounts[0]!.direct.ZZZZ).toBeUndefined();
    expect(sectorOf(accounts[0]!, false)[6]).toBe(0);
    expect(accounts[0]!.unclassified).toBeGreaterThan(0);
    expect(accounts[0]!.lines.some((line) => line.ticker === 'OPT')).toBe(false);
  });
});
