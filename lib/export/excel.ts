import * as XLSX from 'xlsx';
import type { CellObject, WorkBook, WorkSheet } from 'xlsx';
import { BROKERS } from '@/lib/brokers';
import type { BrokerCode, Position } from '@/lib/schema';
import { aggregateByField, monedaDimensionKey, totalAumUsd } from '@/lib/analysis/exposure';
import { detectInconsistencies } from '@/lib/analysis/inconsistencies';
import { buildClienteSummaries } from '@/lib/views/cliente-summary';

const { utils, writeFile } = XLSX;

export interface ExportOptions {
  /** Nombre del archivo con extensión .xlsx. Por defecto `consolidado_YYYY-MM-DD.xlsx` (fecha local). */
  filename?: string;
  /** Si es false, no se agrega la hoja Inconsistencias. Default: true cuando hay hallazgos. */
  includeInconsistencies?: boolean;
}

const HEADER_STYLE: NonNullable<CellObject['s']> = {
  font: { name: 'Arial', sz: 10, bold: true },
  fill: { fgColor: { rgb: 'FFD5E8F0' } },
  alignment: { vertical: 'center', horizontal: 'left', wrapText: true },
};

const BROKER_CODES: BrokerCode[] = ['MS', 'NETX360', 'GMA', 'IEB'];

function localDateYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function moneyFmt(v: number): string {
  return Math.abs(v) >= 1000 ? '#,##0' : '#,##0.00';
}

function numCell(v: number | null | undefined, z?: string): CellObject {
  const n = v ?? 0;
  return { v: n, t: 'n', z: z ?? moneyFmt(n) };
}

function pctRatioCell(ratio: number): CellObject {
  return { v: ratio, t: 'n', z: '0.0%' };
}

function applyHeaderRow(ws: WorkSheet, row0: number, colCount: number) {
  for (let c = 0; c < colCount; c++) {
    const addr = utils.encode_cell({ r: row0, c });
    const cell = ws[addr];
    if (cell && cell.t !== 'z') cell.s = HEADER_STYLE;
  }
}

function setColWidths(ws: WorkSheet, matrix: (string | number | null | undefined)[][], maxW = 55) {
  const cols = matrix.reduce((m, row) => Math.max(m, row.length), 0);
  const widths: { wch: number }[] = [];
  for (let c = 0; c < cols; c++) {
    let w = 10;
    for (const row of matrix) {
      const v = row[c];
      const s = v == null ? '' : typeof v === 'number' ? v.toString() : String(v);
      w = Math.max(w, Math.min(s.length + 2, maxW));
    }
    widths.push({ wch: w });
  }
  ws['!cols'] = widths;
}

/** Intenta congelar la fila 1 (solo encabezado); si el runtime no lo soporta, Excel ignora la clave. */
function tryFreezeTopRow(ws: WorkSheet) {
  (ws as WorkSheet & { '!freeze'?: Record<string, unknown> })['!freeze'] = {
    xSplit: 0,
    ySplit: 1,
    topLeftCell: 'A2',
    activePane: 'bottomLeft',
    pane: 'bottomLeft',
  };
}

function pctText(aum: number, total: number): string {
  if (total <= 0) return '0.0%';
  return `${((aum / total) * 100).toFixed(1)}%`;
}

function buildResumenSheet(positions: Position[]): WorkSheet {
  const total = totalAumUsd(positions);
  const fechas = [...new Set(positions.map((p) => p.fecha_reporte))].sort();
  const fechaTxt =
    fechas.length === 0
      ? '—'
      : fechas.length === 1
        ? fechas[0]!
        : `${fechas[0]} → ${fechas[fechas.length - 1]} (${fechas.length} fechas distintas)`;

  const byBroker = aggregateByField(positions, (p) => p.broker);
  const byClase = aggregateByField(positions, (p) => p.clase_activo);
  const byMoneda = aggregateByField(positions, monedaDimensionKey);
  const byLoc = aggregateByField(positions, (p) => BROKERS[p.broker].tipo);

  const rows: (string | number | null)[][] = [];
  rows.push(['BEHR ADVISORY']);
  rows.push([]);
  rows.push(['AUM total (USD)', total]);
  rows.push(['Fecha(s) de reporte', fechaTxt]);
  rows.push([]);
  rows.push(['Breakdown por broker']);
  rows.push(['Código', 'Nombre', 'AUM USD', '% del total']);
  for (const code of BROKER_CODES) {
    const aum = byBroker[code] ?? 0;
    rows.push([code, BROKERS[code].nombre, aum, pctText(aum, total)]);
  }
  for (const k of Object.keys(byBroker).sort()) {
    if (BROKER_CODES.includes(k as BrokerCode)) continue;
    const aum = byBroker[k]!;
    rows.push([k, '(otro)', aum, pctText(aum, total)]);
  }
  rows.push([]);
  rows.push(['Breakdown por clase de activo']);
  rows.push(['Clase', 'AUM USD', '%']);
  for (const [k, aum] of Object.entries(byClase).sort((a, b) => b[1] - a[1])) {
    rows.push([k, aum, pctText(aum, total)]);
  }
  rows.push([]);
  rows.push(['Breakdown por moneda']);
  rows.push(['Moneda', 'AUM USD', '%']);
  for (const [k, aum] of Object.entries(byMoneda).sort((a, b) => b[1] - a[1])) {
    rows.push([k, aum, pctText(aum, total)]);
  }
  rows.push([]);
  rows.push(['Local vs offshore']);
  rows.push(['Tipo', 'AUM USD', '%']);
  for (const [k, aum] of Object.entries(byLoc).sort((a, b) => b[1] - a[1])) {
    rows.push([k, aum, pctText(aum, total)]);
  }

  const ws = utils.aoa_to_sheet(rows);
  ws[utils.encode_cell({ r: 2, c: 1 })] = numCell(total);

  rows.forEach((row, i) => {
    if (row[0] === 'Código' && row[1] === 'Nombre') applyHeaderRow(ws, i, 4);
    if (row[0] === 'Clase' && row[1] === 'AUM USD') applyHeaderRow(ws, i, 3);
    if (row[0] === 'Moneda' && row[1] === 'AUM USD') applyHeaderRow(ws, i, 3);
    if (row[0] === 'Tipo' && row[1] === 'AUM USD') applyHeaderRow(ws, i, 3);
  });

  rows.forEach((row, i) => {
    if (row.length === 4 && typeof row[2] === 'number' && row[0] !== 'Código') {
      ws[utils.encode_cell({ r: i, c: 2 })] = numCell(row[2] as number);
    }
    if (row.length === 3 && typeof row[1] === 'number' && row[0] !== 'Clase' && row[0] !== 'Moneda' && row[0] !== 'Tipo') {
      const hdr = rows[i - 1];
      if (hdr && hdr[0] === 'Clase' && hdr[1] === 'AUM USD') {
        ws[utils.encode_cell({ r: i, c: 1 })] = numCell(row[1] as number);
      }
      if (hdr && hdr[0] === 'Moneda' && hdr[1] === 'AUM USD') {
        ws[utils.encode_cell({ r: i, c: 1 })] = numCell(row[1] as number);
      }
      if (hdr && hdr[0] === 'Tipo' && hdr[1] === 'AUM USD') {
        ws[utils.encode_cell({ r: i, c: 1 })] = numCell(row[1] as number);
      }
    }
  });

  setColWidths(ws, rows);
  return ws;
}

function buildPosicionesSheet(positions: Position[]): WorkSheet {
  const headers = [
    'Broker',
    'Cuenta',
    'Titular',
    'Ticker',
    'CUSIP',
    'Descripción',
    'Clase',
    'Forma Legal',
    'Cantidad',
    'Precio',
    'Moneda',
    'Moneda Subtipo',
    'Valor Mercado Local',
    'Valor Mercado USD',
    'Accrued Interest',
    'FX Source',
    'País Emisor',
    'Fecha Reporte',
    'Warnings',
  ];
  const data: (string | number | null)[][] = [headers];
  for (const p of positions) {
    data.push([
      p.broker,
      p.cuenta,
      p.titular,
      p.ticker ?? '',
      p.cusip ?? '',
      p.descripcion,
      p.clase_activo,
      p.forma_legal ?? '',
      p.cantidad,
      p.precio_mercado ?? '',
      p.moneda,
      p.moneda_subtipo ?? '',
      p.valor_mercado_local,
      p.valor_mercado_usd ?? '',
      p.accrued_interest_usd ?? '',
      p.fx_source,
      p.pais_emisor ?? '',
      p.fecha_reporte,
      p.warnings.join('; '),
    ]);
  }
  const ws = utils.aoa_to_sheet(data);
  applyHeaderRow(ws, 0, headers.length);

  const moneyCols = new Set([12, 13, 14]);
  for (let r = 1; r < data.length; r++) {
    ws[utils.encode_cell({ r, c: 8 })] = numCell(data[r]![8] as number, '#,##0.########');
    const pr = data[r]![9];
    if (typeof pr === 'number') ws[utils.encode_cell({ r, c: 9 })] = numCell(pr, '#,##0.########');
    for (const c of moneyCols) {
      const raw = data[r]![c];
      if (raw === '' || raw == null) continue;
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isNaN(n)) ws[utils.encode_cell({ r, c })] = numCell(n);
    }
  }

  setColWidths(ws, data);
  if (data.length > 1 && ws['!ref']) {
    ws['!autofilter'] = { ref: ws['!ref'] };
  }
  tryFreezeTopRow(ws);
  return ws;
}

function buildPorClienteSheet(positions: Position[]): WorkSheet {
  const summaries = buildClienteSummaries(positions);
  const total = totalAumUsd(positions);
  const headers = [
    'Titular',
    'Tipo',
    'AUM Total USD',
    'AUM MS',
    'AUM Netx360',
    'AUM IEB',
    'AUM GMA',
    '% Book',
    'N° Posiciones',
    'N° Brokers',
    'Brokers',
  ];
  const data: (string | number)[][] = [headers];
  for (const c of summaries.sort((a, b) => b.aum_usd - a.aum_usd)) {
    const pct = total > 0 ? c.aum_usd / total : 0;
    data.push([
      c.titular,
      c.tipo_titular,
      c.aum_usd,
      c.aum_by_broker['MS'] ?? 0,
      c.aum_by_broker['NETX360'] ?? 0,
      c.aum_by_broker['IEB'] ?? 0,
      c.aum_by_broker['GMA'] ?? 0,
      pct,
      c.positions_count,
      c.brokers.length,
      [...c.brokers].sort().join(', '),
    ]);
  }
  const ws = utils.aoa_to_sheet(data);
  applyHeaderRow(ws, 0, headers.length);
  for (let r = 1; r < data.length; r++) {
    ws[utils.encode_cell({ r, c: 2 })] = numCell(data[r]![2] as number);
    for (let c = 3; c <= 6; c++) {
      ws[utils.encode_cell({ r, c })] = numCell(data[r]![c] as number);
    }
    ws[utils.encode_cell({ r, c: 7 })] = pctRatioCell(data[r]![7] as number);
  }
  setColWidths(ws, data);
  if (data.length > 1 && ws['!ref']) ws['!autofilter'] = { ref: ws['!ref'] };
  tryFreezeTopRow(ws);
  return ws;
}

function buildInconsistenciasSheet(positions: Position[]): WorkSheet {
  const list = detectInconsistencies(positions);
  const headers = ['Tipo', 'Severity', 'Descripción', 'Ticker', 'Broker'];
  const data: string[][] = [headers];
  for (const inc of list) {
    data.push([
      inc.tipo,
      inc.severity,
      inc.descripcion,
      inc.ticker ?? '',
      inc.broker ?? '',
    ]);
  }
  const ws = utils.aoa_to_sheet(data);
  applyHeaderRow(ws, 0, headers.length);
  setColWidths(ws, data);
  if (data.length > 1 && ws['!ref']) ws['!autofilter'] = { ref: ws['!ref'] };
  tryFreezeTopRow(ws);
  return ws;
}

export function exportToExcel(positions: Position[], options?: ExportOptions): void {
  const name = options?.filename ?? `consolidado_${localDateYmd()}.xlsx`;
  const fname = name.endsWith('.xlsx') ? name : `${name}.xlsx`;

  const wb: WorkBook = utils.book_new();
  utils.book_append_sheet(wb, buildResumenSheet(positions), 'Resumen');
  utils.book_append_sheet(wb, buildPosicionesSheet(positions), 'Posiciones');
  utils.book_append_sheet(wb, buildPorClienteSheet(positions), 'Por Cliente');

  const inc = detectInconsistencies(positions);
  const wantInc = options?.includeInconsistencies !== false && inc.length > 0;
  if (wantInc) {
    utils.book_append_sheet(wb, buildInconsistenciasSheet(positions), 'Inconsistencias');
  }

  writeFile(wb, fname, { bookType: 'xlsx', compression: true });
}
