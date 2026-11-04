import { describe, expect, it } from 'vitest';
import { parseOperationSort, sortOperations, type OperationSortable } from '@/lib/aranceles/operation-sort';

function row(over: Partial<OperationSortable> & Pick<OperationSortable, 'id'>): OperationSortable {
  return {
    trade_date: '2026-01-01',
    op_number: null,
    client: 'Cliente',
    alyc: 'GMA',
    operation: 'COMPRA',
    instrument: null,
    amount: null,
    commission: 0,
    fee_status: 'ok',
    ...over,
  };
}

describe('orden del detalle de operaciones', () => {
  const rows = [
    row({ id: 'a', trade_date: '2026-03-01', op_number: '1002', instrument: 'GGAL', operation: 'VENTA', amount: 10, commission: 5 }),
    row({ id: 'b', trade_date: '2026-01-15', op_number: '998', instrument: 'AL30', operation: 'COMPRA', amount: 500, commission: 20 }),
    row({ id: 'c', trade_date: '2026-02-10', op_number: null, instrument: null, operation: 'CSBNG', amount: null, commission: 1 }),
    row({ id: 'd', trade_date: '2026-02-10', op_number: '5', instrument: 'AL35', operation: 'compra', amount: 100, commission: 8 }),
  ];

  it('por instrumento, de la A a la Z, y los vacíos al final', () => {
    expect(sortOperations(rows, { by: 'instrumento', dir: 'asc' }).map((r) => r.instrument)).toEqual([
      'AL30',
      'AL35',
      'GGAL',
      null,
    ]);
  });

  it('por operación no distingue mayúsculas y, a igual texto, deja la fecha más nueva primero', () => {
    expect(sortOperations(rows, { by: 'operacion', dir: 'asc' }).map((r) => r.id)).toEqual(['d', 'b', 'c', 'a']);
  });

  it('por boleto compara como número y deja los que no tienen n° al final', () => {
    expect(sortOperations(rows, { by: 'boleto', dir: 'asc' }).map((r) => r.op_number)).toEqual(['5', '998', '1002', null]);
    expect(sortOperations(rows, { by: 'boleto', dir: 'desc' }).map((r) => r.op_number)).toEqual(['1002', '998', '5', null]);
  });

  it('por fecha, y a igual fecha por boleto', () => {
    expect(sortOperations(rows, { by: 'fecha', dir: 'asc' }).map((r) => r.op_number)).toEqual(['998', '5', null, '1002']);
    expect(sortOperations(rows, { by: 'fecha', dir: 'desc' }).map((r) => r.op_number)).toEqual(['1002', '5', null, '998']);
  });

  it('por bruto de mayor a menor, y el que no tiene importe al final', () => {
    expect(sortOperations(rows, { by: 'bruto', dir: 'desc' }).map((r) => r.amount)).toEqual([500, 100, 10, null]);
  });

  it('sin parámetros queda fecha descendente', () => {
    expect(parseOperationSort(null, null)).toEqual({ by: 'fecha', dir: 'desc' });
    expect(parseOperationSort('instrumento', 'desc')).toEqual({ by: 'instrumento', dir: 'desc' });
    expect(parseOperationSort('no-existe', 'asc').by).toBe('fecha');
  });
});
