import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { buildSelectionWorkbook } from '@/lib/export/selection-excel';

describe('buildSelectionWorkbook', () => {
  it('arma una hoja por tabla con formatos, total y la hoja de filtros', () => {
    const wb = buildSelectionWorkbook(
      [
        {
          name: 'Por cliente',
          columns: [
            { header: 'Titular' },
            { header: 'Cantidad', type: 'qty' },
            { header: 'Valor USD', type: 'money' },
            { header: '%', type: 'pct' },
          ],
          rows: [
            ['Cliente A', 10, 1500.5, 0.75],
            ['Cliente B', null, 500, Number.NaN],
          ],
          footer: ['Total (2)', null, 2000.5, 1],
        },
      ],
      [['Broker', 'Todos']]
    );
    expect(wb.SheetNames).toEqual(['Por cliente', 'Filtros']);
    const ws = wb.Sheets['Por cliente']!;
    expect(XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })).toEqual([
      ['Titular', 'Cantidad', 'Valor USD', '%'],
      ['Cliente A', 10, 1500.5, 0.75],
      ['Cliente B', null, 500, null],
      ['Total (2)', null, 2000.5, 1],
    ]);
    expect(ws['C2']?.z).toBe('#,##0.00');
    expect(ws['D2']?.z).toBe('0.00%');
    expect(ws['!autofilter']?.ref).toBe('A1:D3');
    const filtros = XLSX.utils.sheet_to_json(wb.Sheets['Filtros']!, { header: 1 }) as unknown[][];
    expect(filtros[1]).toEqual(['Broker', 'Todos']);
  });
});
