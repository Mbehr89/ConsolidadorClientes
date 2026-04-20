/**
 * Parser: GMA
 *
 * Layout: pivoteado por especie con secciones jerárquicas.
 *   R0: header row (Comitente, Tenencia Disponible, etc.)
 *   Bloques:
 *     Nivel 1 (solo col 0): clase + moneda, ej "Acciones / Pesos", "Dolar Cable (exterior)"
 *     Nivel 2 (solo col 0): ticker - código / descripción, ej "AAPL - 8445 / CEDEAR APPLE INC."
 *     Data rows: comitente + cantidades + valuaciones
 *     Total rows: col 11 starts with "Total"
 *
 * Sin nombres de titulares — solo nº de comitente → mapping externo.
 * Moneda depende del bloque (ARS o USD según sección).
 * Fecha: col 7 ("15/04/2026").
 */
import type { WorkBook } from 'xlsx';
import { utils as xlsxUtils } from 'xlsx';
import type { BrokerParser, ParseOptions } from './types';
import type { Position, ParseError, ParseResult, DetectResult } from '../schema';
import { WARNING_CODES } from '../schema';
import { normalizeTitular, generateClienteIdSync } from '../matching';
import { parseBrokerDate, parseNumeric } from '../fx';

// ─── Constants ──────────────────────────────────────────

const BROKER_CODE = 'GMA' as const;

/** Sección nivel 1 → clase_activo + moneda */
const SECCION_MAP: Record<string, { clase: Position['clase_activo']; formaLegal: Position['forma_legal']; monedaEmision: string }> = {
  'Acciones': { clase: 'equity', formaLegal: 'directa', monedaEmision: 'ARS' },
  'Cedears': { clase: 'cedear', formaLegal: 'cedear', monedaEmision: 'ARS' },
  'Fondos': { clase: 'fund', formaLegal: null, monedaEmision: 'ARS' },
  'LETRAS TESORO': { clase: 'letra', formaLegal: 'bono_local', monedaEmision: 'ARS' },
  'Obligaciones Negociables': { clase: 'on', formaLegal: 'on_local', monedaEmision: 'USD' },
  'Opciones': { clase: 'option', formaLegal: null, monedaEmision: 'ARS' },
  'Títulos Públicos': { clase: 'bond', formaLegal: 'bono_local', monedaEmision: 'USD' },
};

/** Moneda subtipo keywords en sección nivel 1 */
const MONEDA_SUBTIPO_MAP: Record<string, string> = {
  'Dolar 10000': '10000',
  'Dolar 7000': '7000',
  'Dolar Cable': 'CABLE',
  'Dolar MEP': 'MEP',
  'Euros': 'EUR',
  'Pesos': 'ARS',
};

// ─── Detect ─────────────────────────────────────────────

function detect(workbook: WorkBook, filename: string): DetectResult {
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { matches: false, confidence: 0, reason: 'No sheets' };
  }

  const sheet = workbook.Sheets[sheetName]!;
  const rows: unknown[][] = xlsxUtils.sheet_to_json(sheet, { header: 1 });

  // Check header: "Comitente" in col 0, "Tenencia: Disponible" in col 1
  const r0 = rows[0];
  if (r0) {
    const col0 = String(r0[0] ?? '').trim();
    const col1 = String(r0[1] ?? '').trim();
    if (col0 === 'Comitente' && col1.includes('Tenencia')) {
      return {
        matches: true,
        confidence: 0.95,
        reason: 'Header: Comitente + Tenencia (GMA format)',
      };
    }
  }

  // Check for section headers like "Dolar 10000", "Acciones / Pesos"
  for (let i = 1; i < Math.min(30, rows.length); i++) {
    const row = rows[i];
    if (!row) continue;
    const col0 = String(row[0] ?? '').trim();
    const otherFilled = row.slice(1).some((c) => c != null && String(c).trim() !== '');
    if (col0.includes('Dolar 10000') && !otherFilled) {
      return {
        matches: true,
        confidence: 0.90,
        reason: 'Found "Dolar 10000" section header (GMA format)',
      };
    }
  }

  // Filename heuristic
  if (/valuacion/i.test(filename)) {
    return {
      matches: true,
      confidence: 0.5,
      reason: 'Filename contains "valuacion"',
    };
  }

  return { matches: false, confidence: 0, reason: 'No GMA markers found' };
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
    return makeResult(positions, errors, warnings, cuentasSet, '', filename, null);
  }

  const sheet = workbook.Sheets[sheetName]!;
  const rows: unknown[][] = xlsxUtils.sheet_to_json(sheet, { header: 1 });

  // ─── State machine: track current section ───
  let currentSeccion1: string | null = null;  // "Acciones / Pesos", "Dolar 10000", etc.
  let currentSeccion2: string | null = null;  // "AAPL - 8445 / CEDEAR APPLE INC."
  let currentTicker: string | null = null;
  let currentDescripcion: string = '';
  let currentClase: Position['clase_activo'] = 'other';
  let currentFormaLegal: Position['forma_legal'] = null;
  let currentMonedaSubtipo: string | null = null;
  let currentIsCashBlock = false;
  let fechaReporte = '';
  const headerRow = rows[0] ?? [];
  const productorColIdx = findOptionalColumnIndex(headerRow, [
    'Productor',
    'Manager',
    'Asesor',
    'Advisor',
  ]);
  const productoresDetectados = new Set<string>();

  for (let i = 1; i < rows.length; i++) { // skip header R0
    const row = rows[i];
    if (!row) continue;

    const col0 = String(row[0] ?? '').trim();
    const otherFilled = row.slice(1).some((c) => c != null && String(c).trim() !== '');

    // ─── Empty row → skip ───
    if (!col0 && !otherFilled) continue;

    // ─── Total row → skip (checksum) ───
    const col11 = String(row[11] ?? '').trim();
    if (col11.startsWith('Total') && !col0) continue;

    // ─── Section header level 1: solo col 0, text largo, sin datos ───
    if (col0 && !otherFilled) {
      // Determine if it's level 1 or level 2
      if (isSeccionNivel1(col0)) {
        currentSeccion1 = col0;
        currentSeccion2 = null;
        currentTicker = null;

        // Classify the section
        const secInfo = classifySeccion(col0);
        currentClase = secInfo.clase;
        currentFormaLegal = secInfo.formaLegal;
        currentMonedaSubtipo = secInfo.monedaSubtipo;
        currentIsCashBlock = secInfo.isCash;
        continue;
      }

      // Level 2: ticker + description (e.g. "AAPL - 8445 / CEDEAR APPLE INC.")
      // or currency description (e.g. "USD 7000 - Dolar 7000")
      currentSeccion2 = col0;
      const parsed = parseSeccion2(col0);
      currentTicker = parsed.ticker;
      currentDescripcion = parsed.descripcion;

      // For cash currency blocks, level 2 just refines the label
      if (currentIsCashBlock) {
        currentTicker = null; // cash doesn't have meaningful ticker
      }
      continue;
    }

    // ─── Data row: col 0 is comitente (numeric string), other cols have data ───
    if (col0 && /^\d+$/.test(col0) && otherFilled) {
      const comitente = col0;
      cuentasSet.add(comitente);

      try {
        const pos = parseDataRow(
          row,
          i,
          comitente,
          filename,
          opts,
          currentTicker,
          currentDescripcion,
          currentClase,
          currentFormaLegal,
          currentMonedaSubtipo,
          currentIsCashBlock,
          productorColIdx
        );
        if (pos) {
          positions.push(pos);
          if (pos.productor) productoresDetectados.add(pos.productor);
          if (pos.fecha_reporte && !fechaReporte) {
            fechaReporte = pos.fecha_reporte;
          }
        }
      } catch (err) {
        errors.push({
          row: i,
          field: null,
          message: `Error parseando fila: ${err instanceof Error ? err.message : String(err)}`,
          severity: 'error',
        });
      }
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

// ─── Data row parser ────────────────────────────────────

function parseDataRow(
  row: unknown[],
  rowNum: number,
  comitente: string,
  filename: string,
  opts: ParseOptions,
  ticker: string | null,
  descripcion: string,
  claseActivo: Position['clase_activo'],
  formaLegal: Position['forma_legal'],
  monedaSubtipo: string | null,
  isCashBlock: boolean,
  productorColIdx: number | null
): Position | null {
  // Columns: 0=Comitente, 1=Disponible, 2=NoDisponible, 3=TotalValorNeto,
  //   4=PPP, 5=CotizMonedaEmision, 6=ValuacionMonedaEmision,
  //   7=FechaLocal, 8=CotizMonedaLocal, 9=Rendimiento,
  //   10=%Rendimiento, 11=ValuacionMonedaLocal, 12=%

  const disponible = parseNumeric(row[1]) ?? 0;
  const noDisponible = parseNumeric(row[2]) ?? 0;
  const totalNeto = parseNumeric(row[3]) ?? 0;
  const cotizEmision = parseNumeric(row[5]) ?? 0;
  const valuacionEmision = parseNumeric(row[6]) ?? 0;
  const fechaStr = String(row[7] ?? '').trim();
  const cotizLocal = parseNumeric(row[8]) ?? 0;
  const valuacionLocal = parseNumeric(row[11]) ?? 0;

  const posWarnings: string[] = [];

  // ─── Parse fecha ───
  let fechaReporte = '';
  if (fechaStr) {
    try {
      fechaReporte = parseBrokerDate(fechaStr, BROKER_CODE);
    } catch {
      posWarnings.push(`${WARNING_CODES.FECHA_DESALINEADA}: ${fechaStr}`);
    }
  }

  // ─── Cautela / no disponible ───
  if (noDisponible > 0) {
    posWarnings.push(WARNING_CODES.CAUTELA_DETECTADA);
  }

  // ─── Resolve titular/productor from mapping ───
  const mappedTitular = opts.mapping_cuentas?.[comitente];
  const mappedProductor = opts.mapping_productor?.[comitente];
  const titularRaw = mappedTitular ?? `GMA-${comitente}`;
  const productorFromFile =
    productorColIdx != null ? String(row[productorColIdx] ?? '').trim() || null : null;
  const productorRaw = mappedProductor ?? productorFromFile;

  if (!mappedTitular) {
    posWarnings.push(WARNING_CODES.TITULAR_NO_MAPEADO);
  }

  const { normalizado, tipo_titular } = normalizeTitular(titularRaw);
  const aliasMap: Record<string, string> = opts.aliases ?? {};
  const clienteId = generateClienteIdSync(normalizado, aliasMap);

  // ─── FX logic ───
  let valorMercadoUsd: number | null = null;
  let fxSource: Position['fx_source'] = 'manual';
  let moneda = 'ARS';

  if (isCashBlock) {
    // Cash blocks: cotizLocal is the FX rate (or 1 for pesos)
    if (monedaSubtipo === 'ARS' || monedaSubtipo === null) {
      // Pesos
      moneda = 'ARS';
      if (opts.fx_manual && opts.fx_manual > 0) {
        valorMercadoUsd = valuacionLocal / opts.fx_manual;
        fxSource = 'manual';
      }
    } else {
      // USD cash in various modalities
      moneda = 'ARS'; // reported in ARS
      if (cotizLocal > 1) {
        valorMercadoUsd = valuacionLocal / cotizLocal;
        fxSource = 'broker';
      } else if (opts.fx_manual && opts.fx_manual > 0) {
        valorMercadoUsd = valuacionLocal / opts.fx_manual;
        fxSource = 'manual';
      }
    }
  } else {
    // Instrument blocks
    if (cotizLocal > 1 && cotizEmision !== cotizLocal) {
      // Broker provided FX: cotizLocal is ARS price, cotizEmision is native currency price
      valorMercadoUsd = valuacionEmision; // Already in emisor currency (USD for bonds/ONs)
      fxSource = 'broker';
    } else if (cotizEmision === cotizLocal) {
      // ARS instrument (acciones, CEDEARs) — cotiz is ARS price
      moneda = 'ARS';
      if (opts.fx_manual && opts.fx_manual > 0) {
        valorMercadoUsd = valuacionLocal / opts.fx_manual;
        fxSource = 'manual';
      }
    } else if (opts.fx_manual && opts.fx_manual > 0) {
      valorMercadoUsd = valuacionLocal / opts.fx_manual;
      fxSource = 'manual';
    }
  }

  // ─── Pais emisor ───
  let paisEmisor: string | null = null;
  if (ticker && opts.tickers_metadata?.[ticker]) {
    paisEmisor = opts.tickers_metadata[ticker]!.pais;
  }

  // ─── ETF override ───
  let claseActivoFinal = claseActivo;
  let formaLegalFinal = formaLegal;
  if (ticker && opts.tickers_metadata?.[ticker]?.es_etf) {
    claseActivoFinal = 'etf';
    // Preserve formaLegal from section (cedear if in Cedears block)
  }

  // ─── Ticker no confirmado ───
  if (ticker && opts.tickers_metadata && !opts.tickers_metadata[ticker]?.confirmado) {
    posWarnings.push(WARNING_CODES.TICKER_NO_CONFIRMADO);
  }

  // ─── Residual ───
  if (Math.abs(valuacionLocal) > 0 && Math.abs(valuacionLocal) < 1) {
    posWarnings.push(WARNING_CODES.POSICION_RESIDUAL);
  }

  const normalizedTicker = claseActivoFinal === 'cash' ? 'CASH' : ticker;

  const position: Position = {
    cliente_id: clienteId,
    titular: titularRaw,
    titular_normalizado: normalizado || titularRaw,
    tipo_titular,
    grupo_id: null,

    broker: BROKER_CODE,
    cuenta: comitente,
    tipo_cuenta: null,
    productor: productorRaw,
    fecha_reporte: fechaReporte,

    ticker: normalizedTicker,
    isin: null,
    cusip: null,
    descripcion: descripcion || (isCashBlock ? `Cash ${monedaSubtipo ?? 'ARS'}` : ''),

    clase_activo: claseActivoFinal,
    forma_legal: formaLegalFinal,
    pais_emisor: paisEmisor,

    cantidad: totalNeto,
    cantidad_disponible: disponible > 0 ? disponible : null,
    cantidad_no_disponible: noDisponible > 0 ? noDisponible : null,
    precio_mercado: cotizEmision > 0 ? cotizEmision : null,
    moneda,
    moneda_subtipo: monedaSubtipo,
    valor_mercado_local: valuacionLocal,
    valor_mercado_usd: valorMercadoUsd,
    accrued_interest_usd: null,
    fx_source: fxSource,
    pct_portfolio: null,

    source_file: filename,
    source_row: rowNum,
    warnings: posWarnings,
  };

  return position;
}


// ─── Section parsing helpers ────────────────────────────

function isSeccionNivel1(text: string): boolean {
  // Level 1: "Acciones / Pesos", "Dolar 10000", "Cedears / Pesos",
  //   "Obligaciones Negociables / Dolar MEP (local)", etc.
  // Also: standalone labels like "Dolar 10000", "Euros", "Pesos"
  const nivel1Patterns = [
    /^(Acciones|Cedears|Fondos|LETRAS TESORO|Obligaciones Negociables|Opciones|Títulos Públicos)\s*\//i,
    /^Dolar\s+(10000|7000|Cable|MEP)/i,
    /^Euros$/i,
    /^Pesos$/i,
  ];
  return nivel1Patterns.some((p) => p.test(text));
}

interface SeccionInfo {
  clase: Position['clase_activo'];
  formaLegal: Position['forma_legal'];
  monedaSubtipo: string | null;
  isCash: boolean;
}

function classifySeccion(text: string): SeccionInfo {
  // Check cash blocks first
  for (const [keyword, subtipo] of Object.entries(MONEDA_SUBTIPO_MAP)) {
    if (text.toLowerCase().startsWith(keyword.toLowerCase())) {
      return {
        clase: 'cash',
        formaLegal: null,
        monedaSubtipo: subtipo === 'ARS' ? null : subtipo,
        isCash: true,
      };
    }
  }

  // Check instrument sections
  for (const [keyword, info] of Object.entries(SECCION_MAP)) {
    if (text.toLowerCase().includes(keyword.toLowerCase())) {
      // Extract moneda subtipo from section (e.g. "Obligaciones Negociables / Dolar MEP")
      let monedaSubtipo: string | null = null;
      if (text.includes('Dolar Cable') || text.includes('Dolar Cable (exterior)')) {
        monedaSubtipo = 'CABLE';
      } else if (text.includes('Dolar MEP') || text.includes('Dolar MEP (local)')) {
        monedaSubtipo = 'MEP';
      }

      return {
        clase: info.clase,
        formaLegal: info.formaLegal,
        monedaSubtipo,
        isCash: false,
      };
    }
  }

  return { clase: 'other', formaLegal: null, monedaSubtipo: null, isCash: false };
}

/** Parse level 2 section header to extract ticker and description */
function parseSeccion2(text: string): { ticker: string | null; descripcion: string } {
  // Pattern: "AAPL - 8445 / CEDEAR APPLE INC."
  // or: "GD30 - 81086 / B.E.GLOBALES U$S STEP UP 2030"
  // or: "USD 7000 - Dolar 7000" (cash)
  // or: "SBSAPEA - SBS AHORRO PESOS Clase A / SBSAPEA" (FCI)

  const slashIdx = text.indexOf(' / ');
  const dashIdx = text.indexOf(' - ');

  if (dashIdx > 0) {
    const ticker = text.slice(0, dashIdx).trim();

    let descripcion: string;
    if (slashIdx > dashIdx) {
      descripcion = text.slice(slashIdx + 3).trim();
    } else {
      descripcion = text.slice(dashIdx + 3).trim();
    }

    return { ticker, descripcion };
  }

  return { ticker: null, descripcion: text };
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

function findOptionalColumnIndex(headerRow: unknown[], names: string[]): number | null {
  const headers = headerRow.map((h) => String(h ?? '').trim().toLowerCase());
  for (const name of names) {
    const idx = headers.indexOf(name.toLowerCase());
    if (idx >= 0) return idx;
  }
  return null;
}

// ─── Export ──────────────────────────────────────────────

export const gmaParser: BrokerParser = {
  code: BROKER_CODE,
  detect,
  parse,
};
