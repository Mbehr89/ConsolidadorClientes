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
  moneda = '$'
): (string | number)[] {
  return [n, 1000 + n, client, 'OFICIAL', date, date, 'AL30', op, 10, bruto, bruto, '', arancel, moneda];
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
    const applied = applyImport(emptyHistory(), { alyc: 'ESCO', filename: 'ESCO_GMA.xlsx', rows: p.rows, format: 'gma' });
    const h = runFeeAnalysis(applied.history);

    const fixed = h.fee_schedules.find((s) => s.client === 'PEREZ JUAN' && s.fee_type === 'fixed');
    expect(fixed).toMatchObject({ alyc: 'ESCO', currency: 'ARS', amount: 19.9, sample_count: 3 });

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
    const first = applyImport(emptyHistory(), { alyc: 'ESCO', filename: 'a.xlsx', rows: p.rows });
    const second = applyImport(first.history, { alyc: 'ESCO', filename: 'b.xlsx', rows: p.rows });
    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(6);
    expect(second.importRecord).toBeNull();
    expect(second.history.commissions).toHaveLength(6);
  });

  it('borrar una importación quita sus operaciones', () => {
    const p = prepareFile(buffer, 'ESCO_GMA.xlsx');
    const applied = applyImport(emptyHistory(), { alyc: 'ESCO', filename: 'a.xlsx', rows: p.rows });
    const h = removeImports(applied.history, [applied.importRecord!.id]);
    expect(h.commissions).toHaveLength(0);
    expect(h.imports).toHaveLength(0);
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
