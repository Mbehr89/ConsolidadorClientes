import ExcelJS from 'exceljs';
import type { ClientExportData } from '@/lib/aranceles/export-model';
import { formatMonth } from '@/lib/aranceles/format';
import { sortCurrencies } from '@/lib/aranceles/reports';

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3B5A' } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' } };
const MONEY = '#,##0.00';
const PCT = '0.00000';

function isoToDate(iso: string | null): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  row.height = 30;
}

function buildResumen(wb: ExcelJS.Workbook, data: ClientExportData) {
  const ws = wb.addWorksheet('Resumen');
  ws.columns = [{ width: 28 }, { width: 16 }, { width: 18 }, { width: 12 }];

  ws.addRow([`Aranceles · ${data.client}`]).font = { bold: true, size: 14 };
  if (data.segmentLabel) ws.addRow([data.segmentLabel]);
  if (data.rangeLabel) ws.addRow([data.rangeLabel]);
  ws.addRow([`Generado ${data.generatedAt.toLocaleString('es-AR')}`]).font = { italic: true, color: { argb: 'FF666666' } };
  ws.addRow([]);
  ws.addRow(['Operaciones', data.rowCount]);
  ws.addRow([]);

  styleHeader(ws.addRow(['Total por moneda del arancel', 'Moneda', 'Arancel']));
  for (const cur of sortCurrencies(Object.keys(data.totals))) {
    const r = ws.addRow(['', cur, data.totals[cur] ?? 0]);
    r.getCell(3).numFmt = MONEY;
  }
  ws.addRow([]);

  styleHeader(ws.addRow(['Mes', 'Moneda', 'Arancel', 'Op.']));
  for (const m of data.byMonth) {
    sortCurrencies(Object.keys(m.totals)).forEach((cur, i) => {
      const r = ws.addRow([i === 0 ? formatMonth(m.month) : '', cur, m.totals[cur] ?? 0, i === 0 ? m.rows : null]);
      r.getCell(3).numFmt = MONEY;
    });
  }
}

const OPERATION_COLUMNS: { header: string; width: number; numFmt?: string }[] = [
  { header: 'Fecha concertación', width: 13, numFmt: 'dd/mm/yyyy' },
  { header: 'Fecha liquidación', width: 13, numFmt: 'dd/mm/yyyy' },
  { header: 'Boleto', width: 10 },
  { header: 'ALYC', width: 10 },
  { header: 'Cuenta', width: 10 },
  { header: 'Cliente', width: 30 },
  { header: 'Oficial de cuenta', width: 18 },
  { header: 'Productor / Manager', width: 18 },
  { header: 'Advisor', width: 14 },
  { header: 'Grupo asesor', width: 16 },
  { header: 'Tipo de arancel', width: 22 },
  { header: 'Operación', width: 12 },
  { header: 'Categoría', width: 18 },
  { header: 'Instrumento', width: 14 },
  { header: 'Cantidad', width: 14, numFmt: '#,##0.####' },
  { header: 'Moneda op.', width: 10 },
  { header: 'Bruto', width: 16, numFmt: MONEY },
  { header: 'Arancel %', width: 11, numFmt: PCT },
  { header: 'Arancel', width: 13, numFmt: MONEY },
  { header: 'Moneda arancel', width: 10 },
  { header: 'TC implícito', width: 12, numFmt: MONEY },
  { header: 'Arancel en moneda op.', width: 14, numFmt: MONEY },
  { header: 'Arancel esperado', width: 13, numFmt: MONEY },
  { header: 'Estado', width: 22 },
  { header: 'Posible trading', width: 20 },
];

function buildOperaciones(wb: ExcelJS.Workbook, data: ClientExportData) {
  const ws = wb.addWorksheet('Operaciones', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = OPERATION_COLUMNS.map((c) => ({ header: c.header, width: c.width, style: c.numFmt ? { numFmt: c.numFmt } : {} }));
  styleHeader(ws.getRow(1));

  for (const r of data.rows) {
    ws.addRow([
      isoToDate(r.tradeDate),
      isoToDate(r.settlementDate),
      r.opNumber,
      r.alyc,
      r.account,
      r.client,
      r.officer,
      r.manager,
      r.advisor,
      r.grupoAsesor,
      r.feeType,
      r.operation,
      r.category,
      r.instrument,
      r.quantity,
      r.currency,
      r.amount,
      r.commissionPct,
      r.commission,
      r.commissionCurrency,
      r.fx,
      r.commissionInOpCurrency,
      r.expected,
      r.status,
      r.trading,
    ]);
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: OPERATION_COLUMNS.length } };
}

export async function exportClientArancelesExcel(data: ClientExportData): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'consolidador-aranceles';
  wb.created = data.generatedAt;
  buildResumen(wb, data);
  buildOperaciones(wb, data);
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
