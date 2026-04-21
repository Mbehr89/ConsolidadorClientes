import type { BondPaymentEvent } from './types';

function stripBom(s: string): string {
  return s.replace(/^\uFEFF/, '').trim();
}

function normalizeHeader(s: string): string {
  return stripBom(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && c === sep) {
      out.push(stripBom(cur));
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(stripBom(cur));
  return out;
}

function detectSeparator(firstNonEmptyLine: string): ',' | ';' {
  const semi = (firstNonEmptyLine.match(/;/g) ?? []).length;
  const comma = (firstNonEmptyLine.match(/,/g) ?? []).length;
  return semi > comma ? ';' : ',';
}

function parseDdMmYyyyDate(raw: string): Date | null {
  const s = stripBom(raw);
  if (!s) return null;

  const numTest = /^-?\d+(\.\d+)?$/.test(s.replace(',', '.'));
  if (numTest) {
    const n = Number(s.replace(',', '.'));
    if (Number.isFinite(n) && n > 20000) {
      const epoch = Date.UTC(1899, 11, 30);
      return new Date(epoch + Math.round(n) * 86400000);
    }
  }

  const parts = s.split(/[/\-\s]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const d = parseInt(parts[0]!, 10);
  const m = parseInt(parts[1]!, 10) - 1;
  const y = parseInt(parts[2]!, 10);
  if (!Number.isFinite(d) || !Number.isFinite(m) || !Number.isFinite(y)) return null;
  if (m < 0 || m > 11 || d < 1 || d > 31) return null;
  return new Date(Date.UTC(y, m, d));
}

export function parseNumber(raw: string): number | undefined {
  const s = stripBom(raw);
  if (!s || /^nan$/i.test(s)) return undefined;
  const cleaned = s.replace(/\./g, '').replace(',', '.').replace(/[^\d.\-]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function headerMatchesDate(h: string): boolean {
  return (
    h.includes('fecha') ||
    h.includes('efectiva') ||
    h.includes('payment date') ||
    h === 'date'
  );
}

function headerMatchesTicker(h: string): boolean {
  return h.includes('ticker') || h.includes('bono') || h.includes('asset') || h.includes('especie');
}

/**
 * Columna de **total** del bloque “Flujo de fondos **c/100 vn**” (no el total en moneda de la posición).
 */
function isFlowPer100VnTotalColumn(h: string): boolean {
  if (!h.includes('c/100') || !h.includes('vn') || !h.includes('total')) return false;
  if (h.includes('interes') || h.includes('amort')) return false;
  return h.includes('flujo') || h.includes('fondos');
}

function headerMatchesFlowTotalLoose(h: string): boolean {
  if (isFlowPer100VnTotalColumn(h)) return true;
  const hasC100 = h.includes('c/100') || h.includes('c /100') || h.includes('c/ 100');
  const hasVn = h.includes('vn');
  const hasTotal = h.includes('total');
  if (hasC100 && hasVn && hasTotal && !h.includes('solo')) {
    if (h.includes('flujo de fondos total') && !h.includes('c/100')) return false;
    return true;
  }
  if (
    h.includes('flujo total') ||
    h.includes('total flow') ||
    h.includes('cash flow total') ||
    (h.includes('total') && !h.includes('inter') && hasC100)
  ) {
    return true;
  }
  if (h.includes('flujo de fondos total')) {
    return !h.includes('c/100');
  }
  return false;
}

function pickFlowColumnIndex(norm: string[]): number {
  for (let i = 0; i < norm.length; i++) {
    if (isFlowPer100VnTotalColumn(norm[i]!)) return i;
  }
  for (let i = 0; i < norm.length; i++) {
    const h = norm[i]!;
    if (h.includes('c/100') && h.includes('vn') && h.includes('total')) return i;
  }
  for (let i = 0; i < norm.length; i++) {
    if (headerMatchesFlowTotalLoose(norm[i]!)) return i;
  }
  return -1;
}

function pickIssuerColumnIndex(norm: string[]): number {
  for (let i = 0; i < norm.length; i++) {
    const h = norm[i]!;
    if (h.includes('emisor') && !h.includes('ticker')) return i;
  }
  return -1;
}

function headerMatchesCurrency(h: string): boolean {
  return (
    h.includes('moneda') ||
    h.includes('currency') ||
    h.includes('denominacion') ||
    h.includes('mon. pago')
  );
}

function headerMatchesCoupon(h: string): boolean {
  if (h.includes('total')) return false;
  if (h.includes('tasa de')) return false;
  if (h.includes('c/100') && h.includes('vn') && (h.includes('interes') || h.includes('inter'))) return true;
  return h.includes('cupon') || h.includes('coupon');
}

function headerMatchesAmort(h: string): boolean {
  return h.includes('amort') || h.includes('amortizacion') || h.includes('amortization');
}

function headerMatchesResidual(h: string): boolean {
  return h.includes('valor residual') || h.includes('residual') || h.includes('valor resid');
}

interface ColMap {
  date: number;
  ticker: number;
  flow: number;
  issuer?: number;
  currency?: number;
  coupon?: number;
  amort?: number;
  residual?: number;
}

function tryMapHeaders(headers: string[]): ColMap | null {
  const norm = headers.map(normalizeHeader);
  const n = norm.length;
  let date = -1;
  let ticker = -1;
  let currency: number | undefined;
  let coupon: number | undefined;
  let amort: number | undefined;
  let residual: number | undefined;

  for (let i = 0; i < n; i++) {
    const h = norm[i]!;
    if (date < 0 && headerMatchesDate(h)) date = i;
    if (ticker < 0 && headerMatchesTicker(h)) ticker = i;
    if (currency === undefined && headerMatchesCurrency(h)) currency = i;
    if (coupon === undefined && headerMatchesCoupon(h)) coupon = i;
    if (amort === undefined && headerMatchesAmort(h)) amort = i;
    if (residual === undefined && headerMatchesResidual(h)) residual = i;
  }

  const flow = pickFlowColumnIndex(norm);
  const issuerIx = pickIssuerColumnIndex(norm);

  if (date < 0 || ticker < 0 || flow < 0) return null;
  return {
    date,
    ticker,
    flow,
    ...(issuerIx >= 0 ? { issuer: issuerIx } : {}),
    currency,
    coupon,
    amort,
    residual,
  };
}

function mergeHeaders(prev: string[] | null, curr: string[]): string[] {
  if (!prev) return curr.map((c) => stripBom(c));
  return curr.map((c, i) => stripBom(`${(prev[i] ?? '').trim()} ${stripBom(c)}`.trim()));
}

/**
 * Parsea CSV de calendario de pagos según BOND_PAYMENTS_ENGINE_README.md
 */
export function parseBondPaymentCalendarCsv(csvText: string): BondPaymentEvent[] {
  const text = csvText.replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const sep = detectSeparator(lines[0]!);
  const rows = lines.map((l) => splitCsvLine(l, sep));

  let colMap: ColMap | null = null;
  let headerRowIndex = -1;

  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const row = rows[i]!;
    const merged = i > 0 ? mergeHeaders(rows[i - 1]!, row) : null;
    const candidates = merged ? [row, merged] : [row];
    for (const headers of candidates) {
      const m = tryMapHeaders(headers);
      if (m) {
        colMap = m;
        headerRowIndex = i;
        break;
      }
    }
    if (colMap) break;
  }

  if (!colMap || headerRowIndex < 0) return [];

  const events: BondPaymentEvent[] = [];

  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r]!;
    if (row.every((c) => !stripBom(c))) continue;

    const ds = row[colMap.date] ?? '';
    const ts = row[colMap.ticker] ?? '';
    const fs = row[colMap.flow] ?? '';

    const date = parseDdMmYyyyDate(ds);
    const asset = stripBom(ts).toUpperCase();
    const flowTotal = parseNumber(fs);

    if (!date || !asset || flowTotal === undefined) continue;

    let currency = 'USD';
    if (colMap.currency !== undefined) {
      const c = stripBom(row[colMap.currency] ?? '');
      if (c) currency = c.toUpperCase();
    }

    const ev: BondPaymentEvent = {
      asset,
      date,
      currency,
      flowPer100: flowTotal,
    };

    if (colMap.issuer !== undefined) {
      const iss = stripBom(row[colMap.issuer] ?? '').trim();
      if (iss) ev.issuer = iss;
    }

    if (colMap.coupon !== undefined) {
      const v = parseNumber(row[colMap.coupon] ?? '');
      if (v !== undefined) ev.couponPer100 = v;
    }
    if (colMap.amort !== undefined) {
      const v = parseNumber(row[colMap.amort] ?? '');
      if (v !== undefined) ev.amortizationPer100 = v;
    }
    if (colMap.residual !== undefined) {
      const v = parseNumber(row[colMap.residual] ?? '');
      if (v !== undefined) {
        ev.residualPctOfPar = v <= 1 ? v * 100 : v;
      }
    }

    events.push(ev);
  }

  return events;
}

export function uniqueTickers(events: BondPaymentEvent[]): string[] {
  const s = new Set<string>();
  for (const e of events) s.add(e.asset);
  return [...s].sort();
}

/** Primer emisor no vacío por ticker (el CSV repite el mismo emisor en cada fila). */
export function issuerByTickerFromEvents(events: BondPaymentEvent[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of events) {
    if (e.issuer && !m.has(e.asset)) m.set(e.asset, e.issuer);
  }
  return m;
}
