/**
 * Parser: Morgan Stanley
 *
 * Layout:
 *   R2:  "All Product Type By Security"
 *   R4:  "Holdings for All Accounts as of MM/DD/YYYY HH:MM PM ET"
 *   R7:  Holding Summary (Total Market Value, Accrued Interest, etc.) — checksum
 *   R10: header row (column names)
 *   R11+: data rows
 *   Tail: "Total" row + multiple disclaimer paragraphs
 *
 * Moneda: USD siempre (offshore US).
 * Cash: Market Value ($) — a diferencia de Netx360, acá MV trae el cash directamente.
 * Accrued Interest: columna separada, sumar al MV para dirty price.
 * Product Type: clasificación directa del broker.
 * Account Number: formato "CODIGO - NNNN" con posible prefijo de tipo (B-, LAL-).
 * Name: es el INSTRUMENTO, no el titular. Titular requiere mapping externo.
 */
import type { WorkBook } from 'xlsx';
import { utils as xlsxUtils } from 'xlsx';
import type { BrokerParser, ParseOptions } from './types';
import type { Position, ParseError, ParseResult, DetectResult } from '../schema';
import { WARNING_CODES } from '../schema';
import {
  normalizeTitular,
  isMsSociedadAccount,
  extractMsAccountPrefix,
  generateClienteIdSync,
} from '../matching';
import { extractMsReportDate, parseNumeric } from '../fx';
import { isChecksumOk } from '../errors';

// ─── Constants ──────────────────────────────────────────

const BROKER_CODE = 'MS' as const;

/** Regex for valid account number */
const ACCOUNT_REGEX = /^[A-Za-z].*-\s*\d+$/;

/** Regex to detect options from Name */
const OPTION_REGEX = /^(CALL|PUT)\s+/i;

/** Product Type → clase_activo mapping */
const PRODUCT_TYPE_MAP: Record<string, { clase: Position['clase_activo']; formaLegal: Position['forma_legal'] }> = {
  'Stocks / Options': { clase: 'equity', formaLegal: 'directa' }, // options overridden by OPTION_REGEX
  'ETFs / CEFs': { clase: 'etf', formaLegal: 'directa' },
  'Corporate Fixed Income': { clase: 'bond', formaLegal: 'directa' },
  'Government Securities': { clase: 'bond', formaLegal: 'directa' },
  'Certificates of Deposit': { clase: 'bond', formaLegal: 'directa' },
  'Mutual Funds': { clase: 'fund', formaLegal: null },
  'Cash, MMF and BDP': { clase: 'cash', formaLegal: null },
  'Savings & Time Deposits': { clase: 'cash', formaLegal: null },
  'Other Holdings': { clase: 'other', formaLegal: null },
};

// ─── Detect ─────────────────────────────────────────────

function detect(workbook: WorkBook, filename: string): DetectResult {
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { matches: false, confidence: 0, reason: 'No sheets in workbook' };
  }

  const sheet = workbook.Sheets[sheetName]!;
  const rows: unknown[][] = xlsxUtils.sheet_to_json(sheet, { header: 1 });

  // Scan first 20 rows for MS markers (SheetJS may compress empty rows)
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const col0 = String(rows[i]?.[0] ?? '');
    if (col0.includes('Holdings for All Accounts as of')) {
      return {
        matches: true,
        confidence: 0.95,
        reason: `R${i}: "Holdings for All Accounts as of" (Morgan Stanley format)`,
      };
    }
    if (col0.includes('All Product Type By Security')) {
      return {
        matches: true,
        confidence: 0.90,
        reason: `R${i}: "All Product Type By Security" (Morgan Stanley format)`,
      };
    }
    if (col0.includes('Total Market Value')) {
      return {
        matches: true,
        confidence: 0.85,
        reason: `R${i}: "Total Market Value" summary (Morgan Stanley format)`,
      };
    }
  }

  // Filename heuristic
  if (/holdings.*ungrouped/i.test(filename)) {
    return {
      matches: true,
      confidence: 0.6,
      reason: 'Filename matches "Holdings Ungrouped" pattern',
    };
  }

  return { matches: false, confidence: 0, reason: 'No Morgan Stanley markers found' };
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
    errors.push({ row: null, field: null, message: 'Workbook vacío', severity: 'error' });
    return makeResult(positions, errors, warnings, cuentasSet, '', filename);
  }

  const sheet = workbook.Sheets[sheetName]!;
  const rows: unknown[][] = xlsxUtils.sheet_to_json(sheet, { header: 1 });

  // ─── Dynamic row detection (SheetJS may compress empty rows) ───
  let fechaReporte = '';
  let checksumTotalMv: number | null = null;
  let headerRowIdx = -1;

  for (let i = 0; i < Math.min(30, rows.length); i++) {
    const row = rows[i];
    if (!row) continue;
    const col0 = String(row[0] ?? '').trim();

    // Find report date: "Holdings for All Accounts as of MM/DD/YYYY..."
    if (col0.includes('Holdings for All Accounts as of')) {
      fechaReporte = extractMsReportDate(col0) ?? '';
    }

    // Find summary: "Total Market Value:" in col 0
    if (col0 === 'Total Market Value:') {
      checksumTotalMv = parseNumeric(row[1]) ?? null;
    }

    // Find header row: col 0 = "Account Number"
    if (col0 === 'Account Number') {
      headerRowIdx = i;
      break;
    }
  }

  if (!fechaReporte) {
    errors.push({
      row: null,
      field: null,
      message: 'No se pudo extraer fecha de reporte del header',
      severity: 'error',
    });
  }

  if (headerRowIdx === -1) {
    errors.push({
      row: null,
      field: null,
      message: 'Header row con "Account Number" no encontrada en las primeras 30 filas',
      severity: 'error',
    });
    return makeResult(positions, errors, warnings, cuentasSet, fechaReporte, filename);
  }

  const headerRow = rows[headerRowIdx]!;
  const colIdx = mapColumns(headerRow);
  const dataStartRow = headerRowIdx + 1;

  // ─── Process data rows ───
  for (let i = dataStartRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const accountNumber = String(row[colIdx.accountNumber] ?? '').trim();

    // Skip non-data rows (Total, disclaimers, blanks)
    if (!accountNumber || !ACCOUNT_REGEX.test(accountNumber)) continue;

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

  // ─── Checksum validation ───
  if (checksumTotalMv !== null) {
    const sumMv = positions.reduce((s, p) => {
      // Restar accrued para comparar contra MV clean del broker
      const cleanMv = p.valor_mercado_local - (p.accrued_interest_usd ?? 0);
      return s + cleanMv;
    }, 0);

    if (!isChecksumOk(checksumTotalMv, sumMv)) {
      const delta = Math.abs(checksumTotalMv - sumMv);
      const deltaPct = checksumTotalMv !== 0 ? (delta / checksumTotalMv) * 100 : 0;
      warnings.push(
        `${WARNING_CODES.CHECKSUM_DELTA}: Total MV esperado $${checksumTotalMv.toFixed(2)}, ` +
          `calculado $${sumMv.toFixed(2)} (delta ${deltaPct.toFixed(2)}%)`
      );
    }
  }

  return makeResult(positions, errors, warnings, cuentasSet, fechaReporte, filename);
}

// ─── Row parser ─────────────────────────────────────────

function parseRow(
  row: unknown[],
  colIdx: MsColumnIndex,
  rowNum: number,
  filename: string,
  fechaReporte: string,
  opts: ParseOptions
): Position | null {
  const accountNumber = String(row[colIdx.accountNumber] ?? '').trim();
  const name = String(row[colIdx.name] ?? '').trim(); // instrumento, NO titular
  const institution = String(row[colIdx.institution] ?? '').trim();
  const productType = String(row[colIdx.productType] ?? '').trim();
  const symbol = String(row[colIdx.symbol] ?? '').trim();
  const cusip = String(row[colIdx.cusip] ?? '').trim();
  const last = parseNumeric(row[colIdx.last]);
  const quantity = parseNumeric(row[colIdx.quantity]);
  const marketValue = parseNumeric(row[colIdx.marketValue]) ?? 0;
  const accruedInterest = parseNumeric(row[colIdx.accruedInterest]);
  const pctPortfolio = parseNumeric(row[colIdx.pctPortfolio]);
  const maturityDate = colIdx.maturityDate != null ? String(row[colIdx.maturityDate] ?? '').trim() : null;
  const couponRate = colIdx.couponRate != null ? parseNumeric(row[colIdx.couponRate]) : null;

  const posWarnings: string[] = [];

  // ─── Resolve titular from mapping ───
  const mappedTitular = opts.mapping_cuentas?.[accountNumber];
  const titularRaw = mappedTitular ?? `MS-${accountNumber}`;

  if (!mappedTitular) {
    posWarnings.push(WARNING_CODES.TITULAR_NO_MAPEADO);
  }

  // ─── Detect tipo_titular ───
  const isSociedad = isMsSociedadAccount(accountNumber);
  const { normalizado, tipo_titular: detectedTipo } = normalizeTitular(titularRaw);
  const tipoTitular = isSociedad ? 'juridica' as const : detectedTipo;

  // ─── Build alias lookup ───
  const aliasMap: Record<string, string> = {};
  if (opts.aliases) Object.assign(aliasMap, opts.aliases);
  const clienteId = generateClienteIdSync(normalizado, aliasMap);

  // ─── Detect tipo_cuenta from prefix ───
  const prefix = extractMsAccountPrefix(accountNumber);
  let tipoCuenta: Position['tipo_cuenta'] = null;
  if (opts.mapping_tipo_cuenta) {
    const mapped = opts.mapping_tipo_cuenta[prefix];
    if (mapped) {
      tipoCuenta = mapped as Position['tipo_cuenta'];
    } else if (prefix !== '') {
      posWarnings.push(WARNING_CODES.PREFIJO_CUENTA_NO_CLASIFICADO);
    }
  }

  // ─── Classify asset ───
  const classification = classifyAsset(productType, name, symbol, opts);
  posWarnings.push(...classification.warnings);

  // ─── Accrued interest ───
  const accruedUsd = accruedInterest ?? 0;
  const valorFinal = marketValue + accruedUsd;

  // ─── Residual check ───
  if (Math.abs(marketValue) > 0 && Math.abs(marketValue) < 1) {
    posWarnings.push(WARNING_CODES.POSICION_RESIDUAL);
  }

  // ─── Quantity for cash positions ───
  const cantidadFinal = quantity ?? (classification.clase === 'cash' ? marketValue : 0);

  // ─── Effective symbol (null if "-" or CUSIP-like) ───
  const effectiveSymbol = symbol && symbol !== '-' && !/^[0-9]{2}[A-Z0-9]+$/.test(symbol) ? symbol : null;

  // ─── Synthetic ticker for bonds without symbol ───
  const syntheticTicker = (!effectiveSymbol && classification.clase === 'bond')
    ? buildSyntheticTicker(name, maturityDate, couponRate)
    : null;
  const finalTicker = effectiveSymbol ?? syntheticTicker;

  // ─── Pais emisor ───
  let paisEmisor: string | null = null;
  if (finalTicker && opts.tickers_metadata?.[finalTicker]) {
    paisEmisor = opts.tickers_metadata[finalTicker]!.pais;
  }

  // ─── Ticker no confirmado ───
  if (finalTicker && opts.tickers_metadata && !opts.tickers_metadata[finalTicker]?.confirmado) {
    posWarnings.push(WARNING_CODES.TICKER_NO_CONFIRMADO);
  }

  const position: Position = {
    cliente_id: clienteId,
    titular: titularRaw,
    titular_normalizado: normalizado || titularRaw,
    tipo_titular: tipoTitular,
    grupo_id: null,

    broker: BROKER_CODE,
    cuenta: accountNumber,
    tipo_cuenta: tipoCuenta,
    productor: null, // MS no expone FA en este reporte
    fecha_reporte: fechaReporte,

    ticker: classification.clase === 'cash' ? 'CASH' : finalTicker,
    isin: null, // MS no trae ISIN en este reporte
    cusip: cusip && cusip !== '-' ? cusip : null,
    descripcion: name,

    clase_activo: classification.clase,
    forma_legal: classification.formaLegal,
    pais_emisor: paisEmisor,

    cantidad: cantidadFinal,
    cantidad_disponible: null,
    cantidad_no_disponible: null,
    precio_mercado: last,
    moneda: 'USD',
    moneda_subtipo: null,
    valor_mercado_local: valorFinal,
    valor_mercado_usd: valorFinal,
    accrued_interest_usd: accruedInterest,
    fx_source: 'trivial',
    pct_portfolio: null, // recomputed in consolidation — MS pct is global MS, not cross-broker

    source_file: filename,
    source_row: rowNum,
    warnings: posWarnings,
  };

  return position;
}


// ─── Asset classification ───────────────────────────────

interface ClassificationResult {
  clase: Position['clase_activo'];
  formaLegal: Position['forma_legal'];
  warnings: string[];
}

function classifyAsset(
  productType: string,
  name: string,
  symbol: string,
  opts: ParseOptions
): ClassificationResult {
  const warnings: string[] = [];

  // 1. Options override (within "Stocks / Options")
  if (OPTION_REGEX.test(name)) {
    return { clase: 'option', formaLegal: null, warnings };
  }

  // 2. Product Type direct mapping
  const mapped = PRODUCT_TYPE_MAP[productType];
  if (mapped) {
    let { clase, formaLegal } = mapped;

    // Within equity: detect ADR
    if (clase === 'equity' && /\bADR\b/i.test(name)) {
      formaLegal = 'adr';
    }

    // Check tickers metadata for ETF override (for stocks that are actually ETFs)
    if (clase === 'equity' && opts.tickers_metadata?.[symbol]?.es_etf) {
      clase = 'etf';
    }

    return { clase, formaLegal, warnings };
  }

  // 3. Unknown product type
  if (productType && productType !== '-') {
    warnings.push(`Product Type desconocido: ${productType}`);
  }

  return { clase: 'other', formaLegal: null, warnings };
}

// ─── Column index mapper ────────────────────────────────

interface MsColumnIndex {
  accountNumber: number;
  name: number;
  institution: number;
  productType: number;
  symbol: number;
  cusip: number;
  last: number;
  quantity: number;
  marketValue: number;
  accruedInterest: number;
  pctPortfolio: number;
  maturityDate: number | null;
  couponRate: number | null;
}

function mapColumns(headerRow: unknown[]): MsColumnIndex {
  const headers = headerRow.map((h) => String(h ?? '').trim());

  const find = (name: string): number => {
    const idx = headers.indexOf(name);
    if (idx === -1) throw new Error(`Column "${name}" not found in MS header`);
    return idx;
  };

  const findOptional = (name: string): number | null => {
    const idx = headers.indexOf(name);
    return idx === -1 ? null : idx;
  };

  return {
    accountNumber: find('Account Number'),
    name: find('Name'),
    institution: find('Institution'),
    productType: find('Product Type'),
    symbol: find('Symbol'),
    cusip: find('CUSIP'),
    last: find('Last ($)'),
    quantity: find('Quantity'),
    marketValue: find('Market Value ($)'),
    accruedInterest: headers.indexOf('Accrued Interest'),
    pctPortfolio: find('% of Portfolio'),
    maturityDate: findOptional('Maturity Date'),
    couponRate: findOptional('Coupon Rate (%)'),
  };
}

// ─── Result builder ─────────────────────────────────────

function makeResult(
  positions: Position[],
  errors: ParseError[],
  warnings: string[],
  cuentas: Set<string>,
  fechaReporte: string,
  filename: string
): ParseResult {
  const totalMv = positions.reduce((sum, p) => sum + (p.valor_mercado_usd ?? 0), 0);

  return {
    positions,
    errors,
    warnings,
    metadata: {
      broker: BROKER_CODE,
      cuentas_detectadas: Array.from(cuentas),
      fecha_reporte: fechaReporte,
      totales_originales: { total_market_value_usd: totalMv },
      productor: null,
      filename,
    },
  };
}

// ─── Synthetic ticker builder for bonds ──────────────────

/**
 * Builds a human-readable synthetic ticker for bonds without a market symbol.
 * Format: "ISSUER YY COUPON%"
 * 
 * Examples:
 *   "ALPHABET INC CPN: 1.998% Due : 8/15/2026"        → "ALPHABET 26 2.0%"
 *   "AMAZON COM INC CPN: 4.700% Due : 12/1/2028"       → "AMAZON 28 4.7%"
 *   "UNITED STATES TREASURY BILL CPN: 0.000%..."        → "US TREASURY 26 0.0%"
 *   "MORGAN STANLEY PRIVATE BK NATLASSN PUR N Y CD..."  → "MS CD 26 4.0%"
 *   "JPMORGAN CHASE & CO CPN: 5.040%..."                → "JPMORGAN 28 5.0%"
 */
function buildSyntheticTicker(
  name: string,
  maturityDate: string | null,
  couponRate: number | null
): string | null {
  if (!name) return null;

  // ─── Extract issuer ───
  let issuer = extractIssuer(name);
  if (!issuer) return null;

  // ─── Extract maturity year ───
  let maturityYear: string | null = null;

  // Try from maturityDate column first (format: "MM/DD/YYYY" or "M/D/YYYY")
  if (maturityDate && maturityDate !== '-') {
    const m = maturityDate.match(/(\d{4})$/);
    if (m) {
      maturityYear = m[1]!.slice(2); // "2028" → "28"
    }
  }

  // Fallback: extract from Name ("Due : 8/15/2026" or "Due: 12/1/2028")
  if (!maturityYear) {
    const m = name.match(/Due\s*:\s*\d{1,2}\/\d{1,2}\/(\d{4})/i);
    if (m) {
      maturityYear = m[1]!.slice(2);
    }
  }

  // ─── Extract coupon ───
  let couponStr = '';
  if (couponRate != null && couponRate > 0) {
    couponStr = ` ${couponRate.toFixed(1)}%`;
  } else {
    // Try from Name: "CPN: 4.700%"
    const m = name.match(/CPN:\s*([\d.]+)%/i);
    if (m) {
      const rate = parseFloat(m[1]!);
      couponStr = ` ${rate.toFixed(1)}%`;
    } else {
      couponStr = ' 0.0%'; // zero coupon (T-bills, etc.)
    }
  }

  // ─── Build ticker ───
  const parts = [issuer];
  if (maturityYear) parts.push(maturityYear);
  return parts.join(' ') + couponStr;
}

/**
 * Extracts a short issuer name from the full security description.
 * Strips common suffixes (INC, CORP, LLC, etc.) and takes first meaningful words.
 */
function extractIssuer(name: string): string | null {
  // Known mappings for common complex names
  const ISSUER_MAP: Record<string, string> = {
    'UNITED STATES TREASURY': 'US TREASURY',
    'UNITED STATES TREAS': 'US TREASURY',
    'MORGAN STANLEY': 'MS',
    'JPMORGAN CHASE': 'JPMORGAN',
    'GOLDMAN SACHS': 'GS',
    'BANK OF AMERICA': 'BOFA',
    'WELLS FARGO': 'WELLS FARGO',
    'CITIGROUP': 'CITI',
  };

  const upper = name.toUpperCase();

  // Check known mappings first
  for (const [pattern, short] of Object.entries(ISSUER_MAP)) {
    if (upper.startsWith(pattern)) {
      // Check if it's a CD or specific product
      if (upper.includes(' CD ') || upper.includes(' CD CPN')) {
        return `${short} CD`;
      }
      return short;
    }
  }

  // Generic extraction: take text before CPN: or Due: or the first 2-3 significant words
  let raw = name;

  // Cut at CPN: or Due:
  const cpnIdx = raw.search(/\s+CPN:/i);
  if (cpnIdx > 0) raw = raw.slice(0, cpnIdx);

  const dueIdx = raw.search(/\s+Due\s*:/i);
  if (dueIdx > 0) raw = raw.slice(0, dueIdx);

  // Strip corporate suffixes
  raw = raw
    .replace(/\b(INC|CORP|CORPORATION|LLC|LTD|LIMITED|LP|SA|NV|PLC|CO|NEW|COM)\b\.?/gi, '')
    .replace(/\./g, '') // strip remaining dots (e.g. "AMAZON.COM" → "AMAZON")
    .replace(/\s+/g, ' ')
    .trim();

  if (!raw) return null;

  // Take first 2 words max (or 3 if first word is very short)
  const words = raw.split(' ').filter((w) => w.length > 0);
  if (words.length === 0) return null;

  if (words[0]!.length <= 3 && words.length >= 2) {
    return words.slice(0, 3).join(' ').toUpperCase();
  }
  return words.slice(0, 2).join(' ').toUpperCase();
}

// ─── Export parser instance ──────────────────────────────

export const msParser: BrokerParser = {
  code: BROKER_CODE,
  detect,
  parse,
};
