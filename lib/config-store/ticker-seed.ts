/**
 * Metadata inicial de tickers (seed). Se persiste en la primera GET de tickers-metadata si el store está vacío.
 */
import type { TickersMetadataStore, TickerMeta } from './types';

const SEED_FECHA = '2026-01-01T00:00:00.000Z';

function meta(
  nombre: string,
  pais: string | null,
  clase: string,
  esEtf: boolean
): TickerMeta {
  return {
    pais,
    clase,
    es_etf: esEtf,
    nombre,
    confirmado: true,
    fuente: 'seed',
    confirmado_por: null,
    fecha: SEED_FECHA,
  };
}

function add(
  out: TickersMetadataStore,
  sym: string,
  pais: string | null,
  clase: string,
  esEtf: boolean
): void {
  out[sym.toUpperCase()] = meta(sym, pais, clase, esEtf);
}

/** Seed completo según listado de producto. */
export function buildTickerSeed(): TickersMetadataStore {
  const out: TickersMetadataStore = {};

  const etfsUs = [
    'EWZ',
    'QQQ',
    'SPY',
    'IWM',
    'TLT',
    'VNQ',
    'XLF',
    'SLV',
    'INDA',
    'EWJ',
    'TQQQ',
    'ETHA',
    'IBIT',
  ];
  for (const s of etfsUs) add(out, s, 'US', 'etf', true);

  const equityAr = [
    'BBAR',
    'BMA',
    'BYMA',
    'PAMP',
    'TGSU2',
    'YPFD',
    'ALUA',
    'CRES',
    'TXAR',
    'SUPV',
    'COME',
    'HARG',
    'IRSA',
    'MOLA',
    'TGNO4',
    'CEPU',
    'BHIP',
  ];
  for (const s of equityAr) add(out, s, 'AR', 'equity', false);

  const equityUs = [
    'AAPL',
    'AMZN',
    'GOOGL',
    'META',
    'MSFT',
    'NVDA',
    'TSLA',
    'NFLX',
    'ABNB',
    'CRWD',
    'LLY',
    'COP',
    'CVX',
    'CHRD',
    'CNMD',
  ];
  for (const s of equityUs) add(out, s, 'US', 'equity', false);

  add(out, 'ASML', 'NL', 'equity', false);
  add(out, 'ABEV', 'BR', 'equity', false);
  add(out, 'NU', 'KY', 'equity', false);
  add(out, 'GLOB', 'LU', 'equity', false);
  add(out, 'MELI', 'UY', 'equity', false);

  const cedearOff = [
    ['GGAL', 'AR'],
    ['YPF', 'AR'],
    ['PAM', 'AR'],
    ['VIST', 'MX'],
  ] as const;
  for (const [s, p] of cedearOff) add(out, s, p, 'cedear', false);

  const bonosAr = [
    'AL30',
    'GD35',
    'GD30',
    'AE38',
    'AL29',
    'AL41',
    'GD29',
    'GD38',
    'GD41',
    'BPOC7',
    'BPOD7',
    'NDT25',
  ];
  for (const s of bonosAr) add(out, s, 'AR', 'bond', false);

  const onsAr = [
    'YMCXO',
    'PN35O',
    'PN36O',
    'MGCMO',
    'PLC5O',
    'TSC4O',
    'YM39O',
    'VSCOO',
    'VSCVO',
    'YM34O',
  ];
  for (const s of onsAr) add(out, s, 'AR', 'on', false);

  return out;
}

export const TICKER_SEED: TickersMetadataStore = buildTickerSeed();
