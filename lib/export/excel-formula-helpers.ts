import type ExcelJS from 'exceljs';

/** Hoja y celda maestra del tipo de cambio (editable, fondo amarillo). */
export const PORTFOLIO_SHEET = 'Portfolio_Consolidado';
export const TC_CELL_ABS = `'${PORTFOLIO_SHEET}'!$I$2`;
export const TC_REF = `'${PORTFOLIO_SHEET}'!$I$2`;

export type PortfolioSheetMeta = {
  dataStartRow: number;
  dataEndRow: number;
  totalRow: number;
};

export function xlFormula(formula: string, result?: number | string): ExcelJS.CellFormulaValue {
  return result !== undefined ? { formula, result } : { formula };
}

export function setFormula(cell: ExcelJS.Cell, formula: string, result?: number | string): void {
  cell.value = xlFormula(formula, result);
}

export function colLetter(col: number): string {
  let n = col;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function cellRef(row: number, col: number, sheet?: string): string {
  const addr = `$${colLetter(col)}$${row}`;
  return sheet ? `'${sheet}'!${addr}` : addr;
}

export function cellRefRel(row: number, col: number, sheet?: string): string {
  const addr = `${colLetter(col)}${row}`;
  return sheet ? `'${sheet}'!${addr}` : addr;
}

/** Verdadero si I2 es un número positivo (TC cargado). */
export function tcOkExpr(): string {
  return `AND(ISNUMBER(${TC_REF}),${TC_REF}>0)`;
}

export function arsFromUsdExpr(usdRef: string): string {
  return `IF(${tcOkExpr()},${usdRef}*${TC_REF},"—")`;
}

export function usdFromArsExpr(arsRef: string): string {
  return `IF(${tcOkExpr()},${arsRef}/${TC_REF},"—")`;
}

/** Base_Consolidada Q: nativo ARS (O×P) o conversión desde USD (R×TC). */
export function baseConsolidadaArsFormula(row: number, arsFallback: string, usdFallback: string): string {
  const o = `O${row}`;
  const p = `P${row}`;
  const m = `M${row}`;
  const qtyPrice = `AND(ISNUMBER(${o}),ISNUMBER(${p}))`;
  const nativeArs = `IF(${qtyPrice},${o}*${p},${arsFallback})`;
  const nativeUsd = `IF(${qtyPrice},${o}*${p},${usdFallback})`;
  return `IF(${m}="ARS",${nativeArs},IF(${tcOkExpr()},${nativeUsd}*${TC_REF},"—"))`;
}

/** Base_Consolidada R: nativo USD (O×P) o conversión desde ARS (Q÷TC). */
export function baseConsolidadaUsdFormula(row: number, arsFallback: string, usdFallback: string): string {
  const o = `O${row}`;
  const p = `P${row}`;
  const m = `M${row}`;
  const qtyPrice = `AND(ISNUMBER(${o}),ISNUMBER(${p}))`;
  const nativeArs = `IF(${qtyPrice},${o}*${p},${arsFallback})`;
  const nativeUsd = `IF(${qtyPrice},${o}*${p},${usdFallback})`;
  return `IF(${m}="USD",${nativeUsd},IF(${tcOkExpr()},${nativeArs}/${TC_REF},"—"))`;
}

export function pctOfTotalExpr(valueCol: string, row: number, totalRow: number, totalCol: string): string {
  const total = `$${totalCol}$${totalRow}`;
  return `IF(${total}=0,0,${valueCol}${row}/${total})`;
}

export function portfolioPrecioArsFormula(row: number, isCash: boolean): string {
  if (isCash) return TC_REF;
  return `IF(${tcOkExpr()},G${row}*${TC_REF},"—")`;
}

export function registerTcNamedRange(workbook: ExcelJS.Workbook): void {
  workbook.definedNames.add(TC_CELL_ABS, 'TC_USD_ARS');
}
