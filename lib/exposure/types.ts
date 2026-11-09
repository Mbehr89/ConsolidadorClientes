/** Una cuenta para el pantallazo. Los mapas `direct` y `etf` alimentan sector y ranking. */

export type ExposureLine = {
  ticker: string;
  name: string;
  amount: number;
  /** 0 renta variable, 1 renta fija, 2 alternativos, 3 cash. null = sin clasificar. */
  asset: 0 | 1 | 2 | 3 | null;
  /** null en cash y en lo que no tiene región conocida. */
  region: 0 | 1 | 2 | 3 | 4 | 5 | null;
  /** Sector de una acción directa. null si no es acción o no está en el mapa. */
  sector: number | null;
  vehicle: 'direct' | 'etf' | 'other';
};

export type ExposureAccount = {
  id: string;
  name: string;
  broker: string;
  cuenta: string;
  titular: string;
  grupoId: string | null;
  asset: [number, number, number, number];
  region: [number, number, number, number, number, number];
  direct: Record<string, number>;
  etf: Record<string, number>;
  lines: ExposureLine[];
  /** Dólares que no entraron a un asset class, un sector o una región. */
  unclassified: number;
};

export type SlicePart = {
  ticker: string;
  name: string;
  amount: number;
  source: string;
};

export type RankedAsset = {
  key: string;
  name: string;
  direct: number;
  via: number;
  total: number;
  pctOfEquity: number;
};
