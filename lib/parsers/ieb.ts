/**
 * Parser: IEB (Invertir en Bolsa)
 *
 * Layout:
 *   R0: header row (column names)
 *   R1+: data rows (flat, una fila por posición)
 *
 * Moneda: ARS siempre. TipoCambio es la tasa FX ARS/USD del broker.
 * Sin fecha de reporte — requiere fecha_reporte_override.
 * SubtotalTipoEspecie: 0=equity, 1=bono, 3=ON, 4=cash, 5=FCI, 6=letra
 * Filas con Ticker="-" y SubtotalParticipacion=100 son totalizadoras → checksum.
 * Productor: columna "Productor" (nombre del asesor IEB).
 */
import type { WorkBook } from 'xlsx';
import { utils as xlsxUtils } from 'xlsx';
import type { BrokerParser, ParseOptions } from './types';
import type { Position, ParseError, ParseResult, DetectResult } from '../schema';
import { WARNING_CODES } from '../schema';
import { normalizeTitular, generateClienteIdSync } from '../matching';
import { parseNumeric } from '../fx';

// ─── Constants ──────────────────────────────────────────

const BROKER_CODE = 'IEB' as const;

/** SubtotalTipoEspecie → clase_activo base */
const TIPO_ESPECIE_MAP: Record<number, Position['clase_activo']> = {
  0: 'equity', // refinado después por CEDEAR/ETF detection
  1: 'bond',
  3: 'on',
  4: 'cash',
  5: 'fund',
  6: 'letra',
};

/** Tickers especiales de cash/moneda */
const CASH_TICKERS = new Set(['Pesos', 'USD', 'DOLAR EXT.', 'DOLARUSA', '-']);

/** TipoCambio especiales que NO son tasa FX real */
const TC_NON_FX = new Set([1, 2]);

/** TipoCambio atípicos (flag warning) */
const TC_ATIPICO_THRESHOLD = 100; // valores < 100 son probablemente códigos, no tasas

// ─── Detect ─────────────────────────────────────────────

function detect(workbook: WorkBook, filename: string): DetectResult {
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { matches: false, confidence: 0, reason: 'No sheets' };
  }

  const sheet = workbook.Sheets[sheetName]!;
  const rows: unknown[][] = xlsxUtils.sheet_to_json(sheet, { header: 1 });
  const header = rows[0];
  if (!header) {
    return { matches: false, confidence: 0, reason: 'No header row' };
  }

  const headerStr = header.map((h) => String(h ?? ''));

  // IEB signature (detalle): has "Comitente", "Productor", "SubtotalTipoEspecie", "TipoCambio"
  const hasComitente = headerStr.includes('Comitente');
  const hasProductor = headerStr.includes('Productor');
  const hasTipoEspecie = headerStr.includes('SubtotalTipoEspecie');
  const hasTipoCambio = headerStr.includes('TipoCambio');
  const hasTotalPosicion = headerStr.includes('TotalPosicion');
  const hasFechaConsulta = headerStr.includes('FechaConsulta');

  if (hasComitente && hasProductor && hasTipoEspecie && hasTipoCambio) {
    return {
      matches: true,
      confidence: 0.95,
      reason: 'Header contains Comitente + Productor + SubtotalTipoEspecie + TipoCambio (IEB)',
    };
  }

  // IEB summary format (por comitente, sin detalle por instrumento)
  if (hasComitente && hasProductor && hasTotalPosicion && hasFechaConsulta) {
    return {
      matches: true,
      confidence: 0.92,
      reason: 'Header contains Comitente + Productor + TotalPosicion + FechaConsulta (IEB summary)',
    };
  }

  if (hasComitente && hasProductor) {
    return {
      matches: true,
      confidence: 0.7,
      reason: 'Header contains Comitente + Productor (probable IEB)',
    };
  }

  if (/tenencias/i.test(filename)) {
    return {
      matches: true,
      confidence: 0.4,
      reason: 'Filename contains "tenencias"',
    };
  }

  return { matches: false, confidence: 0, reason: 'No IEB markers found' };
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
  const checksumByComitente = new Map<string, number>();

  // ─── Validate fecha ───
  const fechaReporte = opts.fecha_reporte_override ?? '';
  if (!fechaReporte) {
    errors.push({
      row: null,
      field: 'fecha_reporte',
      message: 'IEB no trae fecha en el archivo. Se requiere fecha_reporte_override.',
      severity: 'error',
    });
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    errors.push({ row: null, field: null, message: 'Workbook vacío', severity: 'error' });
    return makeResult(positions, errors, warnings, cuentasSet, fechaReporte, filename, null);
  }

  const sheet = workbook.Sheets[sheetName]!;
  const rows: unknown[][] = xlsxUtils.sheet_to_json(sheet, { header: 1 });

  if (rows.length < 2) {
    errors.push({ row: null, field: null, message: 'Archivo sin datos', severity: 'error' });
    return makeResult(positions, errors, warnings, cuentasSet, fechaReporte, filename, null);
  }

  // ─── Map columns ───
  const headerRow = rows[0]!;
  const isResumenByComitente = headerRow.some((h) => String(h ?? '').trim() === 'TotalPosicion');
  if (isResumenByComitente) {
    return parseIebResumenByComitente(rows, filename, opts);
  }
  const colIdx = mapColumns(headerRow);

  // ─── Track productores detectados (puede variar por fila/cuenta) ───
  const productoresDetectados = new Set<string>();

  // ─── Process data rows ───
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const comitente = String(row[colIdx.comitente] ?? '').trim();
    if (!comitente) continue;

    const productorFila =
      colIdx.productor != null ? String(row[colIdx.productor] ?? '').trim() || null : null;
    if (productorFila) productoresDetectados.add(productorFila);

    const ticker = String(row[colIdx.ticker] ?? '').trim();
    const participacion = parseNumeric(row[colIdx.participacion]) ?? 0;
    const importe = parseNumeric(row[colIdx.importe]) ?? 0;

    // ─── Detect totalizadoras (checksum rows) ───
    if (isTotalizadora(ticker, participacion, row, colIdx)) {
      // Store as checksum for this comitente
      checksumByComitente.set(comitente, importe);
      continue; // Don't create a position
    }

    cuentasSet.add(comitente);

    try {
      const pos = parseRow(
        row,
        colIdx,
        i,
        filename,
        fechaReporte,
        comitente,
        productorFila,
        opts
      );
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

  // ─── Validate checksums ───
  for (const [comitente, expectedTotal] of checksumByComitente.entries()) {
    const actualTotal = positions
      .filter((p) => p.cuenta === comitente)
      .reduce((sum, p) => sum + p.valor_mercado_local, 0);

    const delta = Math.abs(expectedTotal - actualTotal);
    const deltaPct = expectedTotal !== 0 ? (delta / Math.abs(expectedTotal)) * 100 : 0;

    if (deltaPct > 1 && delta > 100) {
      warnings.push(
        `Comitente ${comitente}: total esperado $${expectedTotal.toFixed(2)}, ` +
          `calculado $${actualTotal.toFixed(2)} (delta ${deltaPct.toFixed(1)}%)`
      );
    }
  }

  const productorMetadata =
    productoresDetectados.size === 1
      ? Array.from(productoresDetectados)[0]!
      : productoresDetectados.size > 1
        ? 'MULTIPLE'
        : null;

  return makeResult(
    positions,
    errors,
    warnings,
    cuentasSet,
    fechaReporte,
    filename,
    productorMetadata
  );
}

// ─── Row parser ─────────────────────────────────────────

function parseRow(
  row: unknown[],
  colIdx: IebColumnIndex,
  rowNum: number,
  filename: string,
  fechaReporte: string,
  comitente: string,
  productor: string | null,
  opts: ParseOptions
): Position | null {
  const nombre = String(row[colIdx.nombre] ?? '').trim();
  const ticker = String(row[colIdx.ticker] ?? '').trim();
  const descripcion = String(row[colIdx.especie] ?? '').trim();
  const participacion = parseNumeric(row[colIdx.participacion]);
  const cantidad = parseNumeric(row[colIdx.cantidad]) ?? 0;
  const precio = parseNumeric(row[colIdx.precio]) ?? 0;
  const importe = parseNumeric(row[colIdx.importe]) ?? 0;
  const tipoCambio = parseNumeric(row[colIdx.tipoCambio]) ?? 1;
  const tipoEspecie = parseNumeric(row[colIdx.tipoEspecie]) ?? 0;
  const priceScaleFactor = inferPriceScaleFactor(cantidad, precio, importe);
  const precioLocalNormalizado = priceScaleFactor > 0 ? precio / priceScaleFactor : precio;

  const posWarnings: string[] = [];

  // ─── Classify asset ───
  const classification = classifyAsset(
    tipoEspecie, ticker, descripcion, opts
  );
  posWarnings.push(...classification.warnings);
  if (priceScaleFactor !== 1) {
    posWarnings.push(`IEB_PRECIO_ESCALA_VN_${priceScaleFactor}`);
  }

  // ─── FX logic ───
  let valorMercadoUsd: number | null = null;
  let fxSource: Position['fx_source'] = 'manual';
  let moneda: string = 'ARS';
  let precioMercado: number | null = precioLocalNormalizado;

  if (TC_NON_FX.has(tipoCambio)) {
    // TC=1 (pesos) or TC=2 (equity BYMA ARS) — need manual FX
    if (opts.fx_manual && opts.fx_manual > 0) {
      valorMercadoUsd = importe / opts.fx_manual;
      fxSource = 'manual';
    }
  } else if (tipoCambio > TC_ATIPICO_THRESHOLD) {
    // Real FX rate (1390, 1415, 1465, etc.)
    valorMercadoUsd = importe / tipoCambio;
    fxSource = 'broker';
    // En IEB el precio del statement (columna J) se mantiene en moneda local,
    // ajustado por escala VN. El precio en USD se deriva por separado.
    precioMercado = precioLocalNormalizado;
    moneda = 'ARS'; // reported in ARS, USD derived
  } else {
    // Atypical TC (e.g. 61) — process but warn
    posWarnings.push(
      `${WARNING_CODES.TIPO_CAMBIO_ATIPICO}: TipoCambio=${tipoCambio}`
    );
    if (opts.fx_manual && opts.fx_manual > 0) {
      valorMercadoUsd = importe / opts.fx_manual;
      fxSource = 'manual';
    }
  }

  // ─── Resolve titular ───
  const { normalizado, tipo_titular } = normalizeTitular(nombre);
  const aliasMap: Record<string, string> = opts.aliases ?? {};
  const clienteId = generateClienteIdSync(normalizado, aliasMap);

  // ─── Pais emisor ───
  const effectiveTicker = ticker && !CASH_TICKERS.has(ticker) ? ticker : null;
  let paisEmisor: string | null = null;
  if (effectiveTicker && opts.tickers_metadata?.[effectiveTicker]) {
    paisEmisor = opts.tickers_metadata[effectiveTicker]!.pais;
  }

  // ─── Ticker no confirmado ───
  if (effectiveTicker && opts.tickers_metadata && !opts.tickers_metadata[effectiveTicker]?.confirmado) {
    posWarnings.push(WARNING_CODES.TICKER_NO_CONFIRMADO);
  }

  // ─── Cash negative check ───
  if (classification.clase === 'cash' && importe < 0) {
    posWarnings.push(WARNING_CODES.CASH_NEGATIVO);
  }

  // ─── Residual check ───
  if (Math.abs(importe) > 0 && Math.abs(importe) < 1) {
    posWarnings.push(WARNING_CODES.POSICION_RESIDUAL);
  }

  const position: Position = {
    cliente_id: clienteId,
    titular: nombre,
    titular_normalizado: normalizado,
    tipo_titular,
    grupo_id: null,

    broker: BROKER_CODE,
    cuenta: comitente,
    tipo_cuenta: null,
    productor,
    fecha_reporte: fechaReporte,

    ticker:
      classification.clase === 'cash'
        ? 'CASH'
        : effectiveTicker,
    isin: null,
    cusip: null,
    descripcion: descripcion !== '-' ? descripcion : ticker,

    clase_activo: classification.clase,
    forma_legal: classification.formaLegal,
    pais_emisor: paisEmisor,

    cantidad,
    cantidad_disponible: null,
    cantidad_no_disponible: null,
    precio_mercado: precioMercado,
    moneda,
    moneda_subtipo: classification.monedaSubtipo,
    valor_mercado_local: importe,
    valor_mercado_usd: valorMercadoUsd,
    accrued_interest_usd: null,
    fx_source: fxSource,
    pct_portfolio: participacion,

    source_file: filename,
    source_row: rowNum,
    warnings: posWarnings,
  };

  return position;
}

function inferPriceScaleFactor(cantidad: number, precio: number, importe: number): number {
  if (!Number.isFinite(cantidad) || !Number.isFinite(precio) || !Number.isFinite(importe)) return 1;
  if (cantidad === 0 || precio === 0 || importe === 0) return 1;

  const raw = Math.abs(cantidad * precio);
  const target = Math.abs(importe);
  if (raw === 0 || target === 0) return 1;

  const candidates = [1, 10, 100, 1000, 10000];
  let best = 1;
  let bestErr = Number.POSITIVE_INFINITY;
  for (const factor of candidates) {
    const implied = raw / factor;
    const relErr = Math.abs(implied - target) / target;
    if (relErr < bestErr) {
      bestErr = relErr;
      best = factor;
    }
  }

  // Evitar sobreajuste: si no hay match razonable, conservar factor 1.
  return bestErr <= 0.05 ? best : 1;
}


// ─── Asset classification ───────────────────────────────

interface IebClassification {
  clase: Position['clase_activo'];
  formaLegal: Position['forma_legal'];
  monedaSubtipo: string | null;
  warnings: string[];
}

function classifyAsset(
  tipoEspecie: number,
  ticker: string,
  descripcion: string,
  opts: ParseOptions
): IebClassification {
  const warnings: string[] = [];

  // Cash tickers override
  if (CASH_TICKERS.has(ticker)) {
    let subtipo: string | null = null;
    if (ticker === 'Pesos') subtipo = null;
    else if (ticker === 'USD' || ticker === 'DOLAR EXT.') subtipo = 'MEP';
    else if (ticker === 'DOLARUSA') subtipo = '7000';
    return { clase: 'cash', formaLegal: null, monedaSubtipo: subtipo, warnings };
  }

  const baseClase = TIPO_ESPECIE_MAP[tipoEspecie] ?? 'other';
  if (baseClase === 'other' && tipoEspecie !== 0) {
    warnings.push(`SubtotalTipoEspecie desconocido: ${tipoEspecie}`);
  }

  // ─── Refine tipo 0 (equity genérico) ───
  if (tipoEspecie === 0) {
    const isCedear = /CEDEAR\s/i.test(descripcion);

    // Check tickers metadata for ETF
    const meta = opts.tickers_metadata?.[ticker];
    if (meta?.es_etf) {
      return {
        clase: 'etf',
        formaLegal: isCedear ? 'cedear' : 'directa',
        monedaSubtipo: null,
        warnings,
      };
    }

    if (isCedear) {
      return { clase: 'cedear', formaLegal: 'cedear', monedaSubtipo: null, warnings };
    }

    // Local AR equity
    return { clase: 'equity', formaLegal: 'directa', monedaSubtipo: null, warnings };
  }

  // ─── Tipo 1 = bond ───
  if (tipoEspecie === 1) {
    return { clase: 'bond', formaLegal: 'bono_local', monedaSubtipo: null, warnings };
  }

  // ─── Tipo 3 = ON ───
  if (tipoEspecie === 3) {
    return { clase: 'on', formaLegal: 'on_local', monedaSubtipo: null, warnings };
  }

  // ─── Tipo 5 = FCI ───
  if (tipoEspecie === 5) {
    return { clase: 'fund', formaLegal: null, monedaSubtipo: null, warnings };
  }

  // ─── Tipo 6 = letra ───
  if (tipoEspecie === 6) {
    return { clase: 'letra', formaLegal: 'bono_local', monedaSubtipo: null, warnings };
  }

  return { clase: baseClase, formaLegal: null, monedaSubtipo: null, warnings };
}

// ─── Totalizadora detection ─────────────────────────────

function isTotalizadora(
  ticker: string,
  participacion: number,
  row: unknown[],
  colIdx: IebColumnIndex
): boolean {
  // Ticker = "-" and (participacion = 100 or participacion = 0 with no real data)
  if (ticker !== '-') return false;

  const descripcion = String(row[colIdx.especie] ?? '').trim();
  if (descripcion !== '-') return false;

  // These are aggregate rows with no real position data
  return true;
}

// ─── Column index mapper ────────────────────────────────

interface IebColumnIndex {
  id: number;
  comitente: number;
  nombre: number;
  productor: number | null;
  codigoEspecie: number;
  ticker: number;
  especie: number;
  participacion: number;
  cantidad: number;
  precio: number;
  importe: number;
  costo: number;
  variacion: number;
  resultado: number;
  tipoCambio: number;
  tipoEspecie: number;
  numeroProductor: number | null;
}

interface IebResumenColumnIndex {
  comitente: number;
  nombre: number;
  productor: number | null;
  totalPosicion: number;
  fechaConsulta: number | null;
}

function mapColumns(headerRow: unknown[]): IebColumnIndex {
  const headers = headerRow.map((h) => String(h ?? '').trim());

  const norm = (value: string): string =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\s_\-./]/g, '')
      .toLowerCase();

  const normalizedIndex = new Map<string, number>();
  headers.forEach((h, idx) => {
    const key = norm(h);
    if (!normalizedIndex.has(key)) normalizedIndex.set(key, idx);
  });

  const find = (label: string, aliases: string[] = []): number => {
    const candidates = [label, ...aliases].map(norm);
    for (const candidate of candidates) {
      const idx = normalizedIndex.get(candidate);
      if (idx != null) return idx;
    }
    throw new Error(`Column "${label}" not found in IEB header`);
  };

  const findOptional = (label: string, aliases: string[] = []): number | null => {
    const candidates = [label, ...aliases].map(norm);
    for (const candidate of candidates) {
      const idx = normalizedIndex.get(candidate);
      if (idx != null) return idx;
    }
    return null;
  };

  return {
    id: find('id', ['Id']),
    comitente: find('Comitente'),
    nombre: find('Nombre'),
    productor: findOptional('Productor', ['Manager', 'Asesor', 'Advisor']),
    codigoEspecie: find('SubtotalCodigoEspecie', ['CodigoEspecie', 'Codigo']),
    ticker: find('Ticker'),
    especie: find('SubtotalEspecie', ['Especie', 'Descripcion', 'DescripcionEspecie']),
    participacion: find('SubtotalParticipacion', ['Participacion']),
    cantidad: find('SubtotalCantidad', ['Cantidad']),
    precio: find('SubtotalPrecio', ['Precio']),
    importe: find('SubtotalImporte', ['Importe', 'ValorMercado', 'Valuacion']),
    costo: find('SubtotalCosto', ['Costo']),
    variacion: find('SubtotalVariacion', ['Variacion']),
    resultado: find('SubtotalResultado', ['Resultado']),
    tipoCambio: find('TipoCambio', ['TC', 'TipoDeCambio']),
    tipoEspecie: find('SubtotalTipoEspecie', ['TipoEspecie']),
    numeroProductor: findOptional('numeroProductor', ['NumeroProductor']),
  };
}

function mapColumnsResumen(headerRow: unknown[]): IebResumenColumnIndex {
  const headers = headerRow.map((h) => String(h ?? '').trim());

  const norm = (value: string): string =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\s_\-./]/g, '')
      .toLowerCase();

  const normalizedIndex = new Map<string, number>();
  headers.forEach((h, idx) => {
    const key = norm(h);
    if (!normalizedIndex.has(key)) normalizedIndex.set(key, idx);
  });

  const find = (label: string, aliases: string[] = []): number => {
    for (const key of [label, ...aliases].map(norm)) {
      const idx = normalizedIndex.get(key);
      if (idx != null) return idx;
    }
    throw new Error(`Column "${label}" not found in IEB summary header`);
  };

  const findOptional = (label: string, aliases: string[] = []): number | null => {
    for (const key of [label, ...aliases].map(norm)) {
      const idx = normalizedIndex.get(key);
      if (idx != null) return idx;
    }
    return null;
  };

  return {
    comitente: find('Comitente'),
    nombre: find('Nombre'),
    productor: findOptional('Productor', ['Manager', 'Asesor', 'Advisor']),
    totalPosicion: find('TotalPosicion', ['Total', 'ValorTotal']),
    fechaConsulta: findOptional('FechaConsulta', ['Fecha']),
  };
}

function parseIebResumenByComitente(
  rows: unknown[][],
  filename: string,
  opts: ParseOptions
): ParseResult {
  const positions: Position[] = [];
  const errors: ParseError[] = [];
  const warnings: string[] = [];
  const cuentasSet = new Set<string>();
  const headerRow = rows[0] ?? [];
  const colIdx = mapColumnsResumen(headerRow);
  const productoresDetectados = new Set<string>();
  let fechaMetadata = opts.fecha_reporte_override ?? '';

  warnings.push(
    'IEB en formato resumen por comitente: se genera una posición sintética CASH por cuenta (sin detalle por instrumento).'
  );

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const comitente = String(row[colIdx.comitente] ?? '').trim();
    const nombre = String(row[colIdx.nombre] ?? '').trim();
    if (!comitente || !nombre) continue;

    const totalPos = parseNumeric(row[colIdx.totalPosicion]) ?? 0;
    const productor =
      colIdx.productor != null ? String(row[colIdx.productor] ?? '').trim() || null : null;
    if (productor) productoresDetectados.add(productor);
    cuentasSet.add(comitente);

    const fechaRaw =
      colIdx.fechaConsulta != null ? String(row[colIdx.fechaConsulta] ?? '').trim() : '';
    const fechaReporte =
      opts.fecha_reporte_override ??
      (fechaRaw || new Date().toISOString().slice(0, 10));
    if (!fechaMetadata) fechaMetadata = fechaReporte;

    const { normalizado, tipo_titular } = normalizeTitular(nombre);
    const aliasMap: Record<string, string> = opts.aliases ?? {};
    const clienteId = generateClienteIdSync(normalizado, aliasMap);

    const valorUsd =
      opts.fx_manual && opts.fx_manual > 0 ? totalPos / opts.fx_manual : null;
    const fxSource: Position['fx_source'] = opts.fx_manual && opts.fx_manual > 0 ? 'manual' : 'default';

    positions.push({
      cliente_id: clienteId,
      titular: nombre,
      titular_normalizado: normalizado,
      tipo_titular,
      grupo_id: null,
      broker: BROKER_CODE,
      cuenta: comitente,
      tipo_cuenta: null,
      productor,
      fecha_reporte: fechaReporte,
      ticker: 'CASH',
      isin: null,
      cusip: null,
      descripcion: 'IEB Resumen por comitente',
      clase_activo: 'cash',
      forma_legal: null,
      pais_emisor: null,
      cantidad: 1,
      cantidad_disponible: null,
      cantidad_no_disponible: null,
      precio_mercado: null,
      moneda: 'ARS',
      moneda_subtipo: null,
      valor_mercado_local: totalPos,
      valor_mercado_usd: valorUsd,
      accrued_interest_usd: null,
      fx_source: fxSource,
      pct_portfolio: null,
      source_file: filename,
      source_row: i,
      warnings: [],
    });
  }

  const productorMetadata =
    productoresDetectados.size === 1
      ? Array.from(productoresDetectados)[0]!
      : productoresDetectados.size > 1
        ? 'MULTIPLE'
        : null;

  return makeResult(
    positions,
    errors,
    warnings,
    cuentasSet,
    fechaMetadata,
    filename,
    productorMetadata
  );
}

// ─── Result builder ─────────────────────────────────────

function makeResult(
  positions: Position[],
  errors: ParseError[],
  warnings: string[],
  cuentas: Set<string>,
  fechaReporte: string,
  filename: string,
  productor: string | null
): ParseResult {
  const totalArs = positions.reduce((s, p) => s + p.valor_mercado_local, 0);

  return {
    positions,
    errors,
    warnings,
    metadata: {
      broker: BROKER_CODE,
      cuentas_detectadas: Array.from(cuentas),
      fecha_reporte: fechaReporte,
      totales_originales: { total_valor_mercado_ars: totalArs },
      productor,
      filename,
    },
  };
}

// ─── Export ──────────────────────────────────────────────

export const iebParser: BrokerParser = {
  code: BROKER_CODE,
  detect,
  parse,
};
