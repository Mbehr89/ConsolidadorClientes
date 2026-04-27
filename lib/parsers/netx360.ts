/**
 * Parser: Netx360 (Pershing / BNY Mellon)
 *
 * Layout:
 *   R0: "Report Name : Holdings by Assets"
 *   R1: "Input Criteria : IBD / OFF / IP equals JXD / ALL / ALL AND Snapshot Date equals 15-Apr-2026"
 *   R2: "Number of Rows : 107"
 *   R3: "Report Generated on 04/16/26 ..."
 *   R4: disclaimer
 *   R5: header row (column names)
 *   R6+: data rows
 *
 * Moneda: USD siempre (offshore US).
 * Cash: columna "Cash and Cash Equivalents" (no Market Value para cash).
 * MV y Cash son mutuamente excluyentes por fila.
 */
import type { WorkBook } from 'xlsx';
import { utils as xlsxUtils } from 'xlsx';
import type { BrokerParser, ParseOptions } from './types';
import type { Position, ParseError, ParseResult, DetectResult } from '../schema';
import { WARNING_CODES } from '../schema';
import {
  normalizeTitular,
  joinNetx360Name,
  generateClienteIdSync,
} from '../matching';
import { parseBrokerDate, extractNetx360ReportDate, parseNumeric } from '../fx';
import { applyConfirmedGlossaryToPosition, lookupTickerMeta } from './ticker-glossary';

// ─── Constants ──────────────────────────────────────────

const BROKER_CODE = 'NETX360' as const;

/** CUSIPs that indicate cash positions */
const CASH_CUSIPS = new Set(['USD999997', 'MONEYMRKT']);

/** Regex to detect options from Security Description */
const OPTION_REGEX = /^(CALL|PUT)\s+\d+/i;

/** Regex to extract ISIN from Security Description */
const ISIN_REGEX = /ISIN#\s*([A-Z]{2}[A-Z0-9]{9}\d)/;

/** ETF-related keywords in Security Description */
const ETF_KEYWORDS = /\bETF\b|ISHARES|VANGUARD|SPDR|SELECT SECTOR|INVESCO|PROSHARES/i;

// ─── Detect ─────────────────────────────────────────────

function detect(workbook: WorkBook, filename: string): DetectResult {
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { matches: false, confidence: 0, reason: 'No sheets in workbook' };
  }

  const sheet = workbook.Sheets[sheetName]!;
  const rows: unknown[][] = xlsxUtils.sheet_to_json(sheet, { header: 1 });

  // Check R0 for "Holdings by Assets"
  const r0 = String(rows[0]?.[0] ?? '');
  if (r0.includes('Holdings by Assets')) {
    return {
      matches: true,
      confidence: 0.95,
      reason: 'Header R0 contains "Holdings by Assets" (Netx360 Pershing format)',
    };
  }

  // Check R1 for "IBD / OFF / IP"
  const r1 = String(rows[1]?.[0] ?? '');
  if (r1.includes('IBD') && r1.includes('Snapshot Date')) {
    return {
      matches: true,
      confidence: 0.90,
      reason: 'Header R1 contains IBD + Snapshot Date (Netx360 Pershing format)',
    };
  }

  // Check filename pattern
  if (/^EA\d+_[A-Z]+\d*_/.test(filename)) {
    return {
      matches: true,
      confidence: 0.6,
      reason: 'Filename matches Netx360 pattern (EA######_XXXXX_...)',
    };
  }

  return { matches: false, confidence: 0, reason: 'No Netx360 markers found' };
}

// ─── Parse ──────────────────────────────────────────────

function parse(
  workbook: WorkBook,
  filename: string,
  opts: ParseOptions
): ParseResult {
  const positions: Position[] = [];
  const errors: ParseError[] = [];
  const warnings: string[] = [];
  const cuentasSet = new Set<string>();

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    errors.push({
      row: null,
      field: null,
      message: 'Workbook vacío (sin sheets)',
      severity: 'error',
    });
    return makeResult(positions, errors, warnings, cuentasSet, '', filename);
  }

  const sheet = workbook.Sheets[sheetName]!;
  const rows: unknown[][] = xlsxUtils.sheet_to_json(sheet, { header: 1 });

  // ─── Dynamic row detection (SheetJS may compress empty rows) ───
  let fechaReporte: string | null = null;
  let headerRowIdx = -1;

  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const row = rows[i];
    if (!row) continue;
    const col0 = String(row[0] ?? '').trim();

    // Find report date: "Input Criteria : ... Snapshot Date equals ..."
    if (col0.includes('Snapshot Date equals')) {
      fechaReporte = extractNetx360ReportDate(col0);
    }

    // Find header row: col 0 = "Snapshot Date"
    if (col0 === 'Snapshot Date') {
      headerRowIdx = i;
      break;
    }
  }

  // Fallback: try first data row Snapshot Date if header-level date not found
  if (!fechaReporte && headerRowIdx >= 0 && rows[headerRowIdx + 1]) {
    try {
      fechaReporte = parseBrokerDate(rows[headerRowIdx + 1]![0] as Date, BROKER_CODE);
    } catch {
      // keep null
    }
  }

  if (!fechaReporte) {
    errors.push({
      row: null,
      field: 'Snapshot Date',
      message: 'No se pudo extraer fecha de reporte del header ni de la primera fila de datos',
      severity: 'error',
    });
    fechaReporte = '';
  }

  if (headerRowIdx === -1) {
    errors.push({
      row: null,
      field: null,
      message: 'Header row con "Snapshot Date" no encontrada en las primeras 20 filas',
      severity: 'error',
    });
    return makeResult(positions, errors, warnings, cuentasSet, fechaReporte, filename);
  }

  // ─── Extract IP Name (productor) from first data row ───
  let productor: string | null = null;

  // ─── Parse column headers ───
  const headerRow = rows[headerRowIdx]!;
  const colIdx = mapColumns(headerRow);
  const dataStartRow = headerRowIdx + 1;

  // ─── Process data rows ───
  for (let i = dataStartRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const accountNumber = String(row[colIdx.accountNumber] ?? '').trim();

    // Skip non-data rows (disclaimers, blanks)
    if (!accountNumber || !/^[A-Z]/.test(accountNumber)) continue;

    // Extract IP Name from first valid row
    if (productor === null && colIdx.ipName != null) {
      const ip = String(row[colIdx.ipName] ?? '').trim();
      if (ip) productor = ip;
    }

    cuentasSet.add(accountNumber);

    try {
      const pos = parseRow(row, colIdx, i, filename, fechaReporte, opts);
      if (pos) positions.push(pos);
    } catch (err) {
      errors.push({
        row: i,
        field: null,
        message: `Error parseando fila: ${err instanceof Error ? err.message : String(err)}`,
        severity: 'error',
      });
    }
  }

  // ─── Set productor on all positions ───
  for (const pos of positions) {
    pos.productor = productor;
  }

  return makeResult(positions, errors, warnings, cuentasSet, fechaReporte, filename, productor);
}

// ─── Row parser ─────────────────────────────────────────

function parseRow(
  row: unknown[],
  colIdx: ColumnIndex,
  rowNum: number,
  filename: string,
  fechaReporte: string,
  opts: ParseOptions
): Position | null {
  const accountNumber = String(row[colIdx.accountNumber] ?? '').trim();
  const firstName = String(row[colIdx.firstName] ?? '').trim();
  const lastName = colIdx.lastName != null ? String(row[colIdx.lastName] ?? '').trim() : '';
  const cusip = String(row[colIdx.cusip] ?? '').trim();
  const symbol = String(row[colIdx.symbol] ?? '').trim();
  const description = String(row[colIdx.description] ?? '').trim();
  const quantity = parseNumeric(row[colIdx.quantity]);
  const price = parseNumeric(row[colIdx.price]);
  const marketValue = parseNumeric(row[colIdx.marketValue]) ?? 0;
  const cashEquiv = colIdx.cashEquiv != null ? (parseNumeric(row[colIdx.cashEquiv]) ?? 0) : 0;
  const equity = parseNumeric(row[colIdx.equity]) ?? 0;
  const fixedIncome = parseNumeric(row[colIdx.fixedIncome]) ?? 0;
  const fundName = colIdx.fundName != null ? String(row[colIdx.fundName] ?? '').trim() : '';
  const accruedInterest = colIdx.accruedInterest != null ? parseNumeric(row[colIdx.accruedInterest]) : null;

  // Snapshot date per row (when available)
  let rowFecha = fechaReporte;
  if (colIdx.snapshotDate != null && row[colIdx.snapshotDate] != null) {
    try {
      rowFecha = parseBrokerDate(row[colIdx.snapshotDate] as Date, BROKER_CODE);
    } catch {
      // keep global fecha
    }
  }

  // ─── Resolve titular ───
  const rawName = joinNetx360Name(firstName, lastName);
  const mappedName = opts.mapping_cuentas?.[accountNumber] ?? rawName;
  const { normalizado, tipo_titular } = normalizeTitular(mappedName);

  // Build aliases lookup from opts
  const aliasMap: Record<string, string> = {};
  if (opts.aliases) {
    Object.assign(aliasMap, opts.aliases);
  }
  const clienteId = generateClienteIdSync(normalizado, aliasMap);

  // ─── Warnings ───
  const posWarnings: string[] = [];

  // ─── Classify asset ───
  const classification = classifyAsset(cusip, symbol, description, equity, fixedIncome, fundName, opts);
  posWarnings.push(...classification.warnings);

  // ─── Extract ISIN from description ───
  const isinMatch = description.match(ISIN_REGEX);
  const isin = isinMatch ? isinMatch[1]! : null;

  // ─── Determine market value ───
  // MV and Cash are mutually exclusive per row
  const totalValue = marketValue + cashEquiv;

  // Add accrued interest to value for bonds
  const accruedUsd = accruedInterest ?? 0;
  const valorFinal = totalValue + accruedUsd;

  if (cashEquiv < 0) {
    posWarnings.push(WARNING_CODES.CASH_NEGATIVO);
  }

  if (quantity != null && quantity < 0 && classification.clase !== 'option') {
    posWarnings.push(WARNING_CODES.CANTIDAD_NEGATIVA);
  }

  if (Math.abs(totalValue) < 1 && Math.abs(totalValue) > 0) {
    posWarnings.push(WARNING_CODES.POSICION_RESIDUAL);
  }

  const metaGlossary = lookupTickerMeta(opts.tickers_metadata, symbol);

  // ─── Ticker no confirmado check ───
  if (symbol && symbol !== 'USD' && opts.tickers_metadata && !metaGlossary?.confirmado) {
    posWarnings.push(WARNING_CODES.TICKER_NO_CONFIRMADO);
  }

  // ─── Pais emisor ───
  let paisEmisor: string | null = null;
  if (isin && isin.length >= 2) {
    paisEmisor = isin.slice(0, 2);
  } else if (metaGlossary) {
    paisEmisor = metaGlossary.pais;
  }

  // ─── Build position ───
  const position: Position = {
    cliente_id: clienteId,
    titular: mappedName || `NETX360-${accountNumber}`,
    titular_normalizado: normalizado || `NETX360-${accountNumber}`,
    tipo_titular,
    grupo_id: null, // resolved later by consolidation layer

    broker: BROKER_CODE,
    cuenta: accountNumber,
    tipo_cuenta: null, // Netx360 doesn't have account type prefixes like MS
    productor: null, // set after all rows parsed
    fecha_reporte: rowFecha,

    ticker: classification.clase === 'cash' ? 'CASH' : (symbol || null),
    isin,
    cusip: cusip || null,
    descripcion: description,

    clase_activo: classification.clase,
    forma_legal: classification.formaLegal,
    pais_emisor: paisEmisor,

    cantidad: quantity ?? 0,
    cantidad_disponible: null,
    cantidad_no_disponible: null,
    precio_mercado: price,
    moneda: 'USD',
    moneda_subtipo: classification.monedaSubtipo,
    valor_mercado_local: valorFinal,
    valor_mercado_usd: valorFinal,
    accrued_interest_usd: accruedInterest,
    fx_source: 'trivial',
    pct_portfolio: null, // recomputed in consolidation

    source_file: filename,
    source_row: rowNum,
    warnings: posWarnings,
  };

  return applyConfirmedGlossaryToPosition(position, metaGlossary);
}


// ─── Asset classification ───────────────────────────────

interface ClassificationResult {
  clase: Position['clase_activo'];
  formaLegal: Position['forma_legal'];
  monedaSubtipo: string | null;
  warnings: string[];
}

function classifyAsset(
  cusip: string,
  symbol: string,
  description: string,
  equity: number,
  fixedIncome: number,
  fundName: string,
  opts: ParseOptions
): ClassificationResult {
  const warnings: string[] = [];

  // 1. Cash: CUSIP in known cash CUSIPs
  if (CASH_CUSIPS.has(cusip)) {
    const subtipo = cusip === 'MONEYMRKT' ? 'money_market' : 'usd_cash';
    return { clase: 'cash', formaLegal: null, monedaSubtipo: subtipo, warnings };
  }

  // 2. Options: description starts with CALL/PUT
  if (OPTION_REGEX.test(description)) {
    return { clase: 'option', formaLegal: null, monedaSubtipo: null, warnings };
  }

  // 3. Funds: Fund Name present
  if (fundName && fundName.length > 0) {
    return { clase: 'fund', formaLegal: null, monedaSubtipo: null, warnings };
  }

  // 4. Fixed Income
  if (fixedIncome > 0) {
    return { clase: 'bond', formaLegal: 'directa', monedaSubtipo: null, warnings };
  }

  // 5. Check tickers metadata for ETF override
  const meta = lookupTickerMeta(opts.tickers_metadata, symbol);
  if (meta?.es_etf) {
    return { clase: 'etf', formaLegal: 'directa', monedaSubtipo: null, warnings };
  }

  // 6. ETF by description keywords
  if (ETF_KEYWORDS.test(description)) {
    return { clase: 'etf', formaLegal: 'directa', monedaSubtipo: null, warnings };
  }

  // 7. Equity (default for positions with equity value)
  if (equity > 0) {
    // Detect ADR by description
    const isAdr = /\bADR\b|SPONS ADR|SPONSORED ADR/i.test(description);
    return {
      clase: 'equity',
      formaLegal: isAdr ? 'adr' : 'directa',
      monedaSubtipo: null,
      warnings,
    };
  }

  // 8. Fallback: if has market value but no classification hint
  if (symbol) {
    warnings.push(WARNING_CODES.TICKER_NO_CONFIRMADO);
    return { clase: 'other', formaLegal: null, monedaSubtipo: null, warnings };
  }

  return { clase: 'other', formaLegal: null, monedaSubtipo: null, warnings };
}

// ─── Column index mapper ────────────────────────────────

interface ColumnIndex {
  snapshotDate: number | null;
  accountNumber: number;
  firstName: number;
  lastName: number | null;
  cusip: number;
  symbol: number;
  description: number;
  quantity: number;
  price: number;
  marketValue: number;
  equity: number;
  fixedIncome: number;
  fundName: number | null;
  accruedInterest: number | null;
  cashEquiv: number | null;
  ipName: number | null;
}

function mapColumns(headerRow: unknown[]): ColumnIndex {
  const headers = headerRow.map((h) => String(h ?? '').trim());

  const find = (name: string): number => {
    const idx = headers.indexOf(name);
    if (idx === -1) throw new Error(`Column "${name}" not found in header`);
    return idx;
  };

  const findOptional = (name: string): number | null => {
    const idx = headers.indexOf(name);
    return idx === -1 ? null : idx;
  };

  return {
    snapshotDate: findOptional('Snapshot Date'),
    accountNumber: find('Account Number'),
    firstName: find('First Name'),
    lastName: findOptional('Last Name'),
    cusip: find('CUSIP'),
    symbol: find('Symbol'),
    description: find('Security Description'),
    quantity: find('Quantity'),
    price: find('Price'),
    marketValue: find('Market Value'),
    equity: find('Equity'),
    fixedIncome: find('Fixed Income'),
    fundName: findOptional('Fund Name'),
    accruedInterest: findOptional('Accrued Interest'),
    cashEquiv: findOptional('Cash and Cash Equivalents'),
    ipName: findOptional('IP Name'),
  };
}

// ─── Result builder ─────────────────────────────────────

function makeResult(
  positions: Position[],
  errors: ParseError[],
  warnings: string[],
  cuentas: Set<string>,
  fechaReporte: string,
  filename: string,
  productor?: string | null
): ParseResult {
  // Compute totals for checksum
  const totalMv = positions.reduce((sum, p) => sum + p.valor_mercado_usd!, 0);

  return {
    positions,
    errors,
    warnings,
    metadata: {
      broker: BROKER_CODE,
      cuentas_detectadas: Array.from(cuentas),
      fecha_reporte: fechaReporte,
      totales_originales: { total_market_value_usd: totalMv },
      productor: productor ?? null,
      filename,
    },
  };
}

// ─── Export parser instance ──────────────────────────────

export const netx360Parser: BrokerParser = {
  code: BROKER_CODE,
  detect,
  parse,
};
