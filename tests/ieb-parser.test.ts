import { describe, expect, it } from 'vitest';
import { utils as xlsxUtils } from 'xlsx';
import { iebParser } from '@/lib/parsers/ieb';

function makeWorkbook(rows: unknown[][]) {
  const wb = xlsxUtils.book_new();
  const ws = xlsxUtils.aoa_to_sheet(rows);
  xlsxUtils.book_append_sheet(wb, ws, 'IEB');
  return wb;
}

describe('iebParser.parse - price scale and FX', () => {
  it('normalizes price by VN factor and derives USD price with broker FX', () => {
    const wb = makeWorkbook([
      [
        'id',
        'Comitente',
        'Nombre',
        'Productor',
        'SubtotalCodigoEspecie',
        'Ticker',
        'SubtotalEspecie',
        'SubtotalParticipacion',
        'SubtotalCantidad',
        'SubtotalPrecio',
        'SubtotalImporte',
        'SubtotalCosto',
        'SubtotalVariacion',
        'SubtotalResultado',
        'TipoCambio',
        'SubtotalTipoEspecie',
      ],
      [1, '261522', 'Cliente Test', 'Prod', 'AL30', 'AL30', 'BONO AL30', 10, 150000, 200000, 300000000, 0, 0, 0, 1400, 1],
    ]);

    const res = iebParser.parse(wb, 'ieb-sample.xlsx', { fecha_reporte_override: '2026-04-22' });
    expect(res.errors.filter((e) => e.severity === 'error')).toHaveLength(0);
    expect(res.positions).toHaveLength(1);

    const p = res.positions[0]!;
    // Precio statement local normalizado por factor VN (200000 / 100 = 2000)
    expect(p.precio_mercado).toBeCloseTo(2000, 8);
    expect(p.valor_mercado_local).toBe(300000000);
    expect(p.valor_mercado_usd).toBeCloseTo(300000000 / 1400, 6);
    expect(p.fx_source).toBe('broker');
    expect(p.warnings).toContain('IEB_PRECIO_ESCALA_VN_100');
  });

  it('uses normalized local price when TC is 1', () => {
    const wb = makeWorkbook([
      [
        'id',
        'Comitente',
        'Nombre',
        'Productor',
        'SubtotalCodigoEspecie',
        'Ticker',
        'SubtotalEspecie',
        'SubtotalParticipacion',
        'SubtotalCantidad',
        'SubtotalPrecio',
        'SubtotalImporte',
        'SubtotalCosto',
        'SubtotalVariacion',
        'SubtotalResultado',
        'TipoCambio',
        'SubtotalTipoEspecie',
      ],
      [1, '261522', 'Cliente Test', 'Prod', 'TX31', 'TX31', 'BONO TX31', 10, 100000, 150000, 150000000, 0, 0, 0, 1, 1],
    ]);

    const res = iebParser.parse(wb, 'ieb-sample.xlsx', {
      fecha_reporte_override: '2026-04-22',
      fx_manual: 1200,
    });
    const p = res.positions[0]!;
    expect(p.precio_mercado).toBeCloseTo(1500, 8);
    expect(p.valor_mercado_usd).toBeCloseTo(150000000 / 1200, 6);
    expect(p.fx_source).toBe('manual');
  });
});

describe('iebParser.parse - cash normalization', () => {
  it('normalizes IEB cash tickers to expected moneda_subtipo', () => {
    const wb = makeWorkbook([
      [
        'id',
        'Comitente',
        'Nombre',
        'Productor',
        'SubtotalCodigoEspecie',
        'Ticker',
        'SubtotalEspecie',
        'SubtotalParticipacion',
        'SubtotalCantidad',
        'SubtotalPrecio',
        'SubtotalImporte',
        'SubtotalCosto',
        'SubtotalVariacion',
        'SubtotalResultado',
        'TipoCambio',
        'SubtotalTipoEspecie',
      ],
      [1, '261522', 'Cliente Test', 'Prod', 'PESOS', 'Pesos', 'PESOS', 1, 1000, 1, 1000, 0, 0, 0, 1300, 4],
      [2, '261522', 'Cliente Test', 'Prod', 'USD', 'USD', 'USD', 1, 1000, 1, 1000, 0, 0, 0, 1300, 4],
      [3, '261522', 'Cliente Test', 'Prod', 'CABLE', 'DOLAR EXT.', 'DOLAR EXT.', 1, 1000, 1, 1000, 0, 0, 0, 1300, 4],
      [4, '261522', 'Cliente Test', 'Prod', '7000', 'DOLARUSA', 'DOLARUSA', 1, 1000, 1, 1000, 0, 0, 0, 1300, 4],
      [5, '261522', 'Cliente Test', 'Prod', 'MM', 'MM Pesos', 'MM Pesos', 1, 1000, 1, 1000, 0, 0, 0, 1300, 4],
      [6, '261522', 'Cliente Test', 'Prod', 'MMUSD', 'MM Dolares', 'MM Dolares', 1, 1000, 1, 1000, 0, 0, 0, 1300, 4],
      [7, '261522', 'Cliente Test', 'Prod', 'PRIO', 'USD', 'Pesos', 1, 1000, 1, 1000, 0, 0, 0, 1300, 4],
    ]);

    const res = iebParser.parse(wb, 'ieb-cash-normalization.xlsx', { fecha_reporte_override: '2026-04-22' });
    expect(res.errors.filter((e) => e.severity === 'error')).toHaveLength(0);
    expect(res.positions).toHaveLength(7);

    const byTicker = new Map(res.positions.map((p) => [p.descripcion, p]));
    expect(byTicker.get('PESOS')?.moneda_subtipo).toBe('ARS');
    expect(byTicker.get('USD')?.moneda_subtipo).toBe('USD');
    expect(byTicker.get('DOLAR EXT.')?.moneda_subtipo).toBe('CABLE');
    expect(byTicker.get('DOLARUSA')?.moneda_subtipo).toBe('7000');
    expect(byTicker.get('MM Pesos')?.moneda_subtipo).toBe('money_market_ars');
    expect(byTicker.get('MM Dolares')?.moneda_subtipo).toBe('money_market_usd');
    // Prioriza columna F (Ticker) por sobre descripción.
    const tickerPriorityRow = res.positions.find((p) => p.source_row === 7);
    expect(tickerPriorityRow?.moneda_subtipo).toBe('USD');
  });
});

