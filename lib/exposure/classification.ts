import { ETF_NAMES, ETF_SECTORS } from '@/lib/exposure/etf-data';

export type Cat = { label: string; color: string };

export const ASSET_CATS: Cat[] = [
  { label: 'Renta variable', color: '#2a78d6' },
  { label: 'Renta fija', color: '#eb6834' },
  { label: 'Alternativos', color: '#1baf7a' },
  { label: 'Cash', color: '#eda100' },
];

export const SECTOR_CATS: Cat[] = [
  { label: 'Tecnología', color: '#2a78d6' },
  { label: 'Comunicación', color: '#eb6834' },
  { label: 'Consumo', color: '#1baf7a' },
  { label: 'Financiero', color: '#eda100' },
  { label: 'Salud', color: '#e87ba4' },
  { label: 'Industriales', color: '#008300' },
  { label: 'Otros', color: '#6250d6' },
  { label: 'Sin datos', color: '#898781' },
];

export const REGION_CATS: Cat[] = [
  { label: 'EE.UU.', color: '#2a78d6' },
  { label: 'Europa', color: '#eb6834' },
  { label: 'Argentina', color: '#1baf7a' },
  { label: 'LatAm ex AR', color: '#eda100' },
  { label: 'Asia / EM', color: '#e87ba4' },
  { label: 'Global', color: '#008300' },
];

export const DIMS = [
  { id: 'asset' as const, title: 'Asset class', base: '% del portfolio', empty: 'Sin posiciones', cats: ASSET_CATS },
  { id: 'sector' as const, title: 'Sector', base: '% de renta variable', empty: 'Sin renta variable', cats: SECTOR_CATS },
  { id: 'region' as const, title: 'Región', base: '% invertido ex cash', empty: 'Solo cash', cats: REGION_CATS },
];

export type DimId = (typeof DIMS)[number]['id'];

/** Sector de acciones directas. Lo que no está acá no cae en Otros: queda sin clasificar. */
export const DIRECT_SECTOR: Record<string, number> = {
  MSFT: 0, NVDA: 0, TSM: 0, MKSI: 0, CRWD: 0, ASML: 0, GLOB: 0, AAPL: 0, AVGO: 0, AMD: 0, MU: 0,
  GOOGL: 1, NFLX: 1, META: 1,
  MELI: 2, AMZN: 2, TSLA: 2, BABA: 2, ABNB: 2,
  NU: 3, MFG: 3, GGAL: 3, JPM: 3, 'BRK-B': 3, V: 3,
  LLY: 4,
  RTX: 5, GE: 5, BA: 5, LMT: 5, GD: 5,
  OXY: 6, CHRD: 6, GRSD: 6, XOM: 6,
};

/** Riesgo económico, no domicilio del listing. */
export const TICKER_REGION: Record<string, number> = {
  MELI: 3, NU: 3, GLOB: 2, GGAL: 2,
  TSM: 4, BABA: 4, MFG: 4,
  ASML: 1,
  GLD: 5, IBIT: 5,
  SPY: 0, IWM: 0, VNQ: 0,
  KWEB: 4, FXI: 4, EWJ: 4,
  ILF: 3,
  NATO: 5,
};

const EUROPE = new Set(['DE', 'FR', 'GB', 'IT', 'ES', 'NL', 'CH', 'SE', 'NO', 'DK', 'FI', 'PT', 'IE', 'AT', 'BE', 'LU', 'GR', 'PL', 'CZ', 'HU']);
const LATAM = new Set(['BR', 'MX', 'CL', 'CO', 'PE', 'UY', 'PY', 'BO', 'EC', 'VE', 'CR', 'PA', 'GT', 'DO']);
const ASIA = new Set(['CN', 'HK', 'JP', 'KR', 'IN', 'TW', 'SG', 'TH', 'MY', 'ID', 'PH', 'VN', 'ZA', 'TR']);

const ALTERNATIVES = new Set(['GLD', 'IBIT']);
const BOND_ETFS = new Set(['TLT', 'IEF', 'SHY', 'BIL', 'SGOV', 'BND', 'AGG', 'LQD', 'HYG', 'TIP', 'MUB', 'EMB', 'VCIT', 'VCSH', 'IGSB', 'JNK', 'VGIT', 'VGSH', 'BNDX', 'GOVT', 'MINT', 'JPST', 'NEAR']);

export function equityEtfTickers(): string[] {
  return Object.keys(ETF_SECTORS);
}

export function isEquityEtf(ticker: string): boolean {
  return ticker in ETF_SECTORS;
}

export function canonTicker(raw: string | null | undefined): string | null {
  const t = raw?.trim().toUpperCase();
  if (!t || t === '-' || t === 'CASH') return null;
  if (t === 'GOOG') return 'GOOGL';
  return t;
}

export function displayName(ticker: string, fallback?: string | null): string {
  return ETF_NAMES[ticker] ?? (fallback?.trim() || ticker);
}

export type RegionIndex = 0 | 1 | 2 | 3 | 4 | 5;

export function regionOfCountry(iso: string | null | undefined): RegionIndex | null {
  const c = iso?.trim().toUpperCase();
  if (!c) return null;
  if (c === 'US') return 0;
  if (c === 'AR') return 2;
  if (EUROPE.has(c)) return 1;
  if (LATAM.has(c)) return 3;
  if (ASIA.has(c)) return 4;
  if (c === 'CA' || c === 'AU' || c === 'NZ') return 5;
  return null;
}

export function regionOfTicker(ticker: string, country: string | null): RegionIndex | null {
  const known = TICKER_REGION[ticker];
  if (known != null) return known as RegionIndex;
  return regionOfCountry(country);
}

export type AssetKind = 0 | 1 | 2 | 3 | null;

/** Clase de exposición. null = sin clasificar, nunca "Otros". */
export function assetKindOf(ticker: string | null, clase: string, text: string): AssetKind {
  if (ticker && ALTERNATIVES.has(ticker)) return 2;
  if (ticker && isEquityEtf(ticker)) return 0;
  if (ticker && BOND_ETFS.has(ticker)) return 1;
  if (clase === 'cash') return 3;
  if (/sweep|preferred savings|bank deposit|dep[oó]sito a plazo|money market/i.test(text) && clase !== 'equity' && clase !== 'bond') return 3;
  if (clase === 'bond' || clase === 'on' || clase === 'letra') return 1;
  if (clase === 'equity') return 0;
  if (clase === 'fund' && /renta fija|fixed income|bonos?|treasury|tesoro/i.test(text)) return 1;
  return null;
}

export function sectorLabel(index: number, lookThrough: boolean): string {
  if (index === 7 && !lookThrough) return 'ETF multisector';
  return SECTOR_CATS[index]?.label ?? 'Sin clasificar';
}
