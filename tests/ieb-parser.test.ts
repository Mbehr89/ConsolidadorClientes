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

