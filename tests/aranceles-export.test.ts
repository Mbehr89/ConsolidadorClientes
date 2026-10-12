import ExcelJS from 'exceljs';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { exportClientArancelesExcel } from '@/lib/aranceles/export-excel';
import { buildClientExport, exportFilename } from '@/lib/aranceles/export-model';
import { ClientArancelesPdf } from '@/lib/aranceles/export-pdf';
import type { ArancelCommission } from '@/lib/aranceles/types';

function op(over: Partial<ArancelCommission>): ArancelCommission {
  return {
    id: 'x',
    import_id: 'imp',
    alyc: 'GMA',
    client: 'Cliente Prueba',
    client_key: 'cliente prueba',
    client_external_id: '1234',
    account_officer: 'Oficial',
    trade_date: '2026-09-01',
    settlement_date: '2026-09-02',
    instrument: 'AL30',
    operation: 'CPRA',
    quantity: 100,
    amount: 10000,
    commission: 50,
    commission_pct: 0.5,
    currency: 'ARS',
    commission_currency: 'ARS',
    commission_fx: null,
    imported_status: 'ok',
    fee_status: 'ok',
    expected_commission: null,
    op_number: '100',
    segment: null,
    is_min_fee: false,
    trading_group: null,
    ...over,
  };
}

const rows = [
  op({ id: 'b', trade_date: '2026-10-05', op_number: '101' }),
  op({
    id: 'a',
    op_number: '99',
    operation: 'APTOMFUTC',
    currency: 'USD_C',
    amount: 1000,
    commission: 19.9,
    commission_currency: 'ARS',
    commission_fx: 1450,
    commission_pct: 0.00411,
    trading_group: { id: 't', from: '99', to: '101', sells: 1, buys: 1 },
  }),
];

describe('aranceles: exportación por cliente', () => {
  it('arma filas cronológicas con categoría y arancel convertido', () => {
    const data = buildClientExport('Cliente Prueba', rows, 'GMA');
    expect(data.rows.map((r) => r.opNumber)).toEqual(['99', '101']);
    const first = data.rows[0]!;
    expect(first.category).toBe('Caución tomadora');
    expect(first.commissionCurrency).toBe('ARS');
    expect(first.commissionInOpCurrency).toBeCloseTo(19.9 / 1450, 6);
    expect(first.trading).toBe('Boletos 99-101');
    expect(data.totals).toEqual({ ARS: 69.9 });
    expect(data.byMonth.map((m) => m.month)).toEqual(['2026-09', '2026-10']);
  });

  it('genera un Excel con resumen y operaciones', async () => {
    const blob = await exportClientArancelesExcel(buildClientExport('Cliente Prueba', rows, ''));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Resumen', 'Operaciones']);
    const ops = wb.getWorksheet('Operaciones')!;
    expect(ops.rowCount).toBe(3);
    expect(ops.getRow(2).getCell(3).value).toBe('99');
    expect(ops.getRow(1).getCell(11).value).toBe('Tipo de arancel');
    expect(ops.getRow(2).getCell(11).value).toBe('Cauciones');
    expect(ops.getRow(1).getCell(13).value).toBe('Categoría');
    expect(ops.getRow(2).getCell(13).value).toBe('Caución tomadora');
  });

  it('genera el PDF', async () => {
    const { renderToBuffer } = await import('@react-pdf/renderer');
    const el = React.createElement(ClientArancelesPdf, {
      data: buildClientExport('Cliente Prueba', rows, 'GMA'),
      logo: null,
    });
    const buf = await renderToBuffer(el as Parameters<typeof renderToBuffer>[0]);
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  }, 30000);

  it('arma nombres de archivo sin acentos ni espacios', () => {
    expect(exportFilename('Pérez, Juan & Cía.', 'pdf')).toMatch(/^aranceles_Perez_Juan_Cia_\d{4}-\d{2}-\d{2}\.pdf$/);
  });
});
