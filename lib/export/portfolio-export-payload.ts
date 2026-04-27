/**
 * Payload único para Excel portfolio y export JSON (misma fuente de datos).
 */
import { BROKERS } from '@/lib/brokers';
import { aggregateByField, aggregateInstrumentGroups, concentrationFlags, instrumentKey, totalAumUsd } from '@/lib/analysis/exposure';
import { detectInconsistencies, type Inconsistency } from '@/lib/analysis/inconsistencies';
import { buildClienteSummaries, type ClienteSummary } from '@/lib/views/cliente-summary';
import { filterBondEventsByViewMode, type BondFlowViewMode } from '@/lib/bonds/flow-regime';
import { reviveBondEventsFromApi } from '@/lib/bonds/revive';
import type { BondPaymentEvent } from '@/lib/bonds/types';
import { normalizeBondTicker } from '@/lib/bonds/ticker-normalize';
import type { BrokerCode, Position } from '@/lib/schema';

/** Mismas opciones que el Excel portfolio master. */
export interface ExportPortfolioOptions {
  filename?: string;
  fxUsdArs?: number | null;
  bondFlowViewMode?: BondFlowViewMode;
}

export interface SummaryLine {
  category: string;
  totalARS: number;
  totalUSD: number;
  weight: number;
}

export type DupRow = { key: string; description: string };

export type AlertRow = {
  type: string;
  detail: string;
  value: number;
  weight: number;
  level: 'ALTA' | 'MEDIA';
  recommendation: string;
};

export type QcRow = { category: string; detail: string; action: string; severity: string };

export interface PortfolioExecutiveSummary {
  consolidationDate: string;
  exchangeRate: number | null;
  totalARS: number;
  totalUSD: number;
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
}

export interface ConsolidatedInstrumentRow {
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
}

/** Igual que las pestañas del Excel portfolio master */
export interface PortfolioExportPayload {
  meta: {
    generatedAt: string;
    schemaVersion: '1';
    source: 'consolidador-tenencias';
    excelSheets: readonly string[];
  };
  exportOptions: {
    fxUsdArs: number | null;
    bondFlowViewMode: BondFlowViewMode;
  };
  exchangeRateUsed: number | null;
  totals: { totalUSD: number; totalARS: number };
  executiveSummary: PortfolioExecutiveSummary;
  consolidatedInstruments: ConsolidatedInstrumentRow[];
  positions: Position[];
  distribution: {
    byAssetClass: SummaryLine[];
    byFormaLegal: SummaryLine[];
    byLocalVsOffshore: SummaryLine[];
    byPaisEmisor: SummaryLine[];
    byMoneda: SummaryLine[];
    byBroker: SummaryLine[];
  };
  top10InstrumentsByUsd: Array<{
    key: string;
    ticker: string | null;
    descripcion: string;
    clase_activo: string;
    valor_usd: number;
    weightOfPortfolio: number;
  }>;
  qualityControl: {
    inconsistencies: QcRow[];
    alerts: AlertRow[];
    crossBrokerDuplicates: DupRow[];
  };
  porCliente: ClienteSummary[];
  bondCalendar: { configured: boolean; warning: string | null };
  bondFlow: {
    flowRows: { ev: BondPaymentEvent; intereses: number; amortizacion: number }[];
    missingTickers: string[];
    bondTickersInBook: string[];
  };
}

const EXCEL_SHEETS = [
  'Portfolio_Consolidado',
  'Base_Consolidada',
  'Resumen_Ejecutivo',
  'Por_Asset_Class',
  'Por_Asset_Type',
  'Por_Sector',
  'Por_Pais',
  'Por_Moneda',
  'Por_Broker',
  'Control_Calidad',
  'Diccionario',
  'Por_Cliente',
  'Flujo_Bonos',
] as const;

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

function toSummaryFromAggregate(agg: Record<string, number>, totalUsd: number, fx: number | null): SummaryLine[] {
  return Object.entries(agg)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({
      category: k,
      totalARS: fx != null && fx > 0 ? v * fx : 0,
      totalUSD: v,
      weight: totalUsd > 0 ? v / totalUsd : 0,
    }));
}

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

function normalizeAlertsForSheet(alerts: AlertRow[], total: number): AlertRow[] {
  return alerts.map((a) => ({
    ...a,
    value: a.type.startsWith('Concentración') && total > 0 ? a.weight * total : a.value,
  }));
}

function inconsistencyToQc(inc: Inconsistency): QcRow {
  const sev = inc.severity === 'error' ? 'Alta' : inc.severity === 'warning' ? 'Media' : 'Baja';
  return {
    category: inc.tipo.replace(/_/g, ' '),
    detail: inc.descripcion,
    action: 'Revisar posiciones afectadas y fuentes de datos',
    severity: sev,
  };
}

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

export async function buildPortfolioExportPayload(
  positions: Position[],
  fxUsdArs: number | null,
  bondFlowViewMode: BondFlowViewMode = 'normal'
): Promise<PortfolioExportPayload> {
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
  const byMoneda = aggregateByField(positions, (p) =>
    p.moneda_subtipo ? `${p.moneda} (${p.moneda_subtipo})` : p.moneda
  );
  const byBroker = aggregateByField(positions, (p) => p.broker);

  const countClase = (c: (typeof positions)[0]['clase_activo']) => positions.filter((p) => p.clase_activo === c).length;
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

  const top10 = [...groups].sort((a, b) => b.valor_usd - a.valor_usd).slice(0, 10);
  const top10Conc = totalUSD > 0 ? top10.reduce((s, g) => s + g.valor_usd, 0) / totalUSD : 0;

  const inc = detectInconsistencies(positions);
  const rawAlerts = buildAlertsFromConcentration(positions, totalUSD);
  const alerts = normalizeAlertsForSheet(rawAlerts, totalUSD);
  const duplicates = findCrossBrokerDuplicates(positions);
  const qc: QcRow[] = inc.map(inconsistencyToQc);

  const executiveSummary: PortfolioExecutiveSummary = {
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

  const consolidatedInstruments: ConsolidatedInstrumentRow[] = groups.map((g) => {
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

  const top10InstrumentsByUsd = top10.map((g) => ({
    key: g.key,
    ticker: g.ticker,
    descripcion: g.descripcion,
    clase_activo: g.clase_activo,
    valor_usd: g.valor_usd,
    weightOfPortfolio: totalUSD > 0 ? g.valor_usd / totalUSD : 0,
  }));

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

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      schemaVersion: '1',
      source: 'consolidador-tenencias',
      excelSheets: [...EXCEL_SHEETS],
    },
    exportOptions: {
      fxUsdArs,
      bondFlowViewMode,
    },
    exchangeRateUsed: tc,
    totals: { totalUSD, totalARS },
    executiveSummary,
    consolidatedInstruments,
    positions,
    distribution: {
      byAssetClass: instSumm,
      byFormaLegal: typeSumm,
      byLocalVsOffshore: localSumm,
      byPaisEmisor: paisSumm,
      byMoneda: monedaSumm,
      byBroker: brokerSumm,
    },
    top10InstrumentsByUsd,
    qualityControl: {
      inconsistencies: qc,
      alerts,
      crossBrokerDuplicates: duplicates,
    },
    porCliente: buildClienteSummaries(positions),
    bondCalendar: bondCalendarMeta,
    bondFlow,
  };
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** Descarga JSON con el mismo contenido estructural que alimenta el Excel portfolio master. */
export async function exportPortfolioJson(positions: Position[], options?: ExportPortfolioOptions): Promise<void> {
  const payload = await buildPortfolioExportPayload(
    positions,
    options?.fxUsdArs ?? null,
    options?.bondFlowViewMode ?? 'normal'
  );
  const base = (options?.filename?.replace(/\.xlsx$/i, '') ?? `Portfolio_Consolidado_${localDateYmd()}`) + '.json';
  const fname = base.endsWith('.json') ? base : `${base}.json`;
  const blob = new Blob([JSON.stringify(payload, jsonReplacer, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fname;
  a.click();
  URL.revokeObjectURL(url);
}

function localDateYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
