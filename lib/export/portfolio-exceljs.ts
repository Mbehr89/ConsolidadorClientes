/**
 * Generador de Excel tipo “master” (ExcelJS) — hojas formateadas, colores, validaciones ligeras.
 * Los datos se derivan de `Position[]` del consolidador.
 */
import ExcelJS from 'exceljs';
import { BROKERS } from '@/lib/brokers';
import {
  buildPortfolioExportPayload,
  type ExportPortfolioOptions,
  type SummaryLine,
  type DupRow,
  type AlertRow,
  type QcRow,
} from './portfolio-export-payload';
import type { BondFlowViewMode } from '@/lib/bonds/flow-regime';
import type { BondPaymentEvent } from '@/lib/bonds/types';
import { normalizeBondTicker } from '@/lib/bonds/ticker-normalize';
import type { BrokerCode, Position } from '@/lib/schema';
import type { ClienteSummary } from '@/lib/views/cliente-summary';

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

  const payload = await buildPortfolioExportPayload(positions, fxUsdArs, bondFlowViewMode);
  const tc = payload.exchangeRateUsed;
  const totalUSD = payload.totals.totalUSD;
  const consolidated = payload.consolidatedInstruments;
  const executiveSummary = payload.executiveSummary;

  buildPortfolioConsolidado(workbook, consolidated, executiveSummary, totalUSD, tc);
  buildBaseConsolidada(workbook, positions, tc);
  buildResumenEjecutivo(workbook, executiveSummary, tc);

  const dist = payload.distribution;
  buildSummarySheet(workbook, 'Por_Asset_Class', 'Distribución por Clase de Activo (schema)', dist.byAssetClass, tc);
  buildSummarySheet(workbook, 'Por_Asset_Type', 'Distribución por Forma Legal / tipo', dist.byFormaLegal, tc);
  buildSummarySheet(workbook, 'Por_Sector', 'Exposición local vs offshore (custodio)', dist.byLocalVsOffshore, tc);
  buildSummarySheet(workbook, 'Por_Pais', 'Distribución por País de Emisor', dist.byPaisEmisor, tc);
  buildSummarySheet(workbook, 'Por_Moneda', 'Distribución por Moneda / subtipo', dist.byMoneda, tc);
  buildSummarySheet(workbook, 'Por_Broker', 'Distribución por Broker / Custodio', dist.byBroker, tc);

  const qc = payload.qualityControl.inconsistencies;
  const alerts = payload.qualityControl.alerts;
  const duplicates = payload.qualityControl.crossBrokerDuplicates;

  buildControlCalidad(workbook, qc, alerts, duplicates);
  buildDiccionario(workbook, tc);
  buildPorClienteSheet(workbook, payload.porCliente, totalUSD);

  buildFlujoBonosSheet(workbook, positions, payload.bondFlow, payload.bondCalendar, bondFlowViewMode);

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

function buildPorClienteSheet(workbook: ExcelJS.Workbook, sums: ClienteSummary[], total: number) {
  const ws = workbook.addWorksheet('Por_Cliente', { properties: { tabColor: tabArgb(COLORS.cream) } });
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
