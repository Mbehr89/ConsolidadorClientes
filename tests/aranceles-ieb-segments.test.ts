import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { feeTypeOf } from '@/lib/aranceles/fee-types';
import { applyImport, emptyHistory } from '@/lib/aranceles/history';
import { prepareFile } from '@/lib/aranceles/import-service';

function book(headers: string[], rows: (string | number)[][]): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Hoja1');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

const NOTAS = [
  'id', 'Comitente', 'Cliente', 'Productor', 'lineanegocio', 'Fecha', 'Tipo', 'Especie', 'Moneda',
  'Importe', 'Aplica', 'Descripcion', 'Modo', 'numeroProductor', 'ArancelNeto',
];
const LICITACIONES = [
  'id', 'Comitente', 'Cliente', 'Productor', 'lineanegocio', 'Fecha', 'Moneda', 'Colocación',
  'FeeColocador', 'numeroProductor', 'ArancelNeto',
];
const DIFERENCIAS = [
  'id', 'Comitente', 'Cliente', 'Productor', 'lineanegocio', 'Fecha', 'Moneda', 'Importe',
  'Comentario', 'numeroProductor', 'ArancelNeto',
];

describe('aranceles IEB: notas, licitaciones y diferencias', () => {
  it('notas débito/crédito: el arancel es "Importe" (crédito negativo) e id es el n° de operación', () => {
    const p = prepareFile(
      book(NOTAS, [
        [63658, 5001, 'Cliente A', 'Prod X', '', '2026-05-20', 'NOTA_CREDITO', 'PRIVADO', 'PESOS', -323642.92, 'NO', 'Ajuste', 'Bruto', 77, '-'],
        [63659, 5002, 'Cliente B', 'Prod X', '', '2026-05-21', 'NOTA_DEBITO', 'PUBLICO', 'USD', 15.5, 'SI', 'Cargo', 'Neto', 77, '-'],
      ]),
      'Notas_Debito_y_Credito (3).xlsx'
    );
    expect(p.imp.format).toBe('ieb');
    expect(p.imp.segment).toBe('notas');
    expect(p.needsMapping).toBe(false);
    expect(p.rows.map((r) => [r.opNumber, r.clientExternalId, r.commission, r.currency, r.operation])).toEqual([
      ['63658', '5001', -323642.92, 'ARS', 'NOTA_CREDITO'],
      ['63659', '5002', 15.5, 'USD', 'NOTA_DEBITO'],
    ]);
    expect(p.rows.every((r) => r.amount == null)).toBe(true);
  });

  it('licitaciones: el arancel es "FeeColocador", no "ArancelNeto"', () => {
    const p = prepareFile(
      book(LICITACIONES, [
        [25107, 5001, 'Cliente A', 'Prod X', '', '2026-02-27', 'PESOS', 'PLC6O', 237718, 77, '-'],
        [25108, 5003, 'Cliente C', 'Prod Y', '', '2026-02-27', 'PESOS', 'PLC6O', 81100.6, 78, '-'],
      ]),
      'Licitaciones (2).xlsx'
    );
    expect(p.imp.segment).toBe('licitaciones');
    expect(p.rows.map((r) => [r.opNumber, r.commission, r.instrument, r.operation, r.feeStatus])).toEqual([
      ['25107', 237718, 'PLC6O', 'LICITACION', 'ok'],
      ['25108', 81100.6, 'PLC6O', 'LICITACION', 'ok'],
    ]);
  });

  it('diferencias: el arancel es "Importe"', () => {
    const p = prepareFile(
      book(DIFERENCIAS, [[728544, 5001, 'Cliente A', 'Prod X', '', '2026-01-06', 'USD', 143.33, '', 77, '-']]),
      'Diferencias (2).xlsx'
    );
    expect(p.imp.segment).toBe('diferencias');
    expect(p.rows[0]).toMatchObject({ opNumber: '728544', commission: 143.33, currency: 'USD', feeStatus: 'ok' });
  });

  it('notas: guarda productor y Modo / Aplica / Descripción para el cálculo del neto', () => {
    const p = prepareFile(
      book(NOTAS, [[1, 5001, 'Cliente A', 'Prod X', '', '2026-05-20', 'NOTA_CREDITO', 'PRIVADO', 'PESOS', -10, 'NO', 'Ajuste', 'Bruto', 77, '-']]),
      'Notas.xlsx'
    );
    const h = applyImport(emptyHistory(), { alyc: 'IEB', filename: 'n.xlsx', rows: p.rows, segment: p.imp.segment, format: 'ieb' }).history;
    expect(h.commissions[0]?.details).toEqual({
      productor: 'Prod X',
      productor_numero: '77',
      modo: 'Bruto',
      aplica: 'NO',
      descripcion: 'Ajuste',
    });
  });

  it('clasifica cada operación por tipo de arancel', () => {
    const base = { alyc: 'IEB', commission: 1, operation: null as string | null };
    expect(feeTypeOf({ ...base, segment: 'aranceles_publico' })).toBe('publico');
    expect(feeTypeOf({ ...base, segment: 'aranceles_privado' })).toBe('privado');
    expect(feeTypeOf({ ...base, segment: 'aranceles', operation: 'PRIVADO' })).toBe('privado');
    expect(feeTypeOf({ ...base, segment: 'acdi' })).toBe('acdi');
    expect(feeTypeOf({ ...base, segment: 'notas', operation: 'NOTA_DEBITO' })).toBe('nota_debito');
    expect(feeTypeOf({ ...base, segment: 'notas', operation: 'NOTA_CREDITO' })).toBe('nota_credito');
    expect(feeTypeOf({ ...base, segment: 'notas', operation: null, commission: -5 })).toBe('nota_credito');
    expect(feeTypeOf({ ...base, segment: 'licitaciones' })).toBe('licitacion');
    expect(feeTypeOf({ ...base, segment: 'diferencias' })).toBe('diferencia');
    expect(feeTypeOf({ alyc: 'OTRA', segment: null, operation: 'COMPRA', commission: 1 })).toBe('mercado');
  });

  it('GMA: públicos / privados por especie, SENEBI y caución por código de operación', () => {
    const gma = (operation: string, instrument: string | null) =>
      feeTypeOf({ alyc: 'GMA', segment: null, operation, commission: 1, instrument });
    for (const t of ['AL30', 'AL30D', 'GD35', 'TTD26', 'D30S6', 'S31O5', 'T15E7', 'BPOC7', 'NDT25', 'TZX26', 'PBA25']) {
      expect(gma('COMPRA', t)).toBe('publico');
    }
    for (const t of ['GGAL', 'TGSU2', 'YMCXO', 'PLC5O', 'BABA', 'SPY', 'TSLA', 'TRAN', 'GFGC7800OC']) {
      expect(gma('VENTA', t)).toBe('privado');
    }
    expect(gma('OPCTIT', 'GFGC7800OC')).toBe('privado');
    expect(gma('CSBNG', 'AL35')).toBe('diferencia');
    expect(gma('VSBNG', 'GD35')).toBe('diferencia');
    expect(gma('APTOMFUTC', null)).toBe('caucion');
    expect(feeTypeOf({ alyc: 'ESCO', segment: null, operation: 'COMPRA', commission: 1, instrument: 'AL30' })).toBe('publico');
  });

  it('se detecta por columnas aunque el archivo tenga otro nombre', () => {
    const p = prepareFile(
      book(LICITACIONES, [[1, 5001, 'Cliente A', 'Prod X', '', '2026-02-27', 'PESOS', 'X', 10, 77, '-']]),
      'export.xlsx'
    );
    expect(p.imp.segment).toBe('licitaciones');
  });

  it('el mismo productor en varias filas no hace chocar operaciones distintas', () => {
    const p = prepareFile(
      book(LICITACIONES, [
        [1, 5001, 'Cliente A', 'Prod X', '', '2026-02-27', 'PESOS', 'X', 10, 77, '-'],
        [2, 5002, 'Cliente B', 'Prod X', '', '2026-02-27', 'PESOS', 'X', 20, 77, '-'],
      ]),
      'Licitaciones.xlsx'
    );
    const r = applyImport(emptyHistory(), { alyc: 'IEB', filename: 'l.xlsx', rows: p.rows, segment: p.imp.segment, format: 'ieb' });
    expect(r.inserted).toBe(2);
    expect(r.conflicts).toHaveLength(0);
  });
});
