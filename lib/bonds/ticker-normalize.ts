export function normalizeBondTicker(raw: string | null | undefined): string {
  if (!raw) return '';
  const cleaned = raw.toUpperCase().trim();
  const parts = cleaned.match(/[A-Z0-9]+/g) ?? [];
  if (parts.length === 0) return '';
  const withDigits = parts.find((p) => /\d/.test(p));
  return withDigits ?? parts[0]!;
}

/** Tickers de efectivo/moneda: no tienen calendario de cupones ni TIR de bono. */
const NON_YIELD_TICKERS = new Set(['CASH', 'PESOS', 'USD', 'ARS', 'EUR', 'MEP']);

export function tickerEligibleForBondYield(ticker: string | null | undefined): boolean {
  const key = normalizeBondTicker(ticker);
  return Boolean(key) && !NON_YIELD_TICKERS.has(key);
}

