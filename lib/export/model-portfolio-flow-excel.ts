import * as XLSX from 'xlsx';
import type { CellObject } from 'xlsx';
import type { BondFlowViewMode } from '@/lib/bonds/flow-regime';

export type ModelPortfolioFlowExcelRow = {
  ticker: string;
  issuer?: string;
  date: string;
  currency: string;
  nominal: number;
  couponPer100: number;
  amortizationPer100: number;
  flowPer100: number;
  residualPctOfPar?: number | null;
  intereses: number;
  amortizacion: number;
};

export type ModelPortfolioFlowExcelLine = {
  ticker: string;
  weightPct: number;
  dirtyPricePer100: number;
  allocUsd: number | null;
  allocArs: number | null;
  impliedNominal: number | null;
  ytm: number | null;
  modifiedDuration: number | null;
};

export type ModelPortfolioFlowExcelMeta = {
  valuationDate: string;
  /** Si es null, no se incluye TC en el archivo (precios/monto en USD). */
  fxUsdArs: number | null;
  flowMode: BondFlowViewMode;
  absoluteNominals: boolean;
  totalCarteraUsd: number | null;
  portfolioYtm: number | null;
  portfolioDuration: number | null;
};

/** Formato Excel con separador de miles (el locale de Excel define `.` vs `,`). */
const FMT_MILES = '#,##0.00';
const FMT_PESO = '0.00';
const FMT_PCT = '0.00%';

type AoACell = string | number | null | CellObject;

function localDateYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function num(v: number | null | undefined, z: string = FMT_MILES): CellObject | null {
  if (v == null || !Number.isFinite(v)) return null;
  return { v, t: 'n', z };
}

/**
 * Excel del flujo de «Cartera modelo» (Bonos): composición + proyección de cupones/amort.
 */
export function exportModelPortfolioFlowExcel(args: {
  rows: ModelPortfolioFlowExcelRow[];
  lines: ModelPortfolioFlowExcelLine[];
  meta: ModelPortfolioFlowExcelMeta;
  filename?: string;
}): void {
  const { rows, lines, meta } = args;
  const filename =
    args.filename ?? `flujo_cartera_modelo_${localDateYmd()}.xlsx`;

  const wb = XLSX.utils.book_new();

  const includeFx = meta.fxUsdArs != null && Number.isFinite(meta.fxUsdArs) && meta.fxUsdArs > 0;

  const resumenAoA: AoACell[][] = [
    ['FLUJO CARTERA MODELO — RESUMEN'],
    [`Fecha valuación: ${meta.valuationDate}`],
    [
      `Régimen flujos: ${
        meta.flowMode === 'afip' ? 'AFIP' : 'Ley general'
      }`,
    ],
  ];
  if (includeFx) {
    resumenAoA.push(['TC USD/ARS', num(meta.fxUsdArs, FMT_MILES)]);
  }
  resumenAoA.push(
    ['Monto total cartera (USD)', num(meta.totalCarteraUsd, FMT_MILES)],
    [
      meta.absoluteNominals
        ? 'VN: implícito (monto × peso / precio)'
        : 'VN: relativo (1 punto de peso ≈ 1 VN). Ingresá monto total para montos absolutos.',
    ],
    ['TIR cartera (aprox.)', num(meta.portfolioYtm, FMT_PCT)],
    ['Duration mod. cartera', num(meta.portfolioDuration, FMT_MILES)],
    [],
    includeFx
      ? [
          'Ticker',
          'Peso %',
          'Px /100 USD',
          'Asignación USD',
          'Asignación ARS',
          'VN implícito',
          'TIR',
          'Dur. mod.',
        ]
      : [
          'Ticker',
          'Peso %',
          'Px /100 USD',
          'Asignación USD',
          'VN implícito',
          'TIR',
          'Dur. mod.',
        ]
  );

  for (const line of lines) {
    if (includeFx) {
      resumenAoA.push([
        line.ticker,
        num(line.weightPct, FMT_PESO),
        num(line.dirtyPricePer100, FMT_MILES),
        num(line.allocUsd, FMT_MILES),
        num(line.allocArs, FMT_MILES),
        num(line.impliedNominal, FMT_MILES),
        num(line.ytm, FMT_PCT),
        num(line.modifiedDuration, FMT_MILES),
      ]);
    } else {
      resumenAoA.push([
        line.ticker,
        num(line.weightPct, FMT_PESO),
        num(line.dirtyPricePer100, FMT_MILES),
        num(line.allocUsd, FMT_MILES),
        num(line.impliedNominal, FMT_MILES),
        num(line.ytm, FMT_PCT),
        num(line.modifiedDuration, FMT_MILES),
      ]);
    }
  }

  const totalsByCurrency = new Map<string, { int: number; amort: number }>();
  for (const r of rows) {
    const c = r.currency.toUpperCase();
    const prev = totalsByCurrency.get(c) ?? { int: 0, amort: 0 };
    prev.int += r.intereses;
    prev.amort += r.amortizacion;
    totalsByCurrency.set(c, prev);
  }
  resumenAoA.push([]);
  resumenAoA.push(['Totales de flujo por moneda']);
  resumenAoA.push(['Moneda', 'Intereses', 'Amortización', 'Total']);
  for (const [cur, t] of [...totalsByCurrency.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    resumenAoA.push([
      cur,
      num(t.int, FMT_MILES),
      num(t.amort, FMT_MILES),
      num(t.int + t.amort, FMT_MILES),
    ]);
  }

  const wsResumen = XLSX.utils.aoa_to_sheet(resumenAoA);
  wsResumen['!cols'] = includeFx
    ? [
        { wch: 14 },
        { wch: 10 },
        { wch: 14 },
        { wch: 16 },
        { wch: 16 },
        { wch: 14 },
        { wch: 10 },
        { wch: 10 },
      ]
    : [
        { wch: 14 },
        { wch: 10 },
        { wch: 14 },
        { wch: 16 },
        { wch: 14 },
        { wch: 10 },
        { wch: 10 },
      ];
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

  const flujoAoA: AoACell[][] = [
    ['PROYECCIÓN DE FLUJO — CARTERA MODELO'],
    [
      `Fecha valuación: ${meta.valuationDate} · Régimen: ${
        meta.flowMode === 'afip' ? 'AFIP' : 'Ley general'
      }`,
    ],
    [],
    ['Posiciones (precio × cantidad → monto)'],
    ['Ticker', 'Precio (Px/100 USD)', 'Cantidad (VN)', 'Monto calculado (USD)'],
  ];

  let montoTotalCalc = 0;
  for (const line of lines) {
    const precio = line.dirtyPricePer100;
    const cantidad =
      line.impliedNominal != null && Number.isFinite(line.impliedNominal) && line.impliedNominal > 0
        ? line.impliedNominal
        : line.weightPct > 0
          ? line.weightPct
          : null;
    const monto =
      line.allocUsd != null && Number.isFinite(line.allocUsd)
        ? line.allocUsd
        : precio > 0 && cantidad != null
          ? (precio / 100) * cantidad
          : null;
    if (monto != null) montoTotalCalc += monto;
    flujoAoA.push([
      line.ticker,
      num(precio, FMT_MILES),
      num(cantidad, FMT_MILES),
      num(monto, FMT_MILES),
    ]);
  }
  flujoAoA.push(['TOTAL', null, null, num(lines.length > 0 ? montoTotalCalc : null, FMT_MILES)]);
  if (!meta.absoluteNominals) {
    flujoAoA.push([
      'Nota: sin monto total de cartera, Cantidad ≈ peso % (VN relativo) y Monto = Precio×Cantidad/100.',
    ]);
  }
  flujoAoA.push([]);
  flujoAoA.push(['Detalle de flujos futuros']);
  flujoAoA.push([
    'Activo',
    'Emisor',
    'Fecha',
    'Moneda',
    'VN',
    'Cupón /100',
    'Amort /100',
    'Flujo /100',
    'Residual VN %',
    'Intereses',
    'Amortización',
    'Total',
  ]);

  for (const r of rows) {
    flujoAoA.push([
      r.ticker,
      r.issuer ?? '—',
      r.date,
      r.currency,
      num(r.nominal, FMT_MILES),
      num(r.couponPer100, FMT_MILES),
      num(r.amortizationPer100, FMT_MILES),
      num(r.flowPer100, FMT_MILES),
      num(r.residualPctOfPar, FMT_MILES),
      num(r.intereses, FMT_MILES),
      num(r.amortizacion, FMT_MILES),
      num(r.intereses + r.amortizacion, FMT_MILES),
    ]);
  }

  if (rows.length === 0) {
    flujoAoA.push([
      'Sin filas de flujo (revisá pesos, calendario y fecha de valuación).',
    ]);
  }

  const wsFlujo = XLSX.utils.aoa_to_sheet(flujoAoA);
  wsFlujo['!cols'] = [
    { wch: 14 },
    { wch: 22 },
    { wch: 14 },
    { wch: 18 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(wb, wsFlujo, 'Flujo');

  const monthMap = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const month = r.date.slice(0, 7);
    const cur = r.currency.toUpperCase();
    if (!monthMap.has(month)) monthMap.set(month, new Map());
    const byCur = monthMap.get(month)!;
    byCur.set(cur, (byCur.get(cur) ?? 0) + r.intereses + r.amortizacion);
  }
  const currencies = [
    ...new Set(rows.map((r) => r.currency.toUpperCase())),
  ].sort();
  const mensualAoA: AoACell[][] = [
    ['FLUJO MENSUAL AGREGADO'],
    ['Mes', ...currencies, 'Total'],
  ];
  for (const month of [...monthMap.keys()].sort()) {
    const byCur = monthMap.get(month)!;
    const vals = currencies.map((c) => byCur.get(c) ?? 0);
    const total = vals.reduce((s, v) => s + v, 0);
    mensualAoA.push([month, ...vals.map((v) => num(v, FMT_MILES)), num(total, FMT_MILES)]);
  }
  const wsMensual = XLSX.utils.aoa_to_sheet(mensualAoA);
  wsMensual['!cols'] = [
    { wch: 10 },
    ...currencies.map(() => ({ wch: 16 })),
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(wb, wsMensual, 'Mensual');

  XLSX.writeFile(wb, filename);
}
