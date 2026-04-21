/**
 * Tipos alineados con BOND_PAYMENTS_ENGINE_README.md
 */
export interface BondPaymentEvent {
  asset: string;
  date: Date;
  currency: string;
  flowPer100: number;
  couponPer100?: number;
  amortizationPer100?: number;
  residualPctOfPar?: number;
}

export interface BondYieldMetrics {
  ytmAnnualEffective: number | null;
  macaulayYears: number | null;
  modifiedDuration: number | null;
  convexity: number | null;
  npvAtZero: number;
  futureFlowsCount: number;
}

export interface BondCalculatorInputs {
  ticker: string;
  valuationDate: Date;
  /** Precio sucio por cada 100 de nominal (misma convención que el CSV). */
  dirtyPricePer100: number;
  /** Nominal en unidades del VN (típico 100 o el nominal real). */
  nominal: number;
  /** ARS por 1 USD; solo aplica si hay flujos en ARS. */
  usdArsFxRate: number;
}
