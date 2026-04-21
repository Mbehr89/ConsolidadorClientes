/**
 * Metadata de emisor por prefijo de ticker (heurística; el CSV no trae emisor).
 * Ampliá este mapa según tus especies.
 */
const PREFIX_TO_ISSUER: Record<string, string> = {
  AL: 'República Argentina (USD)',
  AE: 'República Argentina (USD)',
  GD: 'República Argentina (USD)',
  YMC: 'República Argentina (USD)',
  PAR: 'Provincia Buenos Aires',
  TZX: 'República Argentina',
  TXR: 'República Argentina',
  T2X: 'República Argentina',
  T4X: 'República Argentina',
  T6X: 'República Argentina',
  BPO: 'Bonos corporativos',
  CORP: 'Bonos corporativos',
};

export function issuerForTicker(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  if (!t) return 'Sin clasificar';
  const prefix = t.match(/^([A-Z]{2,4})/)?.[1];
  if (prefix && PREFIX_TO_ISSUER[prefix]) {
    return PREFIX_TO_ISSUER[prefix]!;
  }
  if (t.startsWith('S') && t.length > 4) {
    return 'Bonos soberanos / corporativos';
  }
  return 'Otros';
}

/** Prioriza el emisor del calendario (columna tipo “Emisor”) si existe. */
export function issuerLabel(ticker: string, fromCalendar?: string | null): string {
  const c = fromCalendar?.trim();
  if (c) return c;
  return issuerForTicker(ticker);
}

export function uniqueIssuers(tickers: string[], issuerByTicker: Map<string, string>): string[] {
  const s = new Set<string>();
  for (const t of tickers) {
    s.add(issuerLabel(t, issuerByTicker.get(t)));
  }
  return [...s].sort((a, b) => a.localeCompare(b, 'es'));
}
