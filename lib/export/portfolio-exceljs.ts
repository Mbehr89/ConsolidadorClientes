/**
 * Generador de Excel tipo “master” (ExcelJS) — hojas formateadas, colores, validaciones ligeras.
 * Los datos se derivan de `Position[]` del consolidador.
 */
import ExcelJS from 'exceljs';
import { BROKERS } from '@/lib/brokers';
import { aggregateByField, aggregateInstrumentGroups, concentrationFlags, instrumentKey, totalAumUsd } from '@/lib/analysis/exposure';
import { detectInconsistencies, type Inconsistency } from '@/lib/analysis/inconsistencies';
import { buildClienteSummaries } from '@/lib/views/cliente-summary';
import { filterBondEventsByViewMode, type BondFlowViewMode } from '@/lib/bonds/flow-regime';
import { reviveBondEventsFromApi } from '@/lib/bonds/revive';
import type { BondPaymentEvent } from '@/lib/bonds/types';
import { normalizeBondTicker } from '@/lib/bonds/ticker-normalize';
import type { BrokerCode, Position } from '@/lib/schema';

const ALL_BROKER_CODES: BrokerCode[] = ['MS', 'NETX360', 'GMA', 'IEB'];

// ── Paleta (alineada al ejemplo de referencia) ───────────────────────
const COLORS = {
  violet: 'FF6B3FA0',
  violetDark: 'FF4A2C6E',
  violetLight: 'FF9B7BC7',
  cream: 'FFFDF6EC',
  gold: 'FFD4A843',
  terracotta: 'FFC75B39',
  peach: 'FFF5C6AA',
  lavender: 'FFD8C4E8',
  white: 'FFFFFFFF',
  headerBg: 'FF4A2C6E',
  headerFont: 'FFFFFFFF',
  altRow: 'FFF8F4FF',
  alertHigh: 'FFFF4444',
  alertMed: 'FFFFAA00',
  alertLow: 'FF44AA44',
  yellowInput: 'FFFFFF00',
  cyanDuplicate: 'FFE0FFFF',
};

const HEADER_STYLE: Partial<ExcelJS.Style> = {
  font: { bold: true, color: { argb: COLORS.headerFont }, size: 11, name: 'Calibri' },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } },
  alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
  border: {
    top: { style: 'thin', color: { argb: COLORS.violetLight } },
    bottom: { style: 'thin', color: { argb: COLORS.violetLight } },
  },
};

const TITLE_STYLE: Partial<ExcelJS.Style> = {
  font: { bold: true, size: 16, color: { argb: COLORS.violetDark }, name: 'Calibri' },
};

const SUBTITLE_STYLE: Partial<ExcelJS.Style> = {
  font: { size: 11, color: { argb: COLORS.violet }, name: 'Calibri' },
};

export interface ExportPortfolioOptions {
  filename?: string;
  /** USD → ARS: valor_ars = valor_usd × tc. Si no se informa, la columna ARS queda vacía. */
  fxUsdArs?: number | null;
  /** Misma ley/AFIP que en ficha de cliente. Default: ley general. */
  bondFlowViewMode?: BondFlowViewMode;
}

function tabArgb(hex: string): { argb: string } {
  return { argb: hex.startsWith('FF') && hex.length === 8 ? hex : `FF${hex.replace(/^#/, '')}` };
}

function localDateYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Misma lógica que en ficha cliente/grupo: eventos de calendario filtrados al nominal agregado por ticker.
 */
function computeBondFlowForPortfolio(
  positions: Position[],
  bondEvents: BondPaymentEvent[]
): {
  flowRows: { ev: BondPaymentEvent; intereses: number; amortizacion: number }[];
  missingTickers: string[];
  bondTickersInBook: string[];
} {
  const bondPositions = positions.filter(
    (p) => p.clase_activo === 'bond' || p.clase_activo === 'on' || p.clase_activo === 'letra'
  );
  const nominalByTicker = new Map<string, number>();
  for (const p of bondPositions) {
    const t = normalizeBondTicker(p.ticker);
    if (!t) continue;
    const n = Number.isFinite(p.cantidad) ? p.cantidad : 0;
    nominalByTicker.set(t, (nominalByTicker.get(t) ?? 0) + n);
  }
  const portfolioBondTickers = new Set([...nominalByTicker.keys()]);
  const calendarTickers = new Set(bondEvents.map((ev) => normalizeBondTicker(ev.asset)).filter(Boolean));
  const missingTickers = [...portfolioBondTickers].filter((t) => !calendarTickers.has(t)).sort();

  const flowRows = bondEvents
    .filter((ev) => portfolioBondTickers.has(normalizeBondTicker(ev.asset)))
    .map((ev) => {
      const nominal = nominalByTicker.get(normalizeBondTicker(ev.asset)) ?? 0;
      const intereses = ((ev.couponPer100 ?? 0) / 100) * nominal;
      const amortizacion = ((ev.amortizationPer100 ?? 0) / 100) * nominal;
      return { ev, intereses, amortizacion };
    })
    .sort((a, b) => {
      const t = a.ev.asset.localeCompare(b.ev.asset);
      if (t !== 0) return t;
      return a.ev.date.getTime() - b.ev.date.getTime();
    });

  return {
    flowRows,
    missingTickers,
    bondTickersInBook: [...portfolioBondTickers].sort(),
  };
}

function fechasResumen(positions: Position[]): string {
  const fechas = [...new Set(positions.map((p) => p.fecha_reporte))].sort();
  if (fechas.length === 0) return '—';
  if (fechas.length === 1) return fechas[0]!;
  return `${fechas[0]} → ${fechas[fechas.length - 1]} (${fechas.length} fechas)`;
}

function brokersSetForKey(positions: Position[], key: string): Set<BrokerCode> {
  const s = new Set<BrokerCode>();
  for (const p of positions) {
    if (instrumentKey(p) === key) s.add(p.broker);
  }
  return s;
}

function firstPaisForKey(positions: Position[], key: string): string {
  for (const p of positions) {
    if (instrumentKey(p) === key) {
      if (p.pais_emisor) return p.pais_emisor;
    }
  }
  return '—';
}

function groupQtyAndPrices(positions: Position[], key: string): { qty: number; usd: number; avgPriceUsd: number | null } {
  let qty = 0;
  let usd = 0;
  let pxNum = 0;
  let pxDen = 0;
  for (const p of positions) {
    if (instrumentKey(p) !== key) continue;
    qty += p.cantidad;
    const v = p.valor_mercado_usd ?? 0;
    usd += v;
    if (p.precio_mercado != null && p.precio_mercado > 0 && v > 0) {
      pxNum += p.precio_mercado * v;
      pxDen += v;
    }
  }
  const avgPriceUsd = pxDen > 0 ? pxNum / pxDen : Math.abs(qty) > 1e-9 ? usd / Math.abs(qty) : null;
  return { qty, usd, avgPriceUsd };
}

interface SummaryLine {
  category: string;
  totalARS: number;
  totalUSD: number;
  weight: number;
}

function toSummaryFromAggregate(
  agg: Record<string, number>,
  totalUsd: number,
  fx: number | null
): SummaryLine[] {
  return Object.entries(agg)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({
      category: k,
      totalARS: fx != null && fx > 0 ? v * fx : 0,
      totalUSD: v,
      weight: totalUsd > 0 ? v / totalUsd : 0,
    }));
}

type DupRow = { key: string; description: string };

function findCrossBrokerDuplicates(positions: Position[]): DupRow[] {
  const m = new Map<string, { brokers: Set<BrokerCode>; descripcion: string; ticker: string | null }>();
  for (const p of positions) {
    const k = instrumentKey(p);
    let e = m.get(k);
    if (!e) {
      e = { brokers: new Set(), descripcion: p.descripcion, ticker: p.ticker };
      m.set(k, e);
    }
    e.brokers.add(p.broker);
    if (p.ticker) e.ticker = p.ticker;
  }
  const out: DupRow[] = [];
  for (const [key, e] of m) {
    if (e.brokers.size <= 1) continue;
    out.push({
      key,
      description: e.ticker ? `${e.ticker} — ${e.descripcion.slice(0, 80)}` : e.descripcion.slice(0, 120),
    });
  }
  out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}

type AlertRow = {
  type: string;
  detail: string;
  value: number;
  weight: number;
  level: 'ALTA' | 'MEDIA';
  recommendation: string;
};

function buildAlertsFromConcentration(positions: Position[], total: number): AlertRow[] {
  const flags = concentrationFlags(positions, { positionPct: 5, clientPct: 20 });
  return flags.map((f) => {
    const w = total > 0 ? f.value / 100 : 0;
    const isAlta = f.value >= f.threshold * 1.5;
    return {
      type: f.type === 'position' ? 'Concentración posición' : 'Concentración cliente',
      detail: f.description,
      value: 0,
      weight: w,
      level: isAlta ? 'ALTA' : 'MEDIA',
      recommendation: 'Revisar exposición y límites de mandato / política de inversión.',
    };
  });
}

/** Monto USD aprox. = % portfolio × AUM. */
function normalizeAlertsForSheet(alerts: AlertRow[], total: number): AlertRow[] {
  return alerts.map((a) => ({
    ...a,
    value: a.type.startsWith('Concentración') && total > 0 ? a.weight * total : a.value,
  }));
}

type QcRow = { category: string; detail: string; action: string; severity: string };

function inconsistencyToQc(inc: Inconsistency): QcRow {
  const sev = inc.severity === 'error' ? 'Alta' : inc.severity === 'warning' ? 'Media' : 'Baja';
  return {
    category: inc.tipo.replace(/_/g, ' '),
    detail: inc.descripcion,
    action: 'Revisar posiciones afectadas y fuentes de datos',
    severity: sev,
  };
}

/**
 * Escribe el libro y dispara la descarga en el navegador.
 */
export async function exportPortfolioWorkbook(
  positions: Position[],
  options?: ExportPortfolioOptions
): Promise<void> {
  const filename = (options?.filename?.replace(/(\.xlsx)?$/i, '') ?? `Portfolio_Consolidado_Master_${localDateYmd()}`) + '.xlsx';
  const buffer = await buildPortfolioWorkbookBuffer(
    positions,
    options?.fxUsdArs ?? null,
    options?.bondFlowViewMode ?? 'normal'
  );
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function buildPortfolioWorkbookBuffer(
  positions: Position[],
  fxUsdArs: number | null,
  bondFlowViewMode: BondFlowViewMode = 'normal'
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'consolidador-tenencias';
  workbook.created = new Date();

  const totalUSD = totalAumUsd(positions);
  const tc = fxUsdArs != null && fxUsdArs > 0 ? fxUsdArs : null;
  const totalARS = tc != null ? totalUSD * tc : 0;

  const fechas = fechasResumen(positions);
  const brokerCodes = new Set(positions.map((p) => p.broker));
  const cuentas = new Set(positions.map((p) => `${p.broker}:${p.cuenta}`));
  const titulares = new Set(positions.map((p) => p.cliente_id));
  const groups = aggregateInstrumentGroups(positions, false);
  const byClass = aggregateByField(positions, (p) => {
    const c = p.clase_activo as string;
    return c === 'cedear' ? 'equity' : c;
  });
  const byForma = aggregateByField(positions, (p) => p.forma_legal ?? 'sin clasificar');
  const byPais = aggregateByField(
    positions.filter((p) => p.pais_emisor),
    (p) => p.pais_emisor!
  );
  const byLocalOff = aggregateByField(positions, (p) => BROKERS[p.broker].tipo);
  const byMoneda = aggregateByField(positions, (p) => (p.moneda_subtipo ? `${p.moneda} (${p.moneda_subtipo})` : p.moneda));
  const byBroker = aggregateByField(positions, (p) => p.broker);

  const countClase = (c: (typeof positions)[0]['clase_activo']) => positions.filter((p) => p.clase_activo === c).length;
  /** Datos viejos en memoria pueden tener `cedear` hasta re-parseo */
  const legacyCedearCount = () =>
    positions.filter((p) => (p as { clase_activo: string }).clase_activo === 'cedear').length;
  const pendingReview = positions.filter((p) => p.warnings.length > 0).length;
  const posArsCount = positions.filter(
    (p) => p.moneda === 'ARS' || p.moneda_subtipo === 'MEP' || p.moneda_subtipo === 'CCL'
  ).length;

  const instSumm = toSummaryFromAggregate(byClass, totalUSD, tc);
  const typeSumm = toSummaryFromAggregate(byForma, totalUSD, tc);
  const localSumm = toSummaryFromAggregate(byLocalOff, totalUSD, tc);
  const paisSumm = toSummaryFromAggregate(byPais, totalUSD, tc);
  const monedaSumm = toSummaryFromAggregate(byMoneda, totalUSD, tc);
  const brokerSumm = toSummaryFromAggregate(byBroker, totalUSD, tc);

  const top10 = [...groups]
    .sort((a, b) => b.valor_usd - a.valor_usd)
    .slice(0, 10);
  const top10Conc = totalUSD > 0 ? top10.reduce((s, g) => s + g.valor_usd, 0) / totalUSD : 0;

  const inc = detectInconsistencies(positions);
  const rawAlerts = buildAlertsFromConcentration(positions, totalUSD);
  const alerts = normalizeAlertsForSheet(rawAlerts, totalUSD);
  const duplicates = findCrossBrokerDuplicates(positions);
  const qc: QcRow[] = inc.map(inconsistencyToQc);

  const executiveSummary = {
    consolidationDate: fechas,
    exchangeRate: tc,
    totalARS: tc != null ? totalARS : 0,
    totalUSD,
    totalPositions: positions.length,
    totalBrokers: brokerCodes.size,
    totalAccounts: cuentas.size,
    totalTitulars: titulares.size,
    positionsARS: posArsCount,
    positionsUSD: positions.filter((p) => p.moneda === 'USD').length,
    positionsEquity: countClase('equity') + countClase('etf') + legacyCedearCount(),
    positionsFixedIncome: countClase('bond') + countClase('on') + countClase('letra'),
    positionsMoneyMarket: countClase('fund'),
    positionsCash: countClase('cash'),
    unclassifiedPositions: countClase('other'),
    pendingReviewCount: pendingReview,
    alertCount: alerts.length,
    top10Concentration: top10Conc,
  };

  const consolidated = groups.map((g) => {
    const { qty, usd, avgPriceUsd } = groupQtyAndPrices(positions, g.key);
    const bset = brokersSetForKey(positions, g.key);
    const priceUSD = avgPriceUsd ?? 0;
    const priceARS = tc != null && priceUSD ? priceUSD * tc : 0;
    return {
      ticker: g.ticker ?? '—',
      instrumentName: g.descripcion,
      assetType: g.clase_activo,
      sector: firstPaisForKey(positions, g.key),
      totalQuantity: qty,
      priceARS: tc != null ? priceARS : 0,
      priceUSD,
      totalARS: tc != null ? usd * tc : 0,
      totalUSD: usd,
      weight: totalUSD > 0 ? usd / totalUSD : 0,
      brokers: [...bset].sort(),
      brokersLabel: [...bset]
        .sort()
        .map((c) => c as BrokerCode)
        .join(', '),
    };
  });

  buildPortfolioConsolidado(workbook, consolidated, executiveSummary, totalUSD, tc);
  buildBaseConsolidada(workbook, positions, tc);
  buildResumenEjecutivo(workbook, executiveSummary, tc);

  buildSummarySheet(workbook, 'Por_Asset_Class', 'Distribución por Clase de Activo (schema)', instSumm, tc);
  buildSummarySheet(workbook, 'Por_Asset_Type', 'Distribución por Forma Legal / tipo', typeSumm, tc);
  buildSummarySheet(workbook, 'Por_Sector', 'Exposición local vs offshore (custodio)', localSumm, tc);
  buildSummarySheet(workbook, 'Por_Pais', 'Distribución por País de Emisor', paisSumm, tc);
  buildSummarySheet(workbook, 'Por_Moneda', 'Distribución por Moneda / subtipo', monedaSumm, tc);
  buildSummarySheet(workbook, 'Por_Broker', 'Distribución por Broker / Custodio', brokerSumm, tc);

  buildControlCalidad(workbook, qc, alerts, duplicates);
  buildDiccionario(workbook, tc);
  buildPorClienteSheet(workbook, positions, totalUSD);

  let bondEvents: BondPaymentEvent[] = [];
  let bondCalendarMeta: { configured: boolean; warning: string | null } = { configured: false, warning: null };
  try {
    const res = await fetch('/api/bonds/calendar', { cache: 'no-store' });
    const data = (await res.json()) as {
      events?: Array<Record<string, unknown>>;
      configured?: boolean;
      error?: string;
      message?: string;
    };
    if (res.ok) {
      bondCalendarMeta = {
        configured: data.configured === true,
        warning: data.configured ? null : (data.message ?? 'Calendario de bonos no configurado (BOND_PAYMENTS_URL).'),
      };
      if (data.events?.length) {
        bondEvents = filterBondEventsByViewMode(reviveBondEventsFromApi(data.events), bondFlowViewMode);
      }
    } else {
      bondCalendarMeta.warning = typeof data.error === 'string' ? data.error : 'No se pudo cargar el calendario de bonos.';
    }
  } catch {
    bondCalendarMeta.warning = 'No se pudo obtener el calendario de bonos.';
  }

  const bondFlow = computeBondFlowForPortfolio(positions, bondEvents);
  buildFlujoBonosSheet(workbook, positions, bondFlow, bondCalendarMeta, bondFlowViewMode);

  const buf = await workbook.xlsx.writeBuffer();
  if (buf instanceof ArrayBuffer) return buf;
  return new Uint8Array(buf).buffer;
}

function buildPortfolioConsolidado(
  workbook: ExcelJS.Workbook,
  consolidated: {
    ticker: string;
    instrumentName: string;
    assetType: string;
    sector: string;
    totalQuantity: number;
    priceARS: number;
    priceUSD: number;
    totalARS: number;
    totalUSD: number;
    weight: number;
    brokers: BrokerCode[];
    brokersLabel: string;
  }[],
  summary: {
    consolidationDate: string;
    totalBrokers: number;
    totalTitulars: number;
    totalARS: number;
    totalUSD: number;
    exchangeRate: number | null;
  },
  _totalBookUsd: number,
  tc: number | null
) {
  const ws = workbook.addWorksheet('Portfolio_Consolidado', { properties: { tabColor: tabArgb(COLORS.violet) } });

  ws.mergeCells('A1:K1');
  const titleCell = ws.getCell('A1');
  titleCell.value = 'PORTFOLIO CONSOLIDADO POR ACTIVO';
  Object.assign(titleCell, TITLE_STYLE);

  ws.mergeCells('A2:G2');
  ws.getCell('A2').value = `Fecha: ${summary.consolidationDate}  |  ${summary.totalBrokers} Brokers  |  ${summary.totalTitulars} Titulares`;
  Object.assign(ws.getCell('A2'), SUBTITLE_STYLE);

  ws.getCell('H2').value = 'Tipo de Cambio USD/ARS:';
  const tcCell = ws.getCell('I2');
  if (summary.exchangeRate != null && summary.exchangeRate > 0) {
    tcCell.value = summary.exchangeRate;
    tcCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.yellowInput } };
    tcCell.font = { bold: true, size: 12 };
  } else {
    tcCell.value = '— (pasar TC en la export o usar IEB/GMA con FX)';
  }
  ws.getCell('H3').value = '(Modificar TC en upload / opciones de export para columnas en ARS)';
  ws.getCell('H3').font = { italic: true, size: 9, color: { argb: 'FF888888' } };

  const headers = [
    'Ticker',
    'Instrumento',
    'Tipo',
    'País emisor',
    'Cantidad',
    'Precio (ARS)',
    'Precio (USD)',
    'Valuación (ARS)',
    'Valuación (USD)',
    '% Tenencia',
    'Brokers',
  ];
  ws.addRow([]);
  ws.addRow(headers);
  const hRow = ws.getRow(5);
  hRow.eachCell((cell) => {
    Object.assign(cell, HEADER_STYLE);
  });

  consolidated.forEach((c, idx) => {
    const row = ws.addRow([
      c.ticker,
      c.instrumentName,
      c.assetType,
      c.sector,
      c.totalQuantity,
      tc != null ? c.priceARS : '—',
      c.priceUSD,
      tc != null ? c.totalARS : '—',
      c.totalUSD,
      c.weight,
      c.brokersLabel,
    ]);

    if (idx % 2 === 1) {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.altRow } };
      });
    }
    if (c.brokers.length > 1) {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.cyanDuplicate } };
      });
    }
  });

  const totalRow = ws.addRow([
    'TOTAL PORTFOLIO',
    '',
    '',
    '',
    '',
    '',
    '',
    tc != null ? summary.totalARS : '—',
    summary.totalUSD,
    1,
    '',
  ]);
  totalRow.eachCell((cell) => {
    cell.font = { bold: true, size: 12, color: { argb: COLORS.violetDark } };
  });

  ws.columns = [
    { width: 14 },
    { width: 40 },
    { width: 16 },
    { width: 12 },
    { width: 14 },
    { width: 16 },
    { width: 16 },
    { width: 20 },
    { width: 18 },
    { width: 12 },
    { width: 35 },
  ];

  for (let i = 6; i <= ws.rowCount; i++) {
    const pr = (v: string) => {
      if (i === ws.rowCount) {
        if (v === 'F' && tc == null) return;
        if (v === 'H' && tc == null) return;
      }
      const c = ws.getCell(`${v}${i}`);
      if (c.value === '—') return;
      if (v === 'F' || v === 'H' || v === 'I' || v === 'G') c.numFmt = '#,##0.00';
      if (v === 'G') c.numFmt = '#,##0.000000';
      if (v === 'J') c.numFmt = '0.0000%';
    };
    pr('F');
    pr('G');
    pr('H');
    pr('I');
    pr('J');
  }
}

function buildBaseConsolidada(workbook: ExcelJS.Workbook, positions: Position[], tc: number | null) {
  const ws = workbook.addWorksheet('Base_Consolidada', { properties: { tabColor: tabArgb(COLORS.violet) } });

  const headers = [
    'N°',
    'Broker',
    'Titular',
    'Cuenta',
    'Fecha Reporte',
    'Ticker',
    'ISIN',
    'CUSIP',
    'Nombre / Descripción',
    'Clase',
    'Forma Legal',
    'País Emisor',
    'Moneda',
    'Subtipo',
    'Cantidad',
    'Precio Unitario',
    'ARS aprox. (USD×TC) o valor local',
    'Valor USD',
    'Accrued USD',
    'Peso % (broker)',
    'FX Source',
    'Warnings',
    'Archivo / fila',
  ];

  const hRow = ws.addRow(headers);
  hRow.eachCell((cell) => {
    Object.assign(cell, HEADER_STYLE);
  });

  let n = 0;
  for (const p of positions) {
    n += 1;
    const arsAprox = tc != null && p.valor_mercado_usd != null ? p.valor_mercado_usd * tc : p.valor_mercado_local;
    ws.addRow([
      n,
      p.broker,
      p.titular,
      p.cuenta,
      p.fecha_reporte,
      p.ticker ?? '',
      p.isin ?? '',
      p.cusip ?? '',
      p.descripcion,
      p.clase_activo,
      p.forma_legal ?? '',
      p.pais_emisor ?? '',
      p.moneda,
      p.moneda_subtipo ?? '',
      p.cantidad,
      p.precio_mercado ?? '',
      arsAprox,
      p.valor_mercado_usd ?? '',
      p.accrued_interest_usd ?? '',
      p.pct_portfolio != null ? p.pct_portfolio : '',
      p.fx_source,
      p.warnings.join('; '),
      `${p.source_file} #${p.source_row}`,
    ]);
  }

  ws.columns.forEach((col, idx) => {
    col.width = Math.min(Math.max(headers[idx]?.length ?? 10, 12), 45);
  });
  ws.views = [{ state: 'frozen', xSplit: 4, ySplit: 1 }];
}

function buildResumenEjecutivo(
  workbook: ExcelJS.Workbook,
  summary: {
    consolidationDate: string;
    totalARS: number;
    totalUSD: number;
    exchangeRate: number | null;
    totalPositions: number;
    totalBrokers: number;
    totalAccounts: number;
    totalTitulars: number;
    positionsARS: number;
    positionsUSD: number;
    positionsEquity: number;
    positionsFixedIncome: number;
    positionsMoneyMarket: number;
    positionsCash: number;
    unclassifiedPositions: number;
    pendingReviewCount: number;
    alertCount: number;
    top10Concentration: number;
  },
  tc: number | null
) {
  const ws = workbook.addWorksheet('Resumen_Ejecutivo', { properties: { tabColor: tabArgb(COLORS.gold) } });

  ws.mergeCells('A1:B1');
  ws.getCell('A1').value = 'RESUMEN EJECUTIVO - PORTFOLIO CONSOLIDADO';
  Object.assign(ws.getCell('A1'), TITLE_STYLE);

  const rateTxt =
    tc != null
      ? tc.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
      : '— (sin TC)';
  ws.getCell('A2').value = `Fecha de consolidación: ${summary.consolidationDate} | TC USD/ARS: ${rateTxt}`;
  Object.assign(ws.getCell('A2'), SUBTITLE_STYLE);

  const kpis: [string, string | number][] = [
    ['Total Portfolio (ARS)', summary.totalARS],
    ['Total Portfolio (USD)', summary.totalUSD],
    ['Tipo de Cambio USD/ARS', tc ?? '—'],
    ['Cantidad de Posiciones', summary.totalPositions],
    ['Cantidad de Brokers', summary.totalBrokers],
    ['Cantidad de Cuentas', summary.totalAccounts],
    ['Cantidad de Titulares', summary.totalTitulars],
    ['Posiciones c/moneda ARS o subtipo (aprox.)', summary.positionsARS],
    ['Posiciones en moneda USD', summary.positionsUSD],
    ['Posiciones equity / etf (aprox.)', summary.positionsEquity],
    ['Posiciones renta fija (aprox.)', summary.positionsFixedIncome],
    ['Posiciones fondos (aprox.)', summary.positionsMoneyMarket],
    ['Posiciones Cash', summary.positionsCash],
    ['Clase «other» (aprox.)', summary.unclassifiedPositions],
    ['Con warnings (revisar)', summary.pendingReviewCount],
    ['Alertas concentración (reglas 5% / 20%)', summary.alertCount],
    ['Concentración Top 10 (instrumento)', summary.top10Concentration],
  ];

  ws.addRow([]);
  const hdr = ws.addRow(['KPI', 'Valor']);
  hdr.eachCell((cell) => {
    Object.assign(cell, HEADER_STYLE);
  });

  kpis.forEach(([label, value]) => {
    ws.addRow([label, value]);
  });

  ws.getColumn(1).width = 40;
  ws.getColumn(2).width = 28;

  const lastKpiRow = ws.lastRow?.number ?? hdr.number;
  for (let r = hdr.number + 1; r <= lastKpiRow; r++) {
    const label = ws.getCell(r, 1).value;
    if (label == null) continue;
    const s = String(label);
    if (s.startsWith('Total Portfolio (ARS)') || s.startsWith('Total Portfolio (USD)')) {
      const c = ws.getCell(r, 2);
      if (typeof c.value === 'number') c.numFmt = '#,##0.00';
    }
    if (s === 'Tipo de Cambio USD/ARS') {
      const c = ws.getCell(r, 2);
      if (typeof c.value === 'number') c.numFmt = '#,##0.00';
    }
    if (s === 'Concentración Top 10 (instrumento)') {
      const c = ws.getCell(r, 2);
      if (typeof c.value === 'number') c.numFmt = '0.00%';
    }
  }
}

function buildSummarySheet(
  workbook: ExcelJS.Workbook,
  name: string,
  title: string,
  data: SummaryLine[],
  tc: number | null
) {
  const ws = workbook.addWorksheet(name, { properties: { tabColor: tabArgb(COLORS.lavender) } });

  ws.mergeCells('A1:D1');
  ws.getCell('A1').value = title;
  Object.assign(ws.getCell('A1'), TITLE_STYLE);

  ws.addRow([]);
  const hRow = ws.addRow(['Categoría', 'Market Value (ARS)', 'Market Value (USD)', '% Portfolio']);
  hRow.eachCell((cell) => {
    Object.assign(cell, HEADER_STYLE);
  });

  const totalARS = data.reduce((s, d) => s + d.totalARS, 0);
  const totalUSD = data.reduce((s, d) => s + d.totalUSD, 0);
  for (const d of data) {
    ws.addRow([d.category, tc != null ? d.totalARS : '—', d.totalUSD, d.weight]);
  }
  const totalRow = ws.addRow(['TOTAL', totalARS, totalUSD, 1]);
  totalRow.eachCell((cell) => {
    cell.font = { bold: true, name: 'Calibri' };
  });

  ws.getColumn(1).width = 32;
  ws.getColumn(2).width = 22;
  ws.getColumn(3).width = 22;
  ws.getColumn(4).width = 14;

  for (let i = 4; i <= ws.rowCount; i++) {
    const a = ws.getCell(`A${i}`).value;
    if (a === 'TOTAL') {
      if (tc == null) ws.getCell(`B${i}`).value = '—';
    } else {
      if (ws.getCell(`B${i}`).value === '—') continue;
    }
    ws.getCell(`B${i}`).numFmt = '#,##0.00';
    ws.getCell(`C${i}`).numFmt = '#,##0.00';
    ws.getCell(`D${i}`).numFmt = '0.0000%';
  }
}

function buildControlCalidad(
  workbook: ExcelJS.Workbook,
  qualityControl: QcRow[],
  alerts: AlertRow[],
  duplicates: DupRow[]
) {
  const ws = workbook.addWorksheet('Control_Calidad', { properties: { tabColor: tabArgb(COLORS.terracotta) } });

  ws.mergeCells('A1:F1');
  ws.getCell('A1').value = 'CONTROL DE CALIDAD Y ALERTAS';
  Object.assign(ws.getCell('A1'), TITLE_STYLE);

  ws.addRow([]);
  const duHeader = ws.addRow(['DUPLICADOS CROSS-BROKER DETECTADOS']);
  duHeader.getCell(1).font = { bold: true, size: 12, color: { argb: COLORS.violet } };

  if (duplicates.length > 0) {
    const hRow = ws.addRow(['Clave (ticker/ISIN/desc)', 'Descripción', 'Acción sugerida']);
    hRow.eachCell((c) => {
      c.font = HEADER_STYLE.font!;
      c.fill = HEADER_STYLE.fill!;
    });
    duplicates.forEach((d) => {
      ws.addRow([d.key, d.description, 'Consolidar o validar múltiples custodios']);
    });
  } else {
    ws.addRow(['No se detectaron instrumentos en más de un broker.']);
  }

  ws.addRow([]);
  const alH = ws.addRow(['ALERTAS DE CONCENTRACIÓN']);
  alH.getCell(1).font = { bold: true, size: 12, color: { argb: COLORS.terracotta } };

  if (alerts.length > 0) {
    const hRow = ws.addRow(['Tipo', 'Detalle', 'Monto (USD) approx', '% Portfolio', 'Nivel', 'Recomendación']);
    hRow.eachCell((c) => {
      c.font = HEADER_STYLE.font!;
      c.fill = HEADER_STYLE.fill!;
    });
    alerts.forEach((a) => {
      const row = ws.addRow([a.type, a.detail, a.value, a.weight, a.level, a.recommendation]);
      if (a.level === 'ALTA') {
        row.getCell(5).font = { bold: true, color: { argb: COLORS.alertHigh } };
      } else {
        row.getCell(5).font = { bold: true, color: { argb: COLORS.alertMed } };
      }
    });
  } else {
    ws.addRow(['Ninguna alerta bajo reglas 5% posición / 20% cliente.']);
  }

  ws.addRow([]);
  const qcH = ws.addRow(['ISSUES DE CALIDAD DE DATOS (inconsistencias)']);
  qcH.getCell(1).font = { bold: true, size: 12, color: { argb: COLORS.violet } };

  if (qualityControl.length > 0) {
    const hRow = ws.addRow(['Categoría', 'Detalle', 'Acción', 'Severidad']);
    hRow.eachCell((c) => {
      c.font = HEADER_STYLE.font!;
      c.fill = HEADER_STYLE.fill!;
    });
    qualityControl.forEach((q) => {
      ws.addRow([q.category, q.detail, q.action, q.severity]);
    });
  } else {
    ws.addRow(['No se registraron issues en el verificador de consistencia.']);
  }

  ws.getColumn(1).width = 26;
  ws.getColumn(2).width = 55;
  ws.getColumn(3).width = 20;
  ws.getColumn(4).width = 12;
  ws.getColumn(5).width = 10;
  ws.getColumn(6).width = 50;
}

function buildDiccionario(workbook: ExcelJS.Workbook, tc: number | null) {
  const ws = workbook.addWorksheet('Diccionario', { properties: { tabColor: tabArgb(COLORS.gold) } });

  ws.mergeCells('A1:C1');
  ws.getCell('A1').value = 'DICCIONARIO DE DATOS (consolidador-tenencias)';
  Object.assign(ws.getCell('A1'), TITLE_STYLE);

  ws.addRow([]);
  const hRow = ws.addRow(['Columna / concepto', 'Descripción', 'Regla / criterio']);
  hRow.eachCell((cell) => {
    Object.assign(cell, HEADER_STYLE);
  });

  const tcLine =
    tc != null
      ? `Columnas en ARS usan: valor USD global × ${tc} (ingresá TC en la export o flujo IEB/GMA).`
      : 'Sin TC: las columnas en ARS del informe se omiten.';

  const entries: [string, string, string][] = [
    [
      'Hoja Flujo_Bonos',
      'Proyección de intereses y amortizaciones a partir de calendario de pagos (API bonos) × nominal de cartera',
      'Misma fuente: si hay ley general y AFIP, la export toma un solo brazo (selector en Carga / opción al exportar). Requiere BOND_PAYMENTS_URL en server',
    ],
    [
      'Broker',
      'Custodio / dealer',
      ALL_BROKER_CODES.map(
        (b) => `${b} = ${BROKERS[b].nombre} (${BROKERS[b].tipo === 'offshore' ? 'offshore' : 'local'})`
      ).join(' · '),
    ],
    ['Cliente / titular', 'Persona o entidad; `cliente_id` interno y titular leído del reporte', 'Agrupado vía mapeo de cuentas y alias'],
    [
      'Clase de activo',
      'Categoría operativa: equity (incluye CEDEAR), bond, fund, on, letra, cash, etc.',
      'Infiere el parser; «other» va al flujo de glosario',
    ],
    ['Forma legal', 'directa, cedear, ADR, ON local, bono local', 'Determina subtipo fisco / reporting'],
    [
      'Valor mercado USD',
      'AUM de la línea en dólares',
      'IEB/GMA: con FX manual. Offshore: ya en USD',
    ],
    [
      'Columnas ARS en el informe',
      'Aprox. USD × TC cuando informás un tipo de cambio',
      tcLine,
    ],
    [
      'Duplicado cross-broker',
      'Mismo instrumento (ticker/ISIN/descripción) en 2+ brokers',
      'Resaltado en cian en la hoja consolidada',
    ],
  ];

  entries.forEach((e) => ws.addRow(e));

  ws.getColumn(1).width = 30;
  ws.getColumn(2).width = 45;
  ws.getColumn(3).width = 70;
}

function buildFlujoBonosSheet(
  workbook: ExcelJS.Workbook,
  positions: Position[],
  data: {
    flowRows: { ev: BondPaymentEvent; intereses: number; amortizacion: number }[];
    missingTickers: string[];
    bondTickersInBook: string[];
  },
  meta: { configured: boolean; warning: string | null },
  flowMode: BondFlowViewMode
) {
  const ws = workbook.addWorksheet('Flujo_Bonos', { properties: { tabColor: tabArgb(COLORS.cream) } });
  const span = 'A1:L1';
  ws.mergeCells(span);
  ws.getCell('A1').value = 'PROYECCIÓN DE FLUJO DE BONOS / ON / LETRAS (nominal de cartera × calendario)';
  Object.assign(ws.getCell('A1'), TITLE_STYLE);
  ws.mergeCells('A2:L2');
  ws.getCell('A2').value =
    flowMode === 'afip'
      ? 'Vista de flujos: Régimen AFIP (bonos con doble ley: no se mezclan con ley general).'
      : 'Vista de flujos: Ley general (bonos con doble ley: no se mezclan con AFIP).';
  Object.assign(ws.getCell('A2'), SUBTITLE_STYLE);

  const bondPosCount = positions.filter(
    (p) => p.clase_activo === 'bond' || p.clase_activo === 'on' || p.clase_activo === 'letra'
  ).length;

  const lines: string[] = [];
  if (meta.warning) {
    lines.push(meta.warning);
  } else if (!meta.configured) {
    lines.push('Calendario no disponible: definí BOND_PAYMENTS_URL con el export CSV del calendario de pagos.');
  }
  if (bondPosCount === 0) {
    lines.push('No hay posiciones de renta fija (bono, ON, letra) en el consolidado.');
  }
  if (data.bondTickersInBook.length > 0 && data.missingTickers.length > 0) {
    lines.push(
      `Tickers con nominal en cartera sin eventos en calendario (ticker no coincide o falta en fuente): ${data.missingTickers.join(', ')}`
    );
  }

  for (const line of lines) {
    const row = ws.addRow([line]);
    const n = row.number ?? ws.rowCount;
    ws.mergeCells(`A${n}:L${n}`);
    const cell = ws.getCell(n, 1);
    cell.font = { italic: true, size: 10, color: { argb: COLORS.violet } };
  }

  const nominalByTicker = new Map<string, number>();
  for (const p of positions.filter(
    (p) => p.clase_activo === 'bond' || p.clase_activo === 'on' || p.clase_activo === 'letra'
  )) {
    const t = normalizeBondTicker(p.ticker);
    if (!t) continue;
    const n = Number.isFinite(p.cantidad) ? p.cantidad : 0;
    nominalByTicker.set(t, (nominalByTicker.get(t) ?? 0) + n);
  }

  let headerRowNumber = 2 + lines.length;

  if (data.flowRows.length > 0) {
    const hRow = ws.addRow([
      'Activo',
      'Emisor',
      'Fecha',
      'Moneda',
      'VN agregada cartera',
      'Cupón /100',
      'Amort /100',
      'Flujo /100',
      'Residual VN %',
      'Intereses (mon.)',
      'Amortización (mon.)',
      'Total flujo fila',
    ]);
    hRow.eachCell((c) => {
      Object.assign(c, HEADER_STYLE);
    });
    headerRowNumber = hRow.number ?? 2;

    for (const { ev, intereses, amortizacion } of data.flowRows) {
      const tNorm = normalizeBondTicker(ev.asset);
      const nominal = nominalByTicker.get(tNorm) ?? 0;
      const tot = intereses + amortizacion;
      const row = ws.addRow([
        ev.asset,
        ev.issuer ?? '—',
        ev.date,
        ev.currency,
        nominal,
        ev.couponPer100 ?? 0,
        ev.amortizationPer100 ?? 0,
        ev.flowPer100,
        ev.residualPctOfPar != null ? ev.residualPctOfPar : '—',
        intereses,
        amortizacion,
        tot,
      ]);
      row.getCell(3).numFmt = 'yyyy-mm-dd';
      const residualVal = ev.residualPctOfPar;
      for (const col of [5, 6, 7, 8, 10, 11, 12] as const) {
        row.getCell(col).numFmt = '#,##0.00';
      }
      if (residualVal != null && Number.isFinite(residualVal)) {
        row.getCell(9).numFmt = '0.00';
      }
    }

    const totals = new Map<string, number>();
    for (const { ev, intereses, amortizacion } of data.flowRows) {
      const cur = ev.currency || 'USD';
      totals.set(cur, (totals.get(cur) ?? 0) + intereses + amortizacion);
    }
    ws.addRow([]);
    const th = ws.addRow(['Totales por moneda (sólo intereses + amort.):']);
    th.getCell(1).font = { bold: true, size: 11 };
    for (const [cur, v] of [...totals.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const tr = ws.addRow([cur, v]);
      tr.getCell(2).numFmt = '#,##0.00';
    }
  } else if (bondPosCount > 0) {
    const msg =
      data.bondTickersInBook.length > 0
        ? 'Ninguna fila del calendario coincide con los tickers de renta fija de la cartera o el calendario está vacío.'
        : 'Sin nominal deducible (revisar tickers de bono/ON/letra).';
    const out = ws.addRow([msg]);
    const n = out.number ?? ws.rowCount;
    ws.mergeCells(`A${n}:L${n}`);
    out.getCell(1).font = { italic: true, size: 10, color: { argb: COLORS.violet } };
  }

  ws.getColumn(1).width = 16;
  ws.getColumn(2).width = 24;
  ws.getColumn(3).width = 12;
  for (const c of [4, 5, 6, 7, 8, 9, 10, 11, 12]) ws.getColumn(c).width = c === 4 ? 8 : 14;
  const freezeY =
    data.flowRows.length > 0
      ? headerRowNumber
      : 2 + lines.length + (bondPosCount > 0 ? 1 : 0);
  ws.views = [{ state: 'frozen', ySplit: Math.max(3, freezeY) }];
}

function buildPorClienteSheet(workbook: ExcelJS.Workbook, positions: Position[], total: number) {
  const ws = workbook.addWorksheet('Por_Cliente', { properties: { tabColor: tabArgb(COLORS.cream) } });
  const sums = buildClienteSummaries(positions);
  ws.mergeCells('A1:K1');
  ws.getCell('A1').value = 'AUM POR TITULAR / CLIENTE';
  Object.assign(ws.getCell('A1'), TITLE_STYLE);
  const hRow = ws.addRow([
    'Titular',
    'Tipo',
    'AUM USD',
    'MS',
    'NETX360',
    'IEB',
    'GMA',
    '% book',
    'N posiciones',
    'N brokers',
    'Brokers',
  ]);
  hRow.eachCell((c) => {
    Object.assign(c, HEADER_STYLE);
  });
  for (const c of sums.sort((a, b) => b.aum_usd - a.aum_usd)) {
    const pct = total > 0 ? c.aum_usd / total : 0;
    const row = ws.addRow([
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
    row.getCell(8).numFmt = '0.00%';
    for (const col of [3, 4, 5, 6, 7]) {
      row.getCell(col).numFmt = '#,##0.00';
    }
  }
  ws.getColumn(1).width = 32;
  ws.getColumn(2).width = 10;
  for (let c = 3; c <= 8; c++) ws.getColumn(c).width = 16;
  ws.getColumn(11).width = 32;
  ws.views = [{ state: 'frozen', ySplit: 2 }];
}
