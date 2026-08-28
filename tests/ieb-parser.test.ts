import { describe, expect, it } from 'vitest';
import { utils as xlsxUtils } from 'xlsx';
import { iebParser, dedupIebCashPositions } from '@/lib/parsers/ieb';

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

describe('iebParser.detect - disponibles', () => {
  it('detects disponibles format by header', () => {
    const wb = makeWorkbook([
      [
        'id',
        'Comitente',
        'Nombre',
        'Productor',
        'Moneda',
        'fechaconsulta',
        'Vencido',
        '24horas',
        '48horas',
        '+48horas',
        'Saldo Total',
        'Garantia',
        'numeroProductor',
      ],
      [1, '44148', 'Cliente Test', 'Milagros Behr', 'PESOS', '2026-07-31', 100, 0, 0, 0, 100, 0, 251],
    ]);
    const det = iebParser.detect(wb, 'ieb-disponibles.xlsx');
    expect(det.matches).toBe(true);
    expect(det.confidence).toBeGreaterThanOrEqual(0.93);
  });
});

describe('iebParser.parse - disponibles', () => {
  const disponiblesHeader = [
    'id',
    'Comitente',
    'Nombre',
    'Productor',
    'Moneda',
    'fechaconsulta',
    'Vencido',
    '24horas',
    '48horas',
    '+48horas',
    'Saldo Total',
    'Garantia',
    'numeroProductor',
  ];

  it('parses disponibles rows into cash positions by moneda', () => {
    const wb = makeWorkbook([
      disponiblesHeader,
      [3812219115, '44148', 'Martinez Santiago Pablo', 'Milagros Behr', 'DOLAR EXT.', '2026-07-31', 53.48, 0, 0, 0, 53.48, 0, 251],
      [3812219116, '44148', 'Martinez Santiago Pablo', 'Milagros Behr', 'PESOS', '2026-07-31', 199108.32, 0, 0, 0, 199108.32, 0, 251],
      [3812236936, '261507', 'ADAPTO FUNGTASTIC S. R. L.', 'Milagros Behr', 'PESOS', '2026-07-31', -3240.12, 0, 0, 0, -3240.12, 0, 251],
    ]);

    const res = iebParser.parse(wb, 'ieb-disponibles.xlsx', { fx_manual: 1300 });
    expect(res.errors.filter((e) => e.severity === 'error')).toHaveLength(0);
    expect(res.positions).toHaveLength(3);
    expect(res.metadata.fecha_reporte).toBe('2026-07-31');

    const cable = res.positions.find((p) => p.moneda_subtipo === 'CABLE');
    expect(cable?.valor_mercado_local).toBeCloseTo(53.48, 4);
    expect(cable?.valor_mercado_usd).toBeCloseTo(53.48, 4);

    const pesos = res.positions.find((p) => p.cuenta === '44148' && p.moneda_subtipo === 'ARS');
    expect(pesos?.valor_mercado_local).toBeCloseTo(199108.32, 2);
    expect(pesos?.valor_mercado_usd).toBeCloseTo(199108.32 / 1300, 2);

    const neg = res.positions.find((p) => p.cuenta === '261507');
    expect(neg?.warnings).toContain('CASH_NEGATIVO');
  });

  it('dedup removes titulos cash when disponibles exists for same cuenta/moneda', () => {
    const titulosWb = makeWorkbook([
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
      [1, '44148', 'Martinez Santiago Pablo', 'Milagros Behr', 'PESOS', 'Pesos', 'PESOS', 1, 1, 1, 999, 0, 0, 0, 1300, 4],
    ]);
    const dispWb = makeWorkbook([
      disponiblesHeader,
      [2, '44148', 'Martinez Santiago Pablo', 'Milagros Behr', 'PESOS', '2026-07-31', 0, 0, 0, 0, 199108.32, 0, 251],
    ]);

    const titulos = iebParser.parse(titulosWb, 'ieb-titulos.xlsx', { fecha_reporte_override: '2026-07-31' });
    const disp = iebParser.parse(dispWb, 'ieb-disponibles.xlsx', { fx_manual: 1300 });
    const merged = dedupIebCashPositions([...titulos.positions, ...disp.positions]);

    expect(merged.filter((p) => p.clase_activo === 'cash')).toHaveLength(1);
    expect(merged.find((p) => p.clase_activo === 'cash')?.valor_mercado_local).toBeCloseTo(199108.32, 2);
  });
});

