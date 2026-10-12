import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  applyImport,
  emptyHistory,
  filterCommissions,
  removeImports,
  runFeeAnalysis,
  summarize,
} from '@/lib/aranceles/history';
import { detectPeriod, prepareFile } from '@/lib/aranceles/import-service';

const GMA_HEADERS = [
  'Numero',
  'Comitente (Numero)',
  'Comitente (Denominacion)',
  'Comitente (Oficial de cuenta)',
  'Fecha de Concertacion',
  'Fecha de Liquidacion',
  'Instrumento (Abreviatura)',
  'Tipo de Operacion (Abreviatura)',
  'Cantidad',
  'Bruto',
  'Neto',
  'Arancel (%)',
  'Arancel (Importe)',
  'Moneda (Simbolo)',
];

function gmaRow(
  n: number,
  client: string,
  date: string,
  op: string,
  bruto: number,
  arancel: number | '',
  moneda = '$',
  instrumento = 'AL30',
  cantidad = 10
): (string | number)[] {
  return [n, 1000 + n, client, 'OFICIAL', date, date, instrumento, op, cantidad, bruto, bruto, '', arancel, moneda];
}

function workbook(rows: (string | number)[][]): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet([GMA_HEADERS, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Hoja1');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

describe('aranceles: import GMA', () => {
  const buffer = workbook([
    gmaRow(1, 'PEREZ JUAN', '09/01/2026', 'COMPRA', 50_000, 19.9),
    gmaRow(2, 'PEREZ JUAN', '09/02/2026', 'VENTA', 80_000, 19.9),
    gmaRow(3, 'PEREZ JUAN', '09/03/2026', 'COMPRA', 40_000, 10),
    gmaRow(4, 'PEREZ JUAN', '09/04/2026', 'COMPRA', 5_000_000, 19.9),
    gmaRow(5, 'GOMEZ ANA', '09/05/2026', 'VENTA', 30_000, ''),
    gmaRow(6, 'GOMEZ ANA', '09/06/2026', 'APTOMCONC', 30_000, ''),
  ]);

  it('detecta formato GMA y normaliza filas (fecha mm/dd)', () => {
    const p = prepareFile(buffer, 'ESCO_GMA.xlsx');
    expect(p.imp.format).toBe('gma');
    expect(p.needsMapping).toBe(false);
    expect(p.rows).toHaveLength(6);
    expect(p.rows[0]).toMatchObject({ client: 'PEREZ JUAN', date: '2026-09-01', commission: 19.9, currency: 'ARS' });
    expect(p.rows[4]!.feeStatus).toBe('missing');
    expect(p.rows[5]!.feeStatus).toBe('skipped');
  });

  it('infiere el mínimo fijo y marca anomalías', () => {
    const p = prepareFile(buffer, 'ESCO_GMA.xlsx');
    const applied = applyImport(emptyHistory(), { alyc: 'GMA', filename: 'ESCO_GMA.xlsx', rows: p.rows, format: 'gma' });
    const h = runFeeAnalysis(applied.history);

    const fixed = h.fee_schedules.find((s) => s.client === 'PEREZ JUAN' && s.fee_type === 'fixed');
    expect(fixed).toMatchObject({ alyc: 'GMA', currency: 'ARS', amount: 19.9, sample_count: 3 });

    const byOp = new Map(h.commissions.map((c) => [c.op_number, c.fee_status]));
    expect(byOp.get('1')).toBe('ok');
    expect(byOp.get('3')).toBe('below_expected');
    expect(byOp.get('4')).toBe('min_on_large');
    expect(byOp.get('5')).toBe('missing');
    expect(byOp.get('6')).toBe('skipped');

    const anomalies = filterCommissions(h.commissions, { feeStatus: 'anomaly' });
    expect(anomalies).toHaveLength(3);
    expect(summarize(h.commissions).totals.ARS).toBeCloseTo(19.9 * 3 + 10, 5);
  });

  it('no aplica los mínimos GMA a otras ALYCs', () => {
    const p = prepareFile(buffer, 'otra.xlsx');
    const applied = applyImport(emptyHistory(), { alyc: 'IEB', filename: 'otra.xlsx', rows: p.rows, format: 'ieb' });
    const h = runFeeAnalysis(applied.history);
    const byOp = new Map(h.commissions.map((c) => [c.op_number, c.fee_status]));
    expect(byOp.get('4')).toBe('ok');
    expect(byOp.get('5')).toBe('missing');
  });

  it('no duplica operaciones al reimportar la misma planilla', () => {
    const p = prepareFile(buffer, 'ESCO_GMA.xlsx');
    const first = applyImport(emptyHistory(), { alyc: 'GMA', filename: 'a.xlsx', rows: p.rows });
    const second = applyImport(first.history, { alyc: 'GMA', filename: 'b.xlsx', rows: p.rows });
    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(6);
    expect(second.importRecord).toMatchObject({ row_count: 0, duplicate_count: 6 });
    expect(second.history.commissions).toHaveLength(6);
    expect(second.history.commissions.every((c) => c.also_in_imports?.includes(second.importRecord!.id))).toBe(true);
  });

  it('borrar una importación quita sus operaciones', () => {
    const p = prepareFile(buffer, 'ESCO_GMA.xlsx');
    const applied = applyImport(emptyHistory(), { alyc: 'GMA', filename: 'a.xlsx', rows: p.rows });
    const h = removeImports(applied.history, [applied.importRecord!.id]);
    expect(h.commissions).toHaveLength(0);
    expect(h.imports).toHaveLength(0);
  });
});

describe('aranceles: cauciones ESCO y moneda del arancel', () => {
  function caucionRow(
    n: number,
    op: string,
    bruto: number,
    pct: number | '',
    arancel: number | '',
    moneda: string
  ): (string | number)[] {
    return [n, 2000, 'LOPEZ CARLA', 'OFICIAL', '09/22/2026', '09/25/2026', '', op, '', bruto, bruto, pct, arancel, moneda];
  }

  const buffer = workbook([
    // Arancel en pesos sobre una caución en dólares: |Bruto| × % ≈ USD 3,17 → TC ≈ 1534.
    caucionRow(10, 'APTOMCONC', 77_157, '', '', 'U$D'),
    caucionRow(11, 'APTOMFUTC', -77_165.87, 0.00410959, 4865.89, 'U$D'),
    // Mínimo USD 0,20 cobrado bien (el % cierra en dólares).
    caucionRow(12, 'APTOMFUTC', -73_299.01, 0.00027285, 0.2, 'U$D'),
    // "0,20" que el % revela en pesos → no se cobró el mínimo en dólares.
    caucionRow(13, 'APTOMFUTC', -73_301.61, 0.00000018, 0.2, 'U$D'),
    // Boleto futuro sin arancel.
    caucionRow(14, 'APTOMFUTC', -54_477.79, '', '', 'U$D'),
    // Caución en pesos con el mínimo de $19,90.
    caucionRow(15, 'APCOLFUT', 4_398_056.72, 0.00045247, 19.9, '$'),
    // Caución en pesos por debajo del mínimo.
    caucionRow(16, 'APCOLFUT', 1_000_000, 0.0015, 15, '$'),
  ]);

  function analyzed() {
    const p = prepareFile(buffer, 'ESCO.xlsx');
    const applied = applyImport(emptyHistory(), { alyc: 'GMA', filename: 'ESCO.xlsx', rows: p.rows, format: 'gma' });
    const h = runFeeAnalysis(applied.history);
    return new Map(h.commissions.map((c) => [c.op_number, c]));
  }

  it('detecta el arancel en otra moneda con el % y calcula el TC implícito', () => {
    const rows = analyzed();
    const ars = rows.get('11')!;
    expect(ars.commission_currency).toBe('ARS');
    expect(ars.commission_fx).toBeCloseTo(1534.4, 0);
    expect(ars.fee_status).toBe('ok');

    expect(rows.get('12')!.commission_currency).toBe('USD');
    expect(rows.get('13')!.commission_currency).toBe('ARS');
  });

  it('aplica los mínimos de caución sólo al boleto futuro', () => {
    const rows = analyzed();
    expect(rows.get('10')!.fee_status).toBe('skipped');
    expect(rows.get('12')!.fee_status).toBe('ok');
    expect(rows.get('13')).toMatchObject({ fee_status: 'below_expected', expected_commission: 0.2 });
    expect(rows.get('14')).toMatchObject({ fee_status: 'missing', expected_commission: 0.2 });
    expect(rows.get('15')!.fee_status).toBe('ok');
    expect(rows.get('16')).toMatchObject({ fee_status: 'below_expected', expected_commission: 19.9 });
  });

  it('suma los totales en la moneda real del arancel', () => {
    const rows = analyzed();
    const totals = summarize([...rows.values()]).totals;
    expect(totals.ARS).toBeCloseTo(4865.89 + 0.2 + 19.9 + 15, 5);
    expect(totals.USD).toBeCloseTo(0.2, 5);
  });
});

describe('aranceles: posible trading (ESCO)', () => {
  const buffer = workbook([
    // Compra y venta consecutivas por montos casi iguales → trading.
    gmaRow(100, 'RIOS ANA', '09/10/2026', 'COMPRA', -5_576_994.5, 22_307.98),
    gmaRow(101, 'RIOS ANA', '09/10/2026', 'VENTA', 5_600_178, 19.9),
    // Una venta financia dos compras (ventana 201–203); la compra 200 queda afuera.
    gmaRow(200, 'SOSA LUIS', '09/11/2026', 'COMPRA', -4_383_820, 19.9),
    gmaRow(201, 'SOSA LUIS', '09/11/2026', 'VENTA', 6_782_920, 19.9),
    gmaRow(202, 'SOSA LUIS', '09/11/2026', 'COMPRA', -3_381_397.5, 19.9),
    gmaRow(203, 'SOSA LUIS', '09/11/2026', 'COMPRA', -3_365_250, 19.9),
    // Montos parecidos, boletos no seguidos pero del mismo día → trading "mismo día".
    gmaRow(300, 'VEGA EVA', '09/12/2026', 'COMPRA', -1_000_000, 19.9),
    gmaRow(320, 'VEGA EVA', '09/12/2026', 'VENTA', 1_000_000, 19.9),
    // Consecutivos pero montos distintos → no.
    gmaRow(400, 'PAZ OMAR', '09/12/2026', 'COMPRA', -1_000_000, 19.9),
    gmaRow(401, 'PAZ OMAR', '09/12/2026', 'VENTA', 400_000, 19.9),
    // Dólar MEP / cable: compra AL30 en dólares y vende la misma cantidad en pesos → trading por cantidad.
    gmaRow(500, 'LUNA SOL', '09/12/2026', 'COMPRA', -1_400, 14, 'USD', 'AL30', 2_928),
    gmaRow(501, 'LUNA SOL', '09/12/2026', 'COMPRA', -170, 0.2, 'USD C', 'AL30D', 272),
    gmaRow(502, 'LUNA SOL', '09/12/2026', 'VENTA', 2_499_634, 19.9, '$', 'AL30', -3_200),
    // Monedas distintas pero otra especie → no.
    gmaRow(600, 'MAR ROSA', '09/12/2026', 'COMPRA', -3_000, 6, 'USD', 'GGAL', 100),
    gmaRow(601, 'MAR ROSA', '09/12/2026', 'VENTA', 4_500_000, 19.9, '$', 'AL30', -100),
  ]);

  function groups(format: string) {
    const p = prepareFile(buffer, 'ESCO.xlsx');
    const applied = applyImport(emptyHistory(), { alyc: 'GMA', filename: 'ESCO.xlsx', rows: p.rows, format });
    const h = runFeeAnalysis(applied.history);
    return new Map(h.commissions.map((c) => [c.op_number, c.trading_group]));
  }

  it('marca boletos consecutivos con compras ≈ ventas', () => {
    const g = groups('gma');
    expect(g.get('100')).toMatchObject({ from: '100', to: '101' });
    expect(g.get('101')).toMatchObject({ from: '100', to: '101' });
    expect(g.get('200')).toBeNull();
    for (const n of ['201', '202', '203']) expect(g.get(n)).toMatchObject({ from: '201', to: '203', consecutive: true });
    for (const n of ['400', '401']) expect(g.get(n)).toBeNull();
  });

  it('también agrupa boletos del mismo día aunque no sean seguidos', () => {
    const g = groups('gma');
    for (const n of ['300', '320']) {
      expect(g.get(n)).toMatchObject({ from: '300', to: '320', basis: 'importe', consecutive: false });
    }
  });

  it('con monedas distintas compara la cantidad de la misma especie (dólar MEP / cable)', () => {
    const g = groups('gma');
    for (const n of ['500', '501', '502']) {
      expect(g.get(n)).toMatchObject({ from: '500', to: '502', basis: 'cantidad', instrument: 'AL30', sells: 3_200, buys: 3_200 });
    }
    expect(g.get('600')).toBeNull();
    expect(g.get('601')).toBeNull();
  });

  it('sólo aplica a ESCO (formato GMA)', () => {
    const g = groups('ieb');
    expect([...g.values()].every((v) => v === null)).toBe(true);
  });
});

describe('aranceles: período desde nombre / carpeta', () => {
  it('reconoce AAAA-MM y MM-AAAA', () => {
    expect(detectPeriod('Aranceles_2026-09.xlsx')).toBe('2026-09');
    expect(detectPeriod('ACDI 09-2026.xlsx')).toBe('2026-09');
    expect(detectPeriod('202608 IEB')).toBe('2026-08');
    expect(detectPeriod('Aranceles_1.xlsx', 'IEB')).toBeNull();
  });
});
