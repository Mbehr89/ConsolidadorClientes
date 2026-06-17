import type { Position } from '@/lib/schema';

export type CashBucketKey =
  | 'ars'
  | 'cable'
  | 'especie_7000'
  | 'especie_10000'
  | 'mep'
  | 'money_market_ars'
  | 'money_market_usd'
  | 'eur';

export const CASH_BUCKET_DEFS: { key: CashBucketKey; label: string }[] = [
  { key: 'ars', label: 'ARS' },
  { key: 'cable', label: 'Cable' },
  { key: 'especie_7000', label: 'Especie 7000' },
  { key: 'especie_10000', label: 'Especie 10000' },
  { key: 'mep', label: 'USD MEP' },
  { key: 'money_market_ars', label: 'MM ARS' },
  { key: 'money_market_usd', label: 'MM USD' },
  { key: 'eur', label: 'EUR' },
];

/** Opciones de segmento cash/MM en el glosario de tickers. */
export const GLOSSARY_CASH_SEGMENT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '—' },
  { value: 'money_market_ars', label: 'MM ARS' },
  { value: 'money_market_usd', label: 'MM USD' },
  { value: 'ars', label: 'Cash ARS' },
  { value: 'mep', label: 'USD MEP' },
  { value: 'cable', label: 'Cable' },
  { value: 'especie_7000', label: 'Especie 7000' },
  { value: 'especie_10000', label: 'Especie 10000' },
];

const IEB_CASH_TICKER_BUCKET_MAP: Record<string, CashBucketKey> = {
  PESOS: 'ars',
  USD: 'mep',
  'DOLAR EXT': 'cable',
  DOLARUSA: 'especie_7000',
  'MM PESOS': 'money_market_ars',
  'MM DOLARES': 'money_market_usd',
  'MM DOLAR': 'money_market_usd',
  'MM USD': 'money_market_usd',
};

export function normalizeCashToken(value: string): string {
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

export function isMoneyMarketSubtipo(sub: string | null | undefined): boolean {
  const s = (sub ?? '').trim().toLowerCase();
  return s === 'money_market_ars' || s === 'money_market_usd' || s === 'money_market' || s === 'money market';
}

/** Posición que debe tratarse como cash para buckets (incluye MM confirmado en glosario). */
export function isCashBucketPosition(p: Position): boolean {
  if (p.clase_activo === 'cash') return true;
  if ((p.ticker ?? '').toUpperCase() === 'CASH') return true;
  if (isMoneyMarketSubtipo(p.moneda_subtipo)) return true;
  return false;
}

/**
 * Infiere MM ARS / MM USD desde ticker, descripción o subtipo del parser.
 * Útil para alimentar pendientes del glosario y reclasificar fondos MM mal etiquetados.
 */
export function inferMoneyMarketSubtipo(p: Position): 'money_market_ars' | 'money_market_usd' | null {
  const sub = (p.moneda_subtipo ?? '').trim().toLowerCase();
  if (sub === 'money_market_ars' || sub === 'money market ars') return 'money_market_ars';
  if (sub === 'money_market_usd' || sub === 'money market usd') return 'money_market_usd';
  if (sub === 'money_market' || sub === 'money market') {
    return p.moneda === 'ARS' ? 'money_market_ars' : 'money_market_usd';
  }

  const tickerNorm = normalizeCashToken(p.ticker ?? '');
  const descNorm = normalizeCashToken(p.descripcion ?? '');
  const desc = (p.descripcion ?? '').toLowerCase();

  if (p.broker === 'IEB') {
    const fromTicker = IEB_CASH_TICKER_BUCKET_MAP[tickerNorm];
    if (fromTicker === 'money_market_ars' || fromTicker === 'money_market_usd') return fromTicker;
    const fromDesc =
      tickerNorm === '' || tickerNorm === '-' ? IEB_CASH_TICKER_BUCKET_MAP[descNorm] : undefined;
    if (fromDesc === 'money_market_ars' || fromDesc === 'money_market_usd') return fromDesc;
  }

  if (/money\s*market|\bmmf\b|fondo\s+de\s+liquidez|liquidez\s+inmediata|\bfci\s+liquidez/i.test(desc)) {
    if (/d[oó]lar|usd|\busd\b/i.test(desc) && !/pesos?|\bars\b/i.test(desc)) return 'money_market_usd';
    if (/pesos?|\bars\b/i.test(desc)) return 'money_market_ars';
    return p.moneda === 'ARS' ? 'money_market_ars' : 'money_market_usd';
  }

  if (/^MM\s+(PESOS?|ARS)/i.test(tickerNorm) || /^MM\s+PESOS?/i.test(descNorm)) return 'money_market_ars';
  if (/^MM\s+(DOLAR|USD)/i.test(tickerNorm) || /^MM\s+DOLAR/i.test(descNorm)) return 'money_market_usd';

  return null;
}

/**
 * Clasifica cash en un bucket estable.
 * En GMA el efectivo USD suele venir con moneda ARS; prioriza subtipo y descripción.
 */
export function getCashBucketKey(p: Position): CashBucketKey {
  const sub = (p.moneda_subtipo ?? '').trim().toLowerCase();
  const desc = (p.descripcion ?? '').toLowerCase();
  const tickerNorm = normalizeCashToken(p.ticker ?? '');
  const descNorm = normalizeCashToken(p.descripcion ?? '');

  if (p.broker === 'IEB') {
    const fromTicker = IEB_CASH_TICKER_BUCKET_MAP[tickerNorm];
    if (fromTicker) return fromTicker;
    const fromDesc = tickerNorm === '' || tickerNorm === '-' ? IEB_CASH_TICKER_BUCKET_MAP[descNorm] : undefined;
    if (fromDesc) return fromDesc;
  }

  if (sub === 'ars') return 'ars';
  if (sub === 'usd') return 'mep';
  if (sub === '7000') return 'especie_7000';
  if (sub === '10000') return 'especie_10000';
  if (sub === 'cable') return 'cable';
  if (sub === 'mep') return 'mep';
  if (sub === 'money_market_ars' || sub === 'money market ars') return 'money_market_ars';
  if (sub === 'money_market_usd' || sub === 'money market usd') return 'money_market_usd';
  if (sub === 'money_market' || sub === 'money market') return p.moneda === 'ARS' ? 'money_market_ars' : 'money_market_usd';
  if (sub === 'usd_cash' || sub === 'usd cash') return 'mep';
  if (sub === 'eur') return 'eur';

  const inferredMm = inferMoneyMarketSubtipo(p);
  if (inferredMm) return inferredMm;

  if (/\b7000\b|dolar\s*7000|usd\s*7000|especie\s*7000/.test(desc)) return 'especie_7000';
  if (/\b10000\b|dolar\s*10000|especie\s*10000/.test(desc)) return 'especie_10000';
  if (/cable|dólar\s*cable|dolar\s*cable/.test(desc)) return 'cable';
  if (/\bmep\b|dolar\s*mep/.test(desc)) return 'mep';
  if (/money\s*market|\bmmf\b/.test(desc)) return p.moneda === 'ARS' ? 'money_market_ars' : 'money_market_usd';

  if (p.moneda === 'EUR') return 'eur';
  if (p.moneda === 'ARS' && (!sub || sub === 'ars')) return 'ars';
  if (p.moneda === 'USD') return 'mep';
  if (p.moneda === 'ARS') return 'ars';

  return 'mep';
}

export function cashBucketLabel(key: CashBucketKey): string {
  return CASH_BUCKET_DEFS.find((d) => d.key === key)?.label ?? key;
}
