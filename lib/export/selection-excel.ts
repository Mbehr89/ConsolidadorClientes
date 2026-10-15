import * as XLSX from 'xlsx';
import type { CellObject, WorkBook } from 'xlsx';

export type SelectionColumnType = 'text' | 'money' | 'qty' | 'pct';

export type SelectionColumn = {
  header: string;
  type?: SelectionColumnType;
  width?: number;
};

export type SelectionCell = string | number | null | undefined;

export type SelectionSheet = {
  name: string;
  columns: SelectionColumn[];
  rows: SelectionCell[][];
  /** Fila final (p. ej. totales); las celdas vacías quedan en blanco. */
  footer?: SelectionCell[];
};

const FORMAT: Record<Exclude<SelectionColumnType, 'text'>, string> = {
  money: '#,##0.00',
  qty: '#,##0.######',
  pct: '0.00%',
};

function cell(v: SelectionCell, type: SelectionColumnType = 'text'): CellObject | string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    return type === 'text' ? { v, t: 'n' } : { v, t: 'n', z: FORMAT[type] };
  }
  return v;
}

/** Excel con una hoja por tabla y, al final, los filtros con que se armó. */
export function buildSelectionWorkbook(sheets: SelectionSheet[], filters: [string, string][]): WorkBook {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const toRow = (r: SelectionCell[]) => s.columns.map((c, i) => cell(r[i], c.type));
    const aoa = [s.columns.map((c) => c.header), ...s.rows.map(toRow), ...(s.footer ? [toRow(s.footer)] : [])];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = s.columns.map((c) => ({ wch: c.width ?? (c.type && c.type !== 'text' ? 16 : 20) }));
    if (s.rows.length > 0) {
      ws['!autofilter'] = { ref: XLSX.utils.encode_range({ r: 0, c: 0 }, { r: s.rows.length, c: s.columns.length - 1 }) };
    }
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  const info = XLSX.utils.aoa_to_sheet([['Generado', new Date().toLocaleString('es-AR', { hour12: false })], ...filters]);
  info['!cols'] = [{ wch: 18 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, info, 'Filtros');
  return wb;
}

export function selectionFilename(prefix: string): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${prefix}_${ymd}.xlsx`;
}

export function downloadSelectionExcel(
  prefix: string,
  sheets: SelectionSheet[],
  filters: [string, string][]
): void {
  XLSX.writeFile(buildSelectionWorkbook(sheets, filters), selectionFilename(prefix));
}
